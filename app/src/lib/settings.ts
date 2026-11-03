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
