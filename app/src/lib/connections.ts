import { pickKeyEnv } from "@/lib/secrets";
import type { Discovery } from "@/lib/types";

export type PosthogOption = { value: string; id: string; name: string; orgName: string; keys: string[] };

// One option for each PostHog project. A project that several keys cover lists all of them.
export function posthogOptions(d: Discovery | null, current?: { id: string | null; key: string | null }): PosthogOption[] {
	const map = new Map<string, PosthogOption>();
	for (const k of d?.posthog ?? []) {
		if (!k.ok) continue;
		for (const p of k.projects) {
			const value = `${k.region ?? ""}:${p.id}`;
			const old = map.get(value);
			if (old) old.keys.push(k.key_env);
			else map.set(value, { value, id: String(p.id), name: p.name, orgName: p.org_name ?? "Other", keys: [k.key_env] });
		}
	}
	const list = [...map.values()];
	const saved = savedOption(current, list);
	return saved ? [...list, saved] : list;
}

// A saved project that discovery does not list stays selectable.
function savedOption(current: { id: string | null; key: string | null } | undefined, list: PosthogOption[]): PosthogOption | null {
	if (!current?.id || !current.key || list.some((o) => o.id === current.id)) return null;
	return { value: `saved:${current.id}`, id: current.id, name: `Project ${current.id}`, orgName: "Saved", keys: [current.key] };
}

export function groupByOrg(options: PosthogOption[]): [string, PosthogOption[]][] {
	const groups = new Map<string, PosthogOption[]>();
	for (const o of options) groups.set(o.orgName, [...(groups.get(o.orgName) ?? []), o]);
	return [...groups.entries()];
}

export function defaultKey(option: PosthogOption, used: string[]): string {
	return pickKeyEnv(option.keys, used) ?? option.keys[0];
}
