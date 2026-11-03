import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import parseDiff from "parse-diff";
import type { CostView, ItemDetail, ItemMeta, ItemSummary, Mode, Project, Run, TestResult, TestStatus } from "@/lib/types";
import { type Env, env } from "./env";
import { readJson, readText, writeJsonAtomic } from "./fsio";
import { isName, RUN_ID, stateDir } from "./paths";

export { writeJsonAtomic };

// The live file in the state folder wins. The file from the image is the fallback.
export function projectsPath(e: Env): string {
	const live = `${e.stateRoot}/projects.json`;
	return existsSync(live) ? live : e.projectsFile;
}

export function rawProjects(e: Env = env()): Record<string, unknown>[] {
	const list = readJson<unknown>(projectsPath(e), []);
	return Array.isArray(list) ? list.filter((p) => p && typeof p === "object") : [];
}

export function loadProjects(e: Env = env()): Project[] {
	return rawProjects(e).filter((p): p is Project => isName(p.name) && Array.isArray(p.scouts));
}

export const isEnabled = (p: Project): boolean => p.enabled !== false;

function derivedId(r: { started: string; project: string; scout: string }): string {
	const stamp = new Date(r.started).toISOString().replace(/[-:]|\.\d+/g, "");
	return `${stamp}-${r.project}-${r.scout}`;
}

function toRun(raw: Record<string, unknown>): Run | null {
	const started = String(raw.started ?? "");
	if (Number.isNaN(Date.parse(started)) || typeof raw.project !== "string" || typeof raw.scout !== "string") return null;
	const id = typeof raw.id === "string" && RUN_ID.test(raw.id) ? raw.id : derivedId({ started, project: raw.project, scout: raw.scout });
	return { ...raw, id, started, project: raw.project, scout: raw.scout, status: raw.status === "error" || raw.status === "skipped" ? raw.status : "ok", findings: Array.isArray(raw.findings) ? raw.findings : [] } as Run;
}

// Newest first.
export function loadRuns(e: Env = env()): Run[] {
	const runs: Run[] = [];
	for (const line of readText(`${e.stateRoot}/runs.jsonl`).split("\n")) {
		try {
			const raw = JSON.parse(line);
			const run = raw && typeof raw === "object" ? toRun(raw) : null;
			if (run) runs.push(run);
		} catch {
			// A partial or blank line is not a run.
		}
	}
	return runs.sort((a, b) => Date.parse(b.started) - Date.parse(a.started));
}

export function lastRunAt(e: Env = env()): string | null {
	const stamp = Number.parseInt(readText(`${e.stateRoot}/last-run`).trim(), 10);
	return Number.isFinite(stamp) && stamp > 0 ? new Date(stamp * 1000).toISOString() : null;
}

export function nextRunAt(e: Env = env()): string | null {
	const last = lastRunAt(e);
	return last ? new Date(Date.parse(last) + e.intervalHours * 3_600_000).toISOString() : null;
}

export type Settings = { daily_cost_cap_usd?: number; stale_days?: number; reject_days?: number; hermes_webhook_url?: string; warden_url?: string; coolify?: { name: string; url: string }[]; projects?: Record<string, { mode?: Mode; auto_submit?: boolean; auto_submit_prs?: boolean }> };

export function costCap(e: Env = env()): number | null {
	const cap = readJson<Settings>(`${e.stateRoot}/settings.json`, {}).daily_cost_cap_usd;
	return typeof cap === "number" && Number.isFinite(cap) && cap > 0 ? cap : null;
}

// Read the file at write time and change only the keys the callback touches. Never write a stale copy.
export function mergeSettings(e: Env, change: (fresh: Settings) => Settings): void {
	const path = `${e.stateRoot}/settings.json`;
	writeJsonAtomic(path, change(readJson<Settings>(path, {})));
}

// null removes the cap. Other settings stay.
export function setCostCap(cap: number | null, e: Env = env()): number | null {
	if (cap !== null && !(Number.isFinite(cap) && cap > 0 && cap <= 100_000)) throw new Error("Enter an amount above 0, or leave the field empty.");
	mergeSettings(e, (fresh) => {
		const { daily_cost_cap_usd: _old, ...rest } = fresh;
		return cap === null ? rest : { ...rest, daily_cost_cap_usd: Math.round(cap * 100) / 100 };
	});
	return costCap(e);
}

