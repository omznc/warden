import { mkdirSync, writeFileSync } from "node:fs";
import { COOLIFY_NAME, COOLIFY_UUID } from "@/lib/coolify";
import { ISSUE_AUTHORS, NAME_RE, REPO_RE, SCOUTS, SLUG_RE } from "@/lib/scouts";
import { isPosthogKey } from "@/lib/secrets";
import type { CheckStatus, Connections, Discovery, Project, ProjectListRow } from "@/lib/types";
import { type Env, env } from "./env";
import { readJson, writeJsonAtomic } from "./fsio";
import { secretRows } from "./secrets";
import { loadProjects, rawProjects, updateProject } from "./store";

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

// The runner writes this file. Keep only the known shape.
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);
const optStr = (v: unknown): string | undefined => (v == null ? undefined : String(v));

function parseKey(k: Record<string, unknown>): Discovery["posthog"][number] {
	return {
		key_env: String(k.key_env),
		source: String(k.source ?? ""),
		ok: k.ok === true,
		detail: typeof k.detail === "string" ? k.detail : null,
		region: typeof k.region === "string" ? k.region : undefined,
		projects: list(k.projects).map((p) => ({ id: String(p.id ?? ""), name: String(p.name ?? p.id ?? ""), org_id: optStr(p.org_id), org_name: optStr(p.org_name) })),
	};
}

function parseSentry(s: Record<string, unknown> | null): Discovery["sentry"] {
	if (!s) return null;
	return {
		ok: s.ok === true,
		detail: typeof s.detail === "string" ? s.detail : null,
		projects: list(s.projects).map((p) => ({ org: String(p.org ?? ""), slug: String(p.slug ?? ""), name: String(p.name ?? p.slug ?? ""), platform: optStr(p.platform) })),
	};
}

function parseCoolify(v: unknown): Discovery["coolify"] {
	return list(v).map((i) => ({
		name: String(i.name ?? ""),
		url: String(i.url ?? ""),
		ok: i.ok === true,
		detail: typeof i.detail === "string" ? i.detail : null,
		apps: list(i.apps).map((a) => ({ uuid: String(a.uuid ?? ""), name: String(a.name ?? ""), repo: typeof a.repo === "string" ? a.repo : null, fqdn: String(a.fqdn ?? ""), status: String(a.status ?? ""), build_pack: optStr(a.build_pack) ?? null })),
	}));
}

export function readDiscovery(e: Env = env()): Discovery | null {
	const raw = readJson<unknown>(`${e.inboxRoot}/discovery.json`, null);
	if (!isObj(raw)) return null;
	const gh = isObj(raw.github) ? raw.github : null;
	return {
		updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null,
		github: gh ? { ok: gh.ok === true, login: String(gh.login ?? ""), detail: String(gh.detail ?? "") } : null,
		posthog: list(raw.posthog).filter((k) => isPosthogKey(k.key_env)).map(parseKey),
		sentry: parseSentry(isObj(raw.sentry) ? raw.sentry : null),
		coolify: parseCoolify(raw.coolify),
	};
}

export function readProjectStatus(e: Env = env()): Record<string, CheckStatus> {
	const raw = readJson<unknown>(`${e.inboxRoot}/project-status.json`, {});
	return isObj(raw) ? (raw as Record<string, CheckStatus>) : {};
}

export function requestDiscovery(e: Env = env()): void {
	mkdirSync(e.inboxRoot, { recursive: true });
	writeFileSync(`${e.inboxRoot}/discover.request`, "");
}

export function connectionsView(e: Env = env()): Connections {
	const projects = loadProjects(e);
	return {
		discovery: readDiscovery(e),
		usedKeyEnvs: projects.map((p) => p.posthog_key_env).filter((k): k is string => Boolean(k)),
		sentryTokenSet: secretRows(e).some((r) => r.key === "SENTRY_TOKEN" && r.source !== "unset"),
		names: projects.map((p) => p.name),
	};
}

