import type { GhInfo, GhState } from "./gh";

export type Mode = "dry" | "issues" | "prs";
export type ItemKind = "issue" | "comment" | "pr" | "pr-update";
export type ItemStatus = "pending" | "approved" | "submitting" | "submitted" | "rejected" | "stale" | "error";
export type Severity = "high" | "medium" | "low";
export type CellState = "ok" | "error" | "running" | "requested" | "late" | "never" | "skipped";
export type RunStatus = "ok" | "error" | "skipped";

export type SentryRef = { org: string; project: string };

export type Project = {
	name: string;
	repo: string;
	posthog_project_id?: string;
	posthog_key_env?: string;
	posthog_ui?: string;
	posthog_region?: "eu" | "us";
	notes?: string;
	scouts: string[];
	issue_authors?: string[];
	test_command?: string;
	test_install?: string;
	sentry?: SentryRef;
	enabled?: boolean;
	coolify?: { instance: string; app_uuid: string }[];
};

export type Finding = {
	fingerprint?: string;
	action?: string;
	severity?: string;
	title?: string;
	number?: number | null;
	url?: string | null;
};

export type Run = {
	id: string;
	started: string;
	ended?: string | null;
	project: string;
	scout: string;
	mode?: string;
	status: RunStatus;
	error?: string | null;
	summary?: string | null;
	turns?: number | null;
	cost_usd?: number | null;
	findings: Finding[];
};

export type ItemMeta = {
	kind: ItemKind;
	fingerprint: string;
	project: string;
	scout: string;
	title: string;
	body: string;
	footer?: string | null;
	edited_at?: string | null;
	feedback_recorded?: boolean;
	number?: number | null;
	severity?: string;
	base_sha?: string;
	related_issue?: string | number | null;
	created?: string;
	decided_at?: string | null;
	submitted_at?: string | null;
	stale_at?: string | null;
	status: ItemStatus;
	url?: string | null;
	error?: string | null;
	reject_reason?: string | null;
	gh_state?: string;
	gh_state_reason?: string | null;
	gh_state_at?: string | null;
	synced_at?: string | null;
};

export type ItemSummary = Omit<ItemMeta, "body"> & { id: string; files?: number; add?: number; del?: number };

export type TestStatus = "queued" | "running" | "pass" | "fail" | "error" | "skipped";
export type TestResult = {
	status: TestStatus;
	reason: string | null;
	command: string | null;
	started: string | null;
	ended: string | null;
	exit_code: number | null;
	output_tail: string;
};

export type ItemDetail = ItemSummary & {
	body: string;
	diff: string | null;
	repo: string;
	branch: string;
	run: Run | null;
	tests: TestResult | null;
	staleDays: number;
	pendingTotal: number;
	nextPendingId: string | null;
};

export type ScoutCell = { scout: string; state: CellState; at: string | null; runId: string | null };

export type ProjectRow = {
	name: string;
	repo: string;
	mode: Mode;
	autoSubmit: boolean;
	enabled: boolean;
	cells: ScoutCell[];
};

export type Attention =
	| { type: "item"; item: ItemSummary }
	| { type: "run"; run: Run };

export type FindingRow = Finding & {
	id: string;
	runId: string;
	project: string;
	scout: string;
	at: string;
	itemId: string | null;
	gh?: GhInfo | null;
	itemStatus?: ItemStatus | null;
};

export type Shell = { pendingCount: number; nextRunAt: string | null; intervalHours: number };

export type Overview = {
	projects: ProjectRow[];
	attention: Attention[];
	recent: FindingRow[];
	scoutCount: number;
	lastRunAt: string | null;
	nextRunAt: string | null;
	intervalHours: number;
	cycleCreated: { issues: number; comments: number; prs: number };
	failedRuns: number;
	lastDecision: { status: ItemStatus; title: string; at: string | null } | null;
	cost: { today: number; cap: number | null };
};

export type CostView = { days: { date: string; usd: number }[]; today: number; total: number; cap: number | null };

export type FindingsFilter = { project?: string; scout?: string; severity?: string; action?: string; q?: string; gh?: GhState };
export type FindingsPage = { rows: FindingRow[]; total: number; hidden: number; next: number | null };
export type RunsFilter = { project?: string; scout?: string; status?: string };
export type RunDetail = { run: Run; recent: Run[]; maxTurns: number };

export type ScoutRow = { scout: string; state: CellState; lastAt: string | null; lastRunId: string | null; fails: number; lastGood: string | null };

export type ProjectConnection = {
	posthog_key_env: string | null;
	posthog_project_id: string | null;
	posthog_region: "eu" | "us" | null;
	sentry: SentryRef | null;
	coolify: { instance: string; app_uuid: string }[];
	scouts: string[];
	notes: string;
	test_command: string;
	issue_authors: string[];
	enabled: boolean;
};

export type ProjectDetail = {
	name: string;
	repo: string;
	posthog_ui: string | null;
	posthog_project_id: string | null;
	mode: Mode;
	autoSubmit: boolean;
	scouts: ScoutRow[];
	nextRunAt: string | null;
	intervalHours: number;
	all: { name: string; mode: Mode }[];
	connection: ProjectConnection;
};

export type SecretSource = "env" | "ui" | "unset";
export type SecretState = "ok" | "warn" | "invalid" | "error" | null;
export type SecretRow = { key: string; source: SecretSource; state: SecretState; detail: string | null; updatedAt: string | null; pending: boolean };

export type IntegrationsView = {
	hermesUrl: string | null;
	hermesUrlSource: SecretSource;
	wardenUrl: string | null;
	wardenUrlSource: SecretSource;
	test: { requested: boolean; requestedAt: string | null; result: { ok: boolean; status: string; at: string | null } | null };
};

export type PosthogProjectRef = { id: string | number; name: string; org_id?: string; org_name?: string };
export type Discovery = {
	updated_at: string | null;
	github: { ok: boolean; login?: string | null; detail?: string | null } | null;
	posthog: { key_env: string; source?: string; ok: boolean; detail?: string | null; region?: string; projects: PosthogProjectRef[] }[];
	sentry: { ok: boolean; detail?: string | null; projects: { org: string; slug: string; name?: string; platform?: string }[] } | null;
	coolify: CoolifyDiscovery[];
};

export type CheckStatus = { hash?: string; repo_ok: boolean; posthog_ok: boolean | null; sentry_ok: boolean | null; detail?: string | null; checked_at?: string | null };

export type ProjectListRow = {
	name: string;
	repo: string;
	enabled: boolean;
	posthogName: string | null;
	posthogKeyEnv: string | null;
	sentry: string | null;
	check: "works" | "problem" | "checking";
	detail: string | null;
};

export type Connections = {
	discovery: Discovery | null;
	usedKeyEnvs: string[];
	sentryTokenSet: boolean;
	names: string[];
};

export type CoolifyAppRef = { uuid: string; name: string; repo: string | null; fqdn: string; status: string; build_pack: string | null };
export type CoolifyDiscovery = { name: string; url: string; ok: boolean; detail: string | null; apps: CoolifyAppRef[] };
// An instance in settings.json and the state of its token. The token itself never leaves the runner.
export type CoolifyRow = { name: string; url: string; key: string; token: SecretRow; apps: number | null; detail: string | null };