// Failures in a row and the last good run of a scout. The runner writes health.json. Wrong values count as missing.
export function scoutHealth(project: string, scout: string, e: Env = env()): { fails: number; lastGood: string | null } {
	const raw = readJson<Record<string, { fails?: unknown; last_good?: unknown }> | null>(`${e.stateRoot}/health.json`, null)?.[`${project}/${scout}`];
	const good = typeof raw?.last_good === "string" && !Number.isNaN(Date.parse(raw.last_good)) ? raw.last_good : null;
	return { fails: typeof raw?.fails === "number" && raw.fails > 0 ? Math.floor(raw.fails) : 0, lastGood: good };
}

// Days after which a pending item turns stale. The runner reads the same key. Default 30.
export function staleDays(e: Env = env()): number {
	const d = readJson<Settings>(`${e.stateRoot}/settings.json`, {}).stale_days;
	return typeof d === "number" && d >= 1 ? Math.floor(d) : 30;
}

export function setStaleDays(days: number, e: Env = env()): number {
	if (!(Number.isInteger(days) && days >= 1 && days <= 3650)) throw new Error("Enter a whole number of days from 1 to 3650.");
	mergeSettings(e, (fresh) => ({ ...fresh, stale_days: days }));
	return staleDays(e);
}

// Days for which a rejected item blocks its fingerprint. The runner reads the same key. Default 30.
export function rejectDays(e: Env = env()): number {
	const d = readJson<Settings>(`${e.stateRoot}/settings.json`, {}).reject_days;
	return typeof d === "number" && d >= 0 ? Math.floor(d) : 30;
}

export function setRejectDays(days: number, e: Env = env()): number {
	if (!(Number.isInteger(days) && days >= 0 && days <= 3650)) throw new Error("Enter a whole number of days from 0 to 3650.");
	mergeSettings(e, (fresh) => ({ ...fresh, reject_days: days }));
	return rejectDays(e);
}

// Creation time of an item: the created field, then the UTC stamp at the end of the id, then the mtime of the item
// directory. The mtime of meta.json does not count: an edit or a decision rewrites it. Same order as lib.sh.
export function itemCreatedMs(dir: string, id: string, created?: string): number {
	const c = Date.parse(created ?? "");
	if (!Number.isNaN(c)) return c;
	const m = /-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:-\d+)?$/.exec(id);
	if (m) {
		const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
		const t = Date.UTC(y, mo - 1, d, h, mi, s);
		if (!Number.isNaN(t)) return t;
	}
	try {
		return statSync(dir).mtimeMs;
	} catch {
		return Date.now();
	}
}

// Notional cost per UTC day for the last 14 days, oldest first.
export function costView(e: Env = env(), now = Date.now()): CostView {
	const days = Array.from({ length: 14 }, (_, i) => ({ date: new Date(now - (13 - i) * 86_400_000).toISOString().slice(0, 10), usd: 0 }));
	for (const r of loadRuns(e)) {
		const day = days.find((d) => d.date === new Date(r.started).toISOString().slice(0, 10));
		if (day && typeof r.cost_usd === "number") day.usd += r.cost_usd;
	}
	return { days, today: days[13].usd, total: days.reduce((n, d) => n + d.usd, 0), cap: costCap(e) };
}

const isMode = (m: unknown): m is Mode => m === "dry" || m === "issues" || m === "prs";

export function projectSettings(name: string, e: Env = env()): { mode: Mode; autoSubmit: boolean } {
	const s = readJson<Settings>(`${e.stateRoot}/settings.json`, {}).projects?.[name];
	const mode = isMode(s?.mode) ? s.mode : e.mode;
	return { mode, autoSubmit: mode !== "dry" && (s?.auto_submit === true || s?.auto_submit_prs === true) };
}

export function updateProject(name: string, mode: Mode, autoSubmit: boolean, e: Env = env()): { mode: Mode; autoSubmit: boolean } {
	if (!loadProjects(e).some((p) => p.name === name)) throw new Error("unknown project");
	if (!["dry", "issues", "prs"].includes(mode)) throw new Error("bad mode");
	const auto = mode !== "dry" && autoSubmit;
	mergeSettings(e, (fresh) => {
		// Merge into the old object, so unknown keys stay. The old key auto_submit_prs goes away.
		const { auto_submit_prs: _legacy, ...rest } = fresh.projects?.[name] ?? {};
		return { ...fresh, projects: { ...fresh.projects, [name]: { ...rest, mode, auto_submit: auto } } };
	});
	return { mode, autoSubmit: auto };
}

