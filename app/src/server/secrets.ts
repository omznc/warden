import { existsSync } from "node:fs";
import { coolifyKey } from "@/lib/coolify";
import { FIXED_KEYS, isPosthogKey, isSecretKey, secretValueError } from "@/lib/secrets";
import type { SecretRow, SecretSource, SecretState } from "@/lib/types";
import { type Env, env } from "./env";
import { readJson, writeJsonAtomic } from "./fsio";
import { checkPassword } from "./limiter";
import { coolifyInstances } from "./coolify-settings";
import { loadProjects } from "./store";

type StatusEntry = { source?: string; state?: string | null; detail?: string | null; updated_at?: string | null };

function readStatus(e: Env): Record<string, StatusEntry> {
	const raw = readJson<unknown>(`${e.inboxRoot}/status.json`, {});
	return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, StatusEntry>) : {};
}

const SOURCES: SecretSource[] = ["env", "ui", "unset"];
const STATES: (string | null)[] = ["ok", "warn", "invalid", "error", null];

// Names only. No value is ever read from the inbox.
export function secretRows(e: Env = env()): SecretRow[] {
	const status = readStatus(e);
	const posthog = new Set<string>();
	for (const p of loadProjects(e)) if (isPosthogKey(p.posthog_key_env)) posthog.add(p.posthog_key_env);
	for (const k of Object.keys(status)) if (isPosthogKey(k)) posthog.add(k);
	const coolify = coolifyInstances(e).map((i) => coolifyKey(i.name));
	const keys = [...FIXED_KEYS, ...[...posthog].sort(), ...coolify].filter((k, i, all) => all.indexOf(k) === i);
	return keys.map((key) => {
		const s = status[key] ?? {};
		return {
			key,
			source: SOURCES.includes(s.source as SecretSource) ? (s.source as SecretSource) : "unset",
			state: (STATES.includes(s.state ?? null) ? (s.state ?? null) : null) as SecretState,
			detail: typeof s.detail === "string" ? s.detail.slice(0, 300) : null,
			updatedAt: typeof s.updated_at === "string" ? s.updated_at : null,
			pending: existsSync(`${e.inboxRoot}/${key}.json`),
		};
	});
}

export type SecretInput = { key: string; value?: string; clear?: boolean; password: string };

// Error texts are fixed. They never contain the value or the password.
export async function saveSecret(input: SecretInput, e: Env = env(), failDelayMs = 1000): Promise<{ key: string }> {
	if (!isSecretKey(input.key)) throw new Error("This key is not allowed.");
	if (!(await checkPassword(input.password, e, failDelayMs))) throw new Error("Wrong password.");
	const written_at = new Date().toISOString();
	const path = `${e.inboxRoot}/${input.key}.json`;
	if (input.clear) {
		if (readStatus(e)[input.key]?.source !== "ui") throw new Error("Only a key set in Warden can be cleared.");
		writeJsonAtomic(path, { clear: true, written_at }, 0o600);
		return { key: input.key };
	}
	const bad = secretValueError(input.value);
	if (bad) throw new Error(bad);
	writeJsonAtomic(path, { value: input.value, written_at }, 0o600);
	return { key: input.key };
}
