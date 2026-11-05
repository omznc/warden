import { SCOUT_LABELS } from "@/lib/scouts";

export const LATE_HOURS = 13;

export function scoutName(scout: string): string {
	return SCOUT_LABELS[scout] ?? scout.replace(/^signals-scout-/, "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export type Group = "issue" | "comment" | "pr" | "pending" | "dry" | "skipped" | "blocked" | "other";

export function actionGroup(action: string | undefined): Group {
	const a = action ?? "";
	if (a === "issue" || a === "comment" || a === "pr") return a;
	if (a === "pr-update") return "pr";
	if (a === "pr-update-failed") return "blocked";
	if (a === "pending" || a.startsWith("pending-")) return "pending";
	if (a.startsWith("dry")) return "dry";
	if (a.startsWith("skipped")) return "skipped";
	if (a.startsWith("blocked")) return "blocked";
	return "other";
}

export const ACTION_LABELS: Record<string, string> = {
	issue: "Issue created",
	comment: "Comment added",
	pr: "PR opened",
	"pr-update": "PR updated",
	"pr-update-failed": "Blocked: PR update failed",
	pending: "PR pending approval",
	"pending-issue": "Issue pending approval",
	"pending-comment": "Comment pending approval",
	"pending-pr-update": "PR update pending approval",
	"skipped-cap": "Skipped: limit reached",
	"skipped-mode": "Skipped: issues mode",
	"skipped-dup": "Skipped: duplicate",
	"blocked-secret": "Blocked: secret",
	"blocked-path": "Blocked: path",
	"blocked-conflict": "Blocked: merge conflict",
	"blocked-review": "Blocked: reviewer changed files",
	"skipped-open-pr": "Skipped: file of an open PR",
	"dry-issue": "Dry run: issue",
	"dry-comment": "Dry run: comment",
	"dry-pr": "Dry run: PR",
	"dry-pr-update": "Dry run: PR update",
};

export const ACTION_HELP: Record<string, string> = { "skipped-mode": "Switch the project to prs mode to get this fix as a PR." };

export function actionLabel(action: string | undefined): string {
	const a = action ?? "";
	return ACTION_LABELS[a] ?? (a.startsWith("dry") ? "Dry run" : a || "No action");
}

export type Severity = "high" | "medium" | "low";
export function normSeverity(value: unknown): Severity {
	const s = String(value ?? "").toLowerCase();
	return s === "high" || s === "critical" ? "high" : s === "medium" ? "medium" : "low";
}

export function formatDuration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s} s`;
	if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
	return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

export function relative(iso: string | null | undefined, now = Date.now()): string {
	const t = iso ? Date.parse(iso) : Number.NaN;
	if (Number.isNaN(t)) return "never";
	const diff = now - t;
	const abs = Math.abs(diff);
	if (abs < 60_000) return diff >= 0 ? "just now" : "in a moment";
	const [size, unit] = abs < 3_600_000 ? [60_000, "min"] : abs < 86_400_000 ? [3_600_000, "h"] : [86_400_000, "d"];
	const n = Math.max(1, Math.round(abs / (size as number)));
	return diff >= 0 ? `${n} ${unit} ago` : `in ${n} ${unit}`;
}

export function exactTime(iso: string): string {
	return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" });
}

function startOfDay(t: number): number {
	const d = new Date(t);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

export function dayLabel(iso: string, now = Date.now()): string {
	const d = new Date(iso);
	const days = Math.round((startOfDay(now) - startOfDay(d.getTime())) / 86_400_000);
	if (days <= 0) return "Today";
	if (days === 1) return "Yesterday";
	return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function money(v: number | null | undefined): string {
	return v == null ? "-" : `$${Number(v).toFixed(2)}`;
}
