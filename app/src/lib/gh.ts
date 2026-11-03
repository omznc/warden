import type { ItemStatus } from "./types";

export type GhState = "open" | "closed" | "merged";
export type GhInfo = { state: GhState; reason: string | null; at: string | null; syncedAt: string | null };

export type GhFields = { gh_state?: unknown; gh_state_reason?: unknown; gh_state_at?: unknown; synced_at?: unknown };

const STATES: GhState[] = ["open", "closed", "merged"];
const time = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

// The runner writes these fields. Any of them can be missing or wrong. Wrong values count as missing.
export function parseGh(m: GhFields): GhInfo | null {
	if (!STATES.includes(m.gh_state as GhState)) return null;
	const reason = typeof m.gh_state_reason === "string" && /^[a-z_]{1,40}$/.test(m.gh_state_reason) ? m.gh_state_reason : null;
	return { state: m.gh_state as GhState, reason, at: time(m.gh_state_at), syncedAt: time(m.synced_at) };
}

export function ghLabel(g: GhInfo): string {
	const base = { open: "Open", merged: "Merged", closed: "Closed" }[g.state];
	return g.state === "closed" && g.reason === "not_planned" ? `${base} (not planned)` : base;
}

// What the badge of a finding shows. A finding with an item shows the live status of the item.
export type FindingState = { kind: "gh"; gh: GhInfo } | { kind: "status"; status: ItemStatus } | { kind: "action" };

export function findingState(f: { itemStatus?: ItemStatus | null; gh?: GhInfo | null }): FindingState {
	if (!f.itemStatus || f.itemStatus === "pending") return { kind: "action" };
	if (f.itemStatus === "submitted" && f.gh) return { kind: "gh", gh: f.gh };
	return { kind: "status", status: f.itemStatus };
}
