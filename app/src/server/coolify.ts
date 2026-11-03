import { COOLIFY_NAME_MAX, coolifyKey, coolifyNameError, coolifyUrlError, normalizeCoolifyUrl } from "@/lib/coolify";
import { secretValueError } from "@/lib/secrets";
import type { CoolifyRow } from "@/lib/types";
import { coolifyInstances } from "./coolify-settings";
import { type Env, env } from "./env";
import { writeJsonAtomic } from "./fsio";
import { checkPassword } from "./limiter";
import { readDiscovery } from "./connections";
import { secretRows } from "./secrets";
import { mergeSettings, rawProjects } from "./store";

export function coolifyView(e: Env = env()): CoolifyRow[] {
	const rows = secretRows(e);
	const found = readDiscovery(e)?.coolify ?? [];
	return coolifyInstances(e).map((i) => {
		const key = coolifyKey(i.name);
		const token = rows.find((r) => r.key === key) ?? { key, source: "unset" as const, state: null, detail: null, updatedAt: null, pending: false };
		const d = found.find((f) => f.name === i.name);
		return { name: i.name, url: i.url, key, token, apps: d?.ok ? d.apps.length : null, detail: d && !d.ok ? d.detail : null };
	});
}

export type CoolifyInput = { name: string; url: string; token?: string; password: string };

function validate(input: CoolifyInput, old: { url: string } | undefined): string | null {
	const url = normalizeCoolifyUrl(input.url);
	const bad = coolifyNameError(input.name) ?? coolifyUrlError(url);
	if (bad) return bad;
	const token = input.token ?? "";
	// A new URL needs a new token. The runner binds a token to the URL that it checked.
	if ((!old || old.url !== url) && token === "") return old ? "A new URL needs the token again." : "Enter the token.";
	return token === "" ? null : secretValueError(token);
}

// Add or edit an instance. The URL goes to settings.json. The token goes to the secrets inbox, and the runner checks it.
// Error texts are fixed. They never hold the token or the password.
export async function saveCoolify(input: CoolifyInput, e: Env = env(), failDelayMs = 1000): Promise<{ name: string }> {
	if (!(await checkPassword(input.password, e, failDelayMs))) throw new Error("Wrong password.");
	const old = coolifyInstances(e).find((i) => i.name === input.name);
	const bad = validate(input, old);
	if (bad) throw new Error(bad);
	const url = normalizeCoolifyUrl(input.url);
	mergeSettings(e, (fresh) => {
		const rest = (Array.isArray(fresh.coolify) ? fresh.coolify : []).filter((i) => i?.name !== input.name);
		return { ...fresh, coolify: [...rest, { name: input.name, url }].sort((a, b) => a.name.localeCompare(b.name)) };
	});
	if (input.token) writeJsonAtomic(`${e.inboxRoot}/${coolifyKey(input.name)}.json`, { value: input.token, written_at: new Date().toISOString() }, 0o600);
	return { name: input.name };
}

// Remove the instance, its token and the links of the projects. The state folders and the pending items stay.
export async function removeCoolify(input: { name: string; password: string }, e: Env = env(), failDelayMs = 1000): Promise<{ name: string }> {
	if (!(await checkPassword(input.password, e, failDelayMs))) throw new Error("Wrong password.");
	if (input.name.length > COOLIFY_NAME_MAX || !coolifyInstances(e).some((i) => i.name === input.name)) throw new Error("Unknown instance.");
	mergeSettings(e, (fresh) => ({ ...fresh, coolify: (Array.isArray(fresh.coolify) ? fresh.coolify : []).filter((i) => i?.name !== input.name) }));
	const key = coolifyKey(input.name);
	if (secretRows(e).find((r) => r.key === key)?.source === "ui") writeJsonAtomic(`${e.inboxRoot}/${key}.json`, { clear: true, written_at: new Date().toISOString() }, 0o600);
	const projects = rawProjects(e).map((p) => (Array.isArray(p.coolify) ? { ...p, coolify: p.coolify.filter((l: { instance?: string }) => l?.instance !== input.name) } : p));
	writeJsonAtomic(`${e.stateRoot}/projects.json`, projects);
	return { name: input.name };
}