function checkOf(p: Project, status: Record<string, CheckStatus>): Pick<ProjectListRow, "check" | "detail"> {
	const s = status[p.name];
	if (!s) return { check: "checking", detail: null };
	const ok = s.repo_ok && s.posthog_ok !== false && s.sentry_ok !== false;
	return ok ? { check: "works", detail: null } : { check: "problem", detail: s.detail ?? null };
}

export function projectListView(e: Env = env()): ProjectListRow[] {
	const discovery = readDiscovery(e);
	const status = readProjectStatus(e);
	return loadProjects(e).map((p) => {
		const known = discovery?.posthog.find((k) => k.key_env === p.posthog_key_env)?.projects.find((x) => String(x.id) === String(p.posthog_project_id));
		return {
			name: p.name,
			repo: p.repo,
			enabled: p.enabled !== false,
			posthogName: p.posthog_project_id ? (known?.name ?? `Project ${p.posthog_project_id}`) : null,
			posthogKeyEnv: p.posthog_key_env ?? null,
			sentry: p.sentry ? `${p.sentry.org} / ${p.sentry.project}` : null,
			...checkOf(p, status),
		};
	});
}

export type ProjectInput = {
	name: string;
	repo: string;
	posthogKeyEnv?: string | null;
	posthogProjectId?: string | null;
	sentry?: { org: string; project: string } | null;
	coolify?: { instance: string; appUuid: string }[];
	scouts: string[];
	notes?: string;
	testCommand?: string;
	issueAuthors: string[];
};

function fail(message: string): never {
	throw new Error(message);
}

function coveringKey(keyEnv: string, id: string, d: Discovery | null): { region: "eu" | "us" } {
	const key = d?.posthog.find((k) => k.key_env === keyEnv && k.ok);
	if (!key?.projects.some((p) => String(p.id) === id)) fail("This key does not cover that PostHog project. Refresh the connections and try again.");
	if (key.region !== "eu" && key.region !== "us") fail("The region of this key is unknown. Refresh the connections.");
	return { region: key.region };
}

function posthogFields(input: ProjectInput, d: Discovery | null): Partial<Project> {
	if (!input.posthogKeyEnv && !input.posthogProjectId) return {};
	const id = String(input.posthogProjectId ?? "");
	if (!isPosthogKey(input.posthogKeyEnv) || !id) fail("Choose a PostHog project.");
	const key = coveringKey(input.posthogKeyEnv, id, d);
	return { posthog_key_env: input.posthogKeyEnv, posthog_project_id: id, posthog_region: key.region, posthog_ui: `https://${key.region}.posthog.com/project/${id}` };
}

function sentryField(input: ProjectInput, d: Discovery | null): Pick<Project, "sentry"> {
	if (!input.sentry) return {};
	const { org, project } = input.sentry;
	if (!SLUG_RE.test(org) || !SLUG_RE.test(project)) fail("The Sentry project is not valid.");
	if (!d?.sentry?.projects.some((p) => p.org === org && p.slug === project)) fail("The Sentry token does not cover that project. Refresh the connections and try again.");
	return { sentry: { org, project } };
}

type CoolifyLink = { instance?: string; app_uuid?: string };

function checkCoolifyLink(l: { instance: string; appUuid: string }, saved: CoolifyLink[], d: Discovery | null): void {
	if (!COOLIFY_NAME.test(l.instance) || !COOLIFY_UUID.test(l.appUuid)) fail("A Coolify link is not valid.");
	const listed = d?.coolify.some((i) => i.name === l.instance && i.apps.some((a) => a.uuid === l.appUuid));
	const kept = saved.some((s) => s.instance === l.instance && s.app_uuid === l.appUuid);
	if (!listed && !kept) fail("Coolify does not list that app. Refresh the connections and try again.");
}

