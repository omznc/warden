import type { CoolifyAppRef, CoolifyDiscovery } from "@/lib/types";

// Same rules as coolify_instances and coolify_key in bin/lib.sh.
export const COOLIFY_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const COOLIFY_NAME_MAX = 30;
export const COOLIFY_PREFIX = "COOLIFY_TOKEN_";
export const COOLIFY_UUID = /^[A-Za-z0-9_-]{8,64}$/;
const COOLIFY_URL = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

export const coolifyKey = (name: string): string => `${COOLIFY_PREFIX}${name.toUpperCase().replaceAll("-", "_")}`;

export function coolifyNameError(name: string): string | null {
	if (name === "" || name.length > COOLIFY_NAME_MAX || !COOLIFY_NAME.test(name)) return `Use a to z, 0 to 9 and single hyphens, at most ${COOLIFY_NAME_MAX} characters.`;
	return null;
}

// The base URL of the instance. Only https, a plain host, no path and no user info. The runner sends the token to this URL.
export function coolifyUrlError(value: string): string | null {
	const v = value.trim().replace(/\/$/, "");
	if (v === "") return "Enter the URL of the instance.";
	if (v.length > 200 || !COOLIFY_URL.test(v)) return "Enter an https URL with a plain host and no path, for example https://coolify.example.com. No user name or password in the URL.";
	return null;
}

export const normalizeCoolifyUrl = (value: string): string => value.trim().replace(/\/$/, "");

// Applications of an instance that use a repository, and the others.
export function splitApps(d: CoolifyDiscovery[], repo: string): { match: (CoolifyAppRef & { instance: string })[]; other: (CoolifyAppRef & { instance: string })[] } {
	const all = d.flatMap((i) => (i.ok ? i.apps.map((a) => ({ ...a, instance: i.name })) : []));
	const same = (a: CoolifyAppRef) => repo !== "" && a.repo?.toLowerCase() === repo.trim().toLowerCase();
	return { match: all.filter(same), other: all.filter((a) => !same(a)) };
}

export const linkId = (instance: string, uuid: string): string => `${instance}/${uuid}`;
