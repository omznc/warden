import { COOLIFY_NAME, COOLIFY_NAME_MAX, coolifyUrlError, normalizeCoolifyUrl } from "@/lib/coolify";
import { type Env, env } from "./env";
import { readJson } from "./fsio";
import type { Settings } from "./store";

export type CoolifyInstance = { name: string; url: string };

// settings.json is runner input. Keep only an entry that passes the same check as the runner (coolify_instances in lib.sh).
export function coolifyInstances(e: Env = env()): CoolifyInstance[] {
	const list = readJson<Settings>(`${e.stateRoot}/settings.json`, {}).coolify;
	if (!Array.isArray(list)) return [];
	const out: CoolifyInstance[] = [];
	for (const i of list) {
		if (!i || typeof i.name !== "string" || typeof i.url !== "string") continue;
		const url = normalizeCoolifyUrl(i.url);
		if (i.name.length <= COOLIFY_NAME_MAX && COOLIFY_NAME.test(i.name) && coolifyUrlError(url) === null) out.push({ name: i.name, url });
	}
	return out;
}
