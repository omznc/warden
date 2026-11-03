import { findingState, type GhInfo, parseGh } from "@/lib/gh";
import { actionGroup, LATE_HOURS, normSeverity } from "@/lib/format";
import type {
	Attention,
	CellState,
	FindingRow,
	FindingsFilter,
	FindingsPage,
	ItemSummary,
	Overview,
	ProjectDetail,
	ProjectRow,
	Run,
	RunDetail,
	RunsFilter,
	ScoutCell,
	Shell,
} from "@/lib/types";
import { DEFAULT_AUTHORS } from "@/lib/scouts";
import { type Env, env } from "./env";
import { RUN_ID } from "./paths";
import { costCap, costView, isEnabled, lastRunAt, listItems, loadProjects, loadRuns, nextRunAt, projectSettings, runState, scoutHealth } from "./store";

const PAGE = 50;

function cellState(run: Run | undefined, project: string, scout: string, e: Env, now: number): CellState {
	const live = runState(project, scout, e);
	if (live !== "idle") return live;
	if (!run) return "never";
	if (run.status === "error") return "error";
	if (run.status === "skipped") return "skipped";
	const at = Date.parse(run.ended ?? run.started);
	return now - at > LATE_HOURS * 3_600_000 ? "late" : "ok";
}

function latestByScout(runs: Run[]): Map<string, Run> {
	const map = new Map<string, Run>();
	for (const r of runs) if (!map.has(`${r.project}/${r.scout}`)) map.set(`${r.project}/${r.scout}`, r);
	return map;
}

function cellFor(latest: Map<string, Run>, project: string, scout: string, e: Env, now: number): ScoutCell {
	const run = latest.get(`${project}/${scout}`);
	return { scout, state: cellState(run, project, scout, e, now), at: run ? (run.ended ?? run.started) : null, runId: run?.id ?? null };
}

export function shellView(e: Env = env()): Shell {
	const pendingCount = listItems(e).filter((i) => i.status === "pending").length;
	return { pendingCount, nextRunAt: nextRunAt(e), intervalHours: e.intervalHours };
}

const ghOf = (i: ItemSummary | undefined): GhInfo | null => (i?.status === "submitted" ? parseGh(i) : null);

function findingRows(runs: Run[], items: ItemSummary[]): FindingRow[] {
	// Several items can share one fingerprint. The list is newest first: keep the newest.
	const byFp = new Map<string, ItemSummary>();
	for (const i of items) if (!byFp.has(`${i.project}/${i.fingerprint}`)) byFp.set(`${i.project}/${i.fingerprint}`, i);
	return runs.flatMap((r) =>
		r.findings.map((f, i) => ({
			...f,
			id: `${r.id}:${i}`,
			runId: r.id,
			project: r.project,
			scout: r.scout,
			at: r.ended ?? r.started,
			itemId: byFp.get(`${r.project}/${f.fingerprint}`)?.id ?? null,
			gh: ghOf(byFp.get(`${r.project}/${f.fingerprint}`)),
			itemStatus: byFp.get(`${r.project}/${f.fingerprint}`)?.status ?? null,
		})),
	);
}

function attentionOf(items: ItemSummary[], runs: Run[]): Attention[] {
	const open = items.filter((i) => i.status === "pending" || i.status === "error");
	const failed = [...latestByScout(runs).values()].filter((r) => r.status === "error");
	open.sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
	return [...open.map((item): Attention => ({ type: "item", item })), ...failed.map((run): Attention => ({ type: "run", run }))];
}

function cycleCounts(runs: Run[], since: number): Overview["cycleCreated"] {
	const out = { issues: 0, comments: 0, prs: 0 };
	for (const r of runs) {
		if (Date.parse(r.started) < since) continue;
		for (const f of r.findings) {
			if (f.action === "issue") out.issues++;
			else if (f.action === "comment") out.comments++;
			else if (f.action === "pr") out.prs++;
		}
	}
	return out;
}

