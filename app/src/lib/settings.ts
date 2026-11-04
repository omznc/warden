export const URL_MAX = 500;
// Same rule as url_ok in bin/lib.sh: http or https, a plain host, no user info, no space.
const URL_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[^\s"<>\\]*)?$/;

// An empty text removes the setting. Returns an error text, or null when the value is fine.
export function urlError(value: string): string | null {
	const v = value.trim();
	if (v === "") return null;
	if (v.length > URL_MAX) return `The URL can have at most ${URL_MAX} characters.`;
	if (!URL_RE.test(v)) return "Enter a http or https URL with a plain host, for example https://hermes.example.com/webhook. No user name or password in the URL.";
	return null;
}

export const NOTIFY_STATUS = /^(\d{3}|none|nosecret)$/;

// The test result as the UI shows it. The text never has a response body.
export function notifyResultText(r: { ok: boolean; status: string }): string {
	if (r.ok) return `Sent. The webhook answered HTTP ${r.status}.`;
	if (r.status === "none") return "No webhook URL is set.";
	if (r.status === "nosecret") return "The webhook secret is not set.";
	if (r.status === "000") return "No answer from the webhook. Check the URL and the network.";
	return `The webhook answered HTTP ${r.status}.`;
}

// The runner handles a test request between scout runs. After this time the page stops waiting.
export const TEST_WAIT_MS = 600_000;

// Fix runs: a run in project mode prs with a scout from this list uses this model and effort.
// The runner reads the same key (agent_model in bin/lib.sh). Keep the defaults in step with it.
export const FIX_MODELS = ["opus", "sonnet", "haiku"] as const;
export const FIX_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const FIX_SCOUT_RE = /^[a-z0-9][a-z0-9-]*$/;
export type FixRuns = { model: (typeof FIX_MODELS)[number]; effort: (typeof FIX_EFFORTS)[number]; scouts: string[] };
export const FIX_RUNS_DEFAULT: FixRuns = { model: "opus", effort: "medium", scouts: ["instrumentation-gaps", "warden-ci", "signals-scout-error-tracking"] };