export class ConflictError extends Error {
	readonly status = 409;
	constructor() {
		super("This item changed. Reload the page.");
	}
}

// Re-read right before the rename. The runner may have changed the item since the action began.
export function writeMetaChecked(dir: string, from: ItemMeta, next: ItemMeta): void {
	const path = `${dir}/meta.json`;
	const now = readJson<ItemMeta | null>(path, null);
	if (!now || now.status !== from.status || now.edited_at !== from.edited_at) throw new ConflictError();
	writeJsonAtomic(path, next);
}

export type RunState = "idle" | "requested" | "running";

export function runState(project: string, scout: string, e: Env = env()): RunState {
	if (!isName(project) || !isName(scout)) return "idle";
	if (existsSync(`${e.stateRoot}/running/${project}__${scout}.json`)) return "running";
	if (existsSync(`${e.stateRoot}/requests/${project}__${scout}.json`)) return "requested";
	return "idle";
}

// Idempotent: a scout that runs or has a request is left alone.
export function startRun(project: string, scout: string, e: Env = env()): RunState {
	const p = loadProjects(e).find((x) => x.name === project);
	if (!p || !p.scouts.includes(scout) || !isName(scout)) throw new Error("unknown project or scout");
	if (!isEnabled(p)) throw new Error("The project is disabled.");
	const state = runState(project, scout, e);
	if (state !== "idle") return state;
	mkdirSync(`${e.stateRoot}/requests`, { recursive: true });
	writeJsonAtomic(`${e.stateRoot}/requests/${project}__${scout}.json`, { requested_at: new Date().toISOString() });
	return "requested";
}

function diffStats(text: string): { files: number; add: number; del: number } {
	const files = parseDiff(text);
	return { files: files.length, add: files.reduce((n, f) => n + f.additions, 0), del: files.reduce((n, f) => n + f.deletions, 0) };
}

function readItem(e: Env, project: string, id: string): ItemMeta | null {
	const meta = readJson<ItemMeta | null>(`${stateDir(e.stateRoot, project, "pending", id)}/meta.json`, null);
	return meta && typeof meta === "object" ? { ...meta, kind: meta.kind ?? "pr", project } : null;
}

function names(path: string): string[] {
	try {
		return readdirSync(path).filter(isName);
	} catch {
		return [];
	}
}

export const hasDiff = (kind: ItemMeta["kind"]): boolean => kind === "pr" || kind === "pr-update";

const TEST_STATUS: TestStatus[] = ["queued", "running", "pass", "fail", "error", "skipped"];
const OUTPUT_LIMIT = 20_000;

const str = (v: unknown, max = 2000): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);

// The result file is untrusted. Keep only known fields, as plain text.
export function readTestResult(project: string, id: string, e: Env = env()): TestResult | null {
	if (!isName(project) || !isName(id)) return null;
	const raw = readJson<Record<string, unknown> | null>(`${e.testsRoot}/results/${project}/${id}.json`, null);
	if (!raw || typeof raw !== "object" || !TEST_STATUS.includes(raw.status as TestStatus)) return null;
	const out = typeof raw.output_tail === "string" ? raw.output_tail.slice(-OUTPUT_LIMIT) : "";
	return {
		status: raw.status as TestStatus,
		reason: str(raw.reason),
		command: str(raw.command),
		started: str(raw.started, 40),
		ended: str(raw.ended, 40),
		exit_code: typeof raw.exit_code === "number" ? raw.exit_code : null,
		output_tail: out,
	};
}

export const TITLE_MAX = 300;
export const BODY_MAX = 60_000;

