import { existsSync, statSync } from "node:fs";
import { NOTIFY_STATUS, TEST_WAIT_MS, urlError } from "@/lib/settings";
import type { IntegrationsView } from "@/lib/types";
import { type Env, env } from "./env";
import { readJson, writeJsonAtomic } from "./fsio";
import { checkPassword } from "./limiter";
import { mergeSettings, type Settings } from "./store";

type UrlKey = "hermes_webhook_url" | "warden_url";

// settings.json is runner input. Keep only a value that passes the same check as the runner.
function stored(e: Env, key: UrlKey): string | null {
	const v = readJson<Settings>(`${e.stateRoot}/settings.json`, {})[key];
	return typeof v === "string" && v !== "" && urlError(v) === null ? v : null;
}

// The runner writes notify-test.json. The file holds ok, status and a time, never an answer body.
function testResult(e: Env): IntegrationsView["test"]["result"] {
	const raw = readJson<Record<string, unknown> | null>(`${e.stateRoot}/notify-test.json`, null);
	if (!raw || typeof raw !== "object" || typeof raw.ok !== "boolean" || typeof raw.status !== "string" || !NOTIFY_STATUS.test(raw.status)) return null;
	return { ok: raw.ok, status: raw.status, at: typeof raw.at === "string" && !Number.isNaN(Date.parse(raw.at)) ? raw.at : null };
}

const requestPath = (e: Env) => `${e.stateRoot}/requests/notify-test.json`;

// The time of the request file. The write time is the fallback when the file has no valid time.
function requestedAt(e: Env): string | null {
	if (!existsSync(requestPath(e))) return null;
	const at = readJson<{ requested_at?: unknown }>(requestPath(e), {}).requested_at;
	return typeof at === "string" && !Number.isNaN(Date.parse(at)) ? at : statSync(requestPath(e)).mtime.toISOString();
}

export function integrationsView(e: Env = env()): IntegrationsView {
	const hermes = stored(e, "hermes_webhook_url");
	const warden = stored(e, "warden_url");
	const at = requestedAt(e);
	return {
		hermesUrl: hermes,
		hermesUrlSource: hermes ? "ui" : process.env.HERMES_WEBHOOK_URL ? "env" : "unset",
		wardenUrl: warden,
		wardenUrlSource: warden ? "ui" : process.env.WARDEN_URL ? "env" : "unset",
		test: { requested: at !== null, requestedAt: at, result: testResult(e) },
	};
}

// The Hermes URL decides where signed notices go. A URL change needs the password, as a secret does.
async function requirePassword(password: string, e: Env, failDelayMs: number): Promise<void> {
	if (!(await checkPassword(password, e, failDelayMs))) throw new Error("Wrong password.");
}

// An empty text removes the key. Other settings stay: the file is read again at write time.
export async function setUrl(key: UrlKey, value: string, password: string, e: Env = env(), failDelayMs = 1000): Promise<void> {
	await requirePassword(password, e, failDelayMs);
	const v = value.trim();
	const bad = urlError(v);
	if (bad) throw new Error(bad);
	mergeSettings(e, (fresh) => {
		const { [key]: _old, ...rest } = fresh;
		return v === "" ? rest : { ...rest, [key]: v };
	});
}

// The runner handles the file between scout runs. A second click while a fresh file exists changes nothing.
// A file older than the wait time is dead: the next click writes a new one.
export async function requestNotifyTest(password: string, e: Env = env(), failDelayMs = 1000, now = Date.now()): Promise<void> {
	await requirePassword(password, e, failDelayMs);
	const at = requestedAt(e);
	if (at !== null && now - Date.parse(at) < TEST_WAIT_MS) return;
	writeJsonAtomic(requestPath(e), { requested_at: new Date(now).toISOString() });
}