function coolifyField(input: ProjectInput, old: Record<string, unknown> | null, d: Discovery | null): { coolify?: { instance: string; app_uuid: string }[] } {
	const links = [...new Map((input.coolify ?? []).map((l) => [`${l.instance}/${l.appUuid}`, l])).values()];
	if (links.length > 10) fail("Link at most 10 Coolify apps.");
	const saved = Array.isArray(old?.coolify) ? (old.coolify as CoolifyLink[]) : [];
	for (const l of links) checkCoolifyLink(l, saved, d);
	return links.length ? { coolify: links.map((l) => ({ instance: l.instance, app_uuid: l.appUuid })) } : {};
}

function checkIdentity(input: ProjectInput, old: Record<string, unknown> | null): void {
	if (!NAME_RE.test(input.name) || input.name.length > 60) fail("The name can have a to z, 0 to 9 and hyphens, at most 60 characters.");
	if (!REPO_RE.test(input.repo) || input.repo.length > 140) fail("Enter the repository as owner/name.");
	const known = new Set([...SCOUTS.map((s) => s.name), ...(Array.isArray(old?.scouts) ? (old.scouts as string[]) : [])]);
	if (!input.scouts.length || !input.scouts.every((s) => known.has(s))) fail("Choose at least one scout from the list.");
	checkAuthors(input.issueAuthors);
}

function checkAuthors(authors: string[]): void {
	if (!authors.length || !authors.every((a) => (ISSUE_AUTHORS as readonly string[]).includes(a))) fail("Choose at least one issue author type.");
}

// Return the new project object. It keeps the fields of the old one that the form does not edit.
export function buildProject(input: ProjectInput, old: Record<string, unknown> | null, d: Discovery | null): Record<string, unknown> {
	checkIdentity(input, old);
	const notes = (input.notes ?? "").trim();
	const testCommand = (input.testCommand ?? "").trim();
	if (notes.length > 2000) fail("The notes can have at most 2000 characters.");
	if (testCommand.length > 500 || /[\r\n]/.test(testCommand)) fail("The test command must be one line, at most 500 characters.");
	const { posthog_key_env: _k, posthog_project_id: _i, posthog_region: _r, posthog_ui: _u, sentry: _s, coolify: _c, test_command: _t, ...rest } = old ?? {};
	return {
		...rest,
		name: input.name,
		repo: input.repo,
		notes,
		scouts: [...new Set(input.scouts)],
		issue_authors: [...new Set(input.issueAuthors)],
		...(testCommand ? { test_command: testCommand } : {}),
		...posthogFields(input, d),
		...sentryField(input, d),
		...coolifyField(input, old, d),
	};
}

function writeProjects(list: Record<string, unknown>[], e: Env): void {
	writeJsonAtomic(`${e.stateRoot}/projects.json`, list);
}

export function createProject(input: ProjectInput, e: Env = env()): { name: string } {
	const list = rawProjects(e);
	if (list.some((p) => p.name === input.name)) fail("A project with this name exists.");
	list.push(buildProject(input, null, readDiscovery(e)));
	writeProjects(list, e);
	// A new project starts in dry mode.
	updateProject(input.name, "dry", false, e);
	return { name: input.name };
}

export function editProject(input: ProjectInput, e: Env = env()): { name: string } {
	const list = rawProjects(e);
	const at = list.findIndex((p) => p.name === input.name);
	if (at < 0) fail("Unknown project.");
	list[at] = buildProject(input, list[at], readDiscovery(e));
	writeProjects(list, e);
	return { name: input.name };
}

export function setEnabled(name: string, enabled: boolean, e: Env = env()): void {
	const list = rawProjects(e);
	const at = list.findIndex((p) => p.name === name);
	if (at < 0) fail("Unknown project.");
	list[at] = { ...list[at], enabled };
	writeProjects(list, e);
}

// The state folder and the pending items stay.
export function removeProject(name: string, confirm: string, e: Env = env()): void {
	if (confirm !== name) fail("Type the project name to confirm.");
	const list = rawProjects(e);
	if (!list.some((p) => p.name === name)) fail("Unknown project.");
	writeProjects(
		list.filter((p) => p.name !== name),
		e,
	);
}