// Only a pending item can change. The runner reads the new text when it submits.
export function editItem(id: string, project: string | undefined, title: string, body: string, e: Env = env(), now = new Date()): ItemMeta {
	const found = findItem(id, project, e);
	if (!found) throw new Error("not found");
	if (found.meta.status !== "pending") throw new Error(`item is ${found.meta.status}`);
	const t = title.trim();
	if (!t) throw new Error("The title cannot be empty.");
	if (t.length > TITLE_MAX || t.includes("\n")) throw new Error(`The title must be one line, at most ${TITLE_MAX} characters.`);
	if (!body.trim()) throw new Error("The body cannot be empty.");
	if (body.length > BODY_MAX) throw new Error(`The body can have at most ${BODY_MAX} characters.`);
	const next: ItemMeta = { ...found.meta, title: t, body, edited_at: now.toISOString() };
	writeMetaChecked(stateDir(e.stateRoot, found.project, "pending", id), found.meta, next);
	return next;
}

// Newest first. The listing comes from projects.json and strict names, never from a user path.
export function listItems(e: Env = env()): ItemSummary[] {
	const items: ItemSummary[] = [];
	for (const p of loadProjects(e)) {
		for (const id of names(stateDir(e.stateRoot, p.name) + "/pending")) {
			const meta = readItem(e, p.name, id);
			if (!meta) continue;
			const { body: _body, ...summary } = meta;
			const stats = hasDiff(meta.kind) ? diffStats(readText(`${stateDir(e.stateRoot, p.name, "pending", id)}/patch.diff`)) : {};
			items.push({ ...summary, ...stats, id });
		}
	}
	return items.sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

export function findItem(id: string, project: string | undefined, e: Env = env()): { project: string; id: string; meta: ItemMeta } | null {
	if (!isName(id)) return null;
	for (const p of loadProjects(e)) {
		if (project && p.name !== project) continue;
		const meta = readItem(e, p.name, id);
		if (meta) return { project: p.name, id, meta };
	}
	return null;
}

export function itemDetail(id: string, project: string | undefined, e: Env = env()): ItemDetail | null {
	const found = findItem(id, project, e);
	if (!found) return null;
	const { meta } = found;
	const dir = stateDir(e.stateRoot, found.project, "pending", id);
	const diff = hasDiff(meta.kind) ? readText(`${dir}/patch.diff`) || null : null;
	const waiting = listItems(e).filter((i) => i.status === "pending");
	const next = waiting.find((i) => i.id !== id);
	const run = loadRuns(e).find((r) => r.project === found.project && r.scout === meta.scout && r.findings.some((f) => f.fingerprint === meta.fingerprint)) ?? null;
	return {
		...meta,
		id,
		diff,
		...(diff ? diffStats(diff) : {}),
		repo: loadProjects(e).find((p) => p.name === found.project)?.repo ?? "",
		branch: `warden/${meta.fingerprint}`,
		run,
		tests: hasDiff(meta.kind) ? readTestResult(found.project, id, e) : null,
		staleDays: staleDays(e),
		pendingTotal: waiting.length,
		nextPendingId: next ? next.id : null,
	};
}

// A stale item, or a pending item past stale_days that the runner has not marked yet, cannot be approved.
function assertNotStale(found: { project: string; id: string; meta: ItemMeta }, e: Env, now: number): void {
	const days = staleDays(e);
	const dir = stateDir(e.stateRoot, found.project, "pending", found.id);
	const old = found.meta.status === "pending" && now - itemCreatedMs(dir, found.id, found.meta.created) > days * 86_400_000;
	if (found.meta.status === "stale" || old) throw new Error(`This item is older than ${days} days. Ask for a new run.`);
}

// Approve a pending item or retry an item with an error. Reject only a pending item.
export function decide(id: string, project: string | undefined, action: "approve" | "reject", reason: string | undefined, e: Env = env(), now = Date.now()): ItemMeta {
	const found = findItem(id, project, e);
	if (!found) throw new Error("not found");
	const { meta } = found;
	if (action === "approve") assertNotStale(found, e, now);
	const allowed = meta.status === "pending" || (action === "approve" && meta.status === "error");
	if (!allowed) throw new Error(`item is ${meta.status}`);
	const decided_at = new Date(now).toISOString();
	const next: ItemMeta =
		action === "approve"
			? { ...meta, status: "approved", error: null, decided_at }
			: { ...meta, status: "rejected", decided_at, ...(reason?.trim() ? { reject_reason: reason.trim().slice(0, 500) } : {}) };
	writeMetaChecked(stateDir(e.stateRoot, found.project, "pending", id), found.meta, next);
	return next;
}