export function overviewView(e: Env = env(), now = Date.now()): Overview {
	const projects = loadProjects(e);
	const runs = loadRuns(e);
	const items = listItems(e);
	const latest = latestByScout(runs);
	const rows: ProjectRow[] = projects.map((p) => ({
		name: p.name,
		repo: p.repo,
		...projectSettings(p.name, e),
		enabled: isEnabled(p),
		cells: p.scouts.map((s) => cellFor(latest, p.name, s, e, now)),
	}));
	const last = lastRunAt(e);
	const since = (last ? Date.parse(last) : now) - e.intervalHours * 3_600_000;
	const decided = items.find((i) => i.status === "submitted" || i.status === "rejected" || i.status === "approved");
	const attention = attentionOf(items, runs);
	return {
		projects: rows,
		attention,
		recent: findingRows(runs, items)
			.filter((f) => actionGroup(f.action) !== "skipped" && actionGroup(f.action) !== "blocked")
			.slice(0, 5),
		scoutCount: projects.reduce((n, p) => n + p.scouts.length, 0),
		lastRunAt: last,
		nextRunAt: nextRunAt(e),
		intervalHours: e.intervalHours,
		cycleCreated: cycleCounts(runs, since),
		failedRuns: attention.filter((a) => a.type === "run").length,
		lastDecision: decided ? { status: decided.status, title: decided.title, at: decided.created ?? null } : null,
		cost: { today: costView(e, now).today, cap: costCap(e) },
	};
}

function severityOk(f: FindingRow, severity: string | undefined): boolean {
	const sev = severity?.split(",").filter(Boolean);
	return !sev?.length || sev.includes(normSeverity(f.severity));
}

function textOk(f: FindingRow, text: string | undefined): boolean {
	const needle = text?.trim().toLowerCase();
	return !needle || `${f.title ?? ""} ${f.fingerprint ?? ""}`.toLowerCase().includes(needle);
}

function matches(f: FindingRow, q: FindingsFilter): boolean {
	return (!q.project || f.project === q.project) && (!q.scout || f.scout === q.scout) && severityOk(f, q.severity) && textOk(f, q.q) && (!q.gh || f.gh?.state === q.gh);
}

// action: "" hides skipped and blocked findings. "all" shows everything.
function actionOk(f: FindingRow, action: string | undefined): boolean {
	const live = findingState(f).kind !== "action";
	const group = live && actionGroup(f.action) === "pending" ? "other" : actionGroup(f.action);
	if (!action) return group !== "skipped" && group !== "blocked";
	return action === "all" || action === group;
}

export function findingsView(q: FindingsFilter, cursor: number, e: Env = env()): FindingsPage {
	const all = findingRows(loadRuns(e), listItems(e)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
	const base = all.filter((f) => matches(f, q));
	const shown = base.filter((f) => actionOk(f, q.action));
	const start = Math.max(0, Math.floor(cursor) || 0);
	return {
		rows: shown.slice(start, start + PAGE),
		total: shown.length,
		hidden: all.length - shown.length,
		next: start + PAGE < shown.length ? start + PAGE : null,
	};
}

export function runsView(q: RunsFilter, e: Env = env()): Run[] {
	return loadRuns(e)
		.filter((r) => (!q.project || r.project === q.project) && (!q.scout || r.scout === q.scout) && (!q.status || r.status === q.status))
		.slice(0, 200);
}

export function runView(id: string, e: Env = env()): RunDetail | null {
	if (!RUN_ID.test(id)) return null;
	const runs = loadRuns(e);
	const run = runs.find((r) => r.id === id);
	if (!run) return null;
	return { run, recent: runs.filter((r) => r.project === run.project && r.scout === run.scout).slice(0, 6), maxTurns: e.maxTurns };
}

export function projectView(name: string, e: Env = env(), now = Date.now()): ProjectDetail | null {
	const projects = loadProjects(e);
	const p = projects.find((x) => x.name === name);
	if (!p) return null;
	const latest = latestByScout(loadRuns(e));
	return {
		name: p.name,
		repo: p.repo,
		posthog_ui: p.posthog_ui ?? null,
		posthog_project_id: p.posthog_project_id ?? null,
		...projectSettings(p.name, e),
		scouts: p.scouts.map((s) => {
			const c = cellFor(latest, p.name, s, e, now);
			return { scout: s, state: c.state, lastAt: c.at, lastRunId: c.runId, ...scoutHealth(p.name, s, e) };
		}),
		nextRunAt: nextRunAt(e),
		intervalHours: e.intervalHours,
		all: projects.map((x) => ({ name: x.name, mode: projectSettings(x.name, e).mode })),
		connection: {
			posthog_key_env: p.posthog_key_env ?? null,
			posthog_project_id: p.posthog_project_id ? String(p.posthog_project_id) : null,
			posthog_region: p.posthog_region ?? null,
			sentry: p.sentry ?? null,
			coolify: Array.isArray(p.coolify) ? p.coolify : [],
			scouts: p.scouts,
			notes: p.notes ?? "",
			test_command: p.test_command ?? "",
			issue_authors: p.issue_authors ?? DEFAULT_AUTHORS,
			enabled: isEnabled(p),
		},
	};
}
