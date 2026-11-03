import { Check, CircleDot, GitMerge, X } from "lucide-react";
import { ActionBadge, ItemStatusBadge, Pill, type Tone } from "@/components/badges";
import { Time } from "@/components/time";
import { type GhFields, type GhInfo, type GhState, findingState, ghLabel, parseGh } from "@/lib/gh";
import type { FindingRow, ItemStatus } from "@/lib/types";

const GH: Record<GhState, { tone: Tone; icon: typeof Check }> = {
	open: { tone: "ok", icon: CircleDot },
	merged: { tone: "info", icon: GitMerge },
	closed: { tone: "neutral", icon: X },
};

export function GhBadge({ gh }: { gh: GhInfo }) {
	const { tone, icon: Icon } = GH[gh.state];
	return (
		<Pill tone={tone}>
			<Icon aria-hidden />
			{ghLabel(gh)}
		</Pill>
	);
}

// The time of the state change and the time of the last sync, as muted text.
export function GhTimes({ gh }: { gh: GhInfo }) {
	return (
		<>
			{gh.at ? <span className="text-xs"><Time iso={gh.at} className="relative z-10" /></span> : null}
			{gh.syncedAt ? <span className="text-xs text-muted-foreground">Synced <Time iso={gh.syncedAt} className="relative z-10" /></span> : null}
		</>
	);
}

// A submitted item with a known GitHub state shows that state. Other items keep the status badge.
export function ItemState({ item }: { item: GhFields & { status: ItemStatus } }) {
	const gh = item.status === "submitted" ? parseGh(item) : null;
	if (!gh) return <ItemStatusBadge status={item.status} />;
	return (
		<>
			<GhBadge gh={gh} />
			<GhTimes gh={gh} />
		</>
	);
}

// The badge of a finding. The live status of its item wins over the action the scout wrote.
export function FindingBadge({ f }: { f: FindingRow }) {
  const s = findingState(f);
  if (s.kind === "gh") return <GhBadge gh={s.gh} />;
  if (s.kind === "status") return <ItemStatusBadge status={s.status} />;
  return <ActionBadge action={f.action} />;
}
