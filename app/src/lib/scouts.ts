export type ScoutInfo = { name: string; label: string; description: string };

// The UI container has no skills folder, so the known scouts live here.
export const SCOUTS: ScoutInfo[] = [
	{ name: "signals-scout-error-tracking", label: "Error tracking", description: "Finds new and rising errors and proposes the fix." },
	{ name: "signals-scout-web-vitals", label: "Web vitals", description: "Finds pages with slow loading or layout shifts." },
	{ name: "signals-scout-product-analytics", label: "Product analytics", description: "Finds funnel drops and broken events." },
	{ name: "signals-scout-session-replay", label: "Session replay", description: "Finds frustrated sessions, such as rage clicks." },
	{ name: "signals-scout-logs", label: "Logs", description: "Finds error patterns in the service logs." },
	{ name: "signals-scout-observability-gaps", label: "Observability gaps", description: "Finds code paths that no signal covers." },
	{ name: "instrumentation-gaps", label: "Instrumentation gaps", description: "Finds missing events, logs and error capture." },
	{ name: "coolify", label: "Coolify", description: "Finds failed deployments, restart loops, new errors and risky settings of linked Coolify apps." },
	{ name: "github-issues", label: "GitHub issues", description: "Triages new issues and links them to findings." },
	{ name: "warden-ci", label: "CI follow-up", description: "Follows up on failed checks of Warden pull requests." },
];

export const PRESETS: { label: string; scouts: string[] }[] = [
	{ label: "Web app", scouts: ["signals-scout-error-tracking", "signals-scout-web-vitals", "signals-scout-product-analytics", "signals-scout-session-replay", "signals-scout-observability-gaps", "instrumentation-gaps", "github-issues", "warden-ci"] },
	{ label: "Backend", scouts: ["signals-scout-error-tracking", "signals-scout-logs", "signals-scout-observability-gaps", "instrumentation-gaps", "warden-ci"] },
	{ label: "Bot or worker", scouts: ["signals-scout-error-tracking", "signals-scout-product-analytics", "instrumentation-gaps", "github-issues", "warden-ci"] },
];

export const ISSUE_AUTHORS = ["OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR"] as const;
export const DEFAULT_AUTHORS = ["OWNER", "MEMBER", "COLLABORATOR"];

export const SCOUT_LABELS: Record<string, string> = Object.fromEntries(SCOUTS.map((s) => [s.name, s.label]));

export const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
