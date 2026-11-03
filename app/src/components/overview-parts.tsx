import { Link } from "@tanstack/react-router";
import { Check, CircleAlert } from "lucide-react";
import { ItemStatusBadge, KindIcon, Pill } from "@/components/badges";
import { RunAllButton, ScoutCellView } from "@/components/scout-cell";
import { Time } from "@/components/time";
import { money, relative, scoutName } from "@/lib/format";
import type { Attention, ItemSummary, Overview, ProjectRow, Run } from "@/lib/types";
import { cn } from "@/lib/utils";

function kindBits(i: ItemSummary): string[] {
	if (i.kind === "comment") return i.number ? [`on #${i.number}`] : [];
	if (i.kind === "pr-update") return [`Update to PR #${i.number ?? "?"}`];
	if (i.kind !== "pr") return [];
	const stats = i.files ? [`${i.files} ${i.files === 1 ? "file" : "files"}, +${i.add ?? 0} −${i.del ?? 0}`] : [];
	return [...(i.related_issue ? [`refs #${i.related_issue}`] : []), ...stats];
}

function itemMeta(i: ItemSummary): string {
	const failure = i.status === "error" && i.error ? [i.error.split("\n")[0]] : [];
	return [i.project, scoutName(i.scout), ...kindBits(i), ...failure].join(" · ");
}

function ItemRow({ item }: { item: ItemSummary }) {
	return (
		<li>
			<Link
				to="/review/$id"
				params={{ id: item.id }}
				search={{ project: item.project }}
				className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 text-foreground no-underline hover:bg-muted/50 max-[639px]:flex-wrap"
			>
				<KindIcon kind={item.kind} className={item.status === "error" ? "text-status-error" : undefined} />
				<div className="min-w-0 flex-1 max-[639px]:basis-[calc(100%-2rem)]">
					<p className="truncate font-medium">{item.title}</p>
					<p className="truncate text-xs text-muted-foreground">{itemMeta(item)}</p>
				</div>
				<div className="flex items-center gap-3 max-[639px]:w-full max-[639px]:justify-between max-[639px]:pl-7">
					<ItemStatusBadge status={item.status} />
					<span className="text-xs text-muted-foreground" suppressHydrationWarning>{relative(item.created)}</span>
					<span className="hidden h-7 items-center rounded-md border bg-background px-2.5 font-medium sm:inline-flex">{item.status === "pending" ? "Review" : "View"}</span>
				</div>
			</Link>
		</li>
	);
}

function RunRow({ run }: { run: Run }) {
	return (
		<li>
			<Link to="/runs/$runId" params={{ runId: run.id }} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 text-foreground no-underline hover:bg-muted/50 max-[639px]:flex-wrap">
				<CircleAlert aria-hidden className="size-4 shrink-0 text-status-error" />
				<div className="min-w-0 flex-1 max-[639px]:basis-[calc(100%-2rem)]">
					<p className="truncate font-medium">
						Run failed: {scoutName(run.scout)} on {run.project}
					</p>
					<p className="truncate text-xs text-muted-foreground">
						{(run.error ?? "Unknown error").split("\n")[0]} · {run.turns ?? 0} turns · {money(run.cost_usd)}
					</p>
				</div>
				<div className="flex items-center gap-3 max-[639px]:w-full max-[639px]:justify-between max-[639px]:pl-7">
					<Pill tone="error">Error</Pill>
					<span className="text-xs text-muted-foreground" suppressHydrationWarning>{relative(run.ended ?? run.started)}</span>
					<span className="hidden h-7 items-center rounded-md border bg-background px-2.5 font-medium sm:inline-flex">View run</span>
				</div>
			</Link>
		</li>
	);
}

export function AttentionCard({ items }: { items: Attention[] }) {
	return (
		<ul className="divide-y rounded-lg border bg-card">
			{items.map((a) => (a.type === "item" ? <ItemRow key={`i-${a.item.project}-${a.item.id}`} item={a.item} /> : <RunRow key={`r-${a.run.id}`} run={a.run} />))}
		</ul>
	);
}

function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

function cycleText(c: Overview["cycleCreated"]): string {
	const parts = [c.issues && plural(c.issues, "issue", "issues"), c.comments && plural(c.comments, "comment", "comments"), c.prs && plural(c.prs, "PR", "PRs")].filter(Boolean);
	return parts.length ? parts.join(", ") : "Nothing new";
}

export function nextClock(iso: string | null): string {
	if (!iso) return "not planned yet";
	return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="px-5 max-[639px]:py-2 sm:border-l">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="font-semibold">{children}</p>
		</div>
	);
}

export function QuietCard({ o }: { o: Overview }) {
	return (
		<div className="flex flex-wrap items-center gap-y-3 rounded-lg border bg-card p-5">
			<span className="mr-4 grid size-10 place-items-center rounded-full bg-status-ok-bg text-status-ok">
				<Check aria-hidden className="size-5" />
			</span>
			<div className="min-w-[220px] flex-1">
				<h2 className="text-lg font-semibold leading-6">All quiet</h2>
				<p className="text-muted-foreground">All {o.scoutCount} scouts ran with no errors. Nothing waits for you.</p>
			</div>
			<div className="flex flex-wrap max-[639px]:w-full max-[639px]:flex-col max-[639px]:border-t max-[639px]:pt-2">
				<Fact label="Last cycle">{o.lastRunAt ? <>Finished <Time iso={o.lastRunAt} /></> : "No run yet"}</Fact>
				<Fact label="Next cycle"><span suppressHydrationWarning>{nextClock(o.nextRunAt)}</span>{o.nextRunAt ? <> · <Time iso={o.nextRunAt} /></> : null}</Fact>
				<Fact label={`In the last ${o.intervalHours} h`}>{cycleText(o.cycleCreated)}</Fact>
			</div>
		</div>
	);
}

// One block per project. The scouts wrap in a grid, so nine scouts fit at 1280 and at 520.
function ProjectBlock({ p }: { p: ProjectRow }) {
	return (
		<div className={cn("grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-[200px_minmax(0,1fr)]", !p.enabled && "bg-muted/40")}>
			<div className="flex items-start justify-between gap-2 sm:block">
				<div className={cn("min-w-0", !p.enabled && "text-muted-foreground")}>
					<Link to="/projects/$id/settings" params={{ id: p.name }} className="font-semibold text-foreground no-underline hover:underline">{p.name}</Link>
					<p className="truncate text-xs text-muted-foreground">{p.repo}</p>
				</div>
				<div className="flex items-center gap-2 sm:mt-2">
					{p.enabled ? <ModeTag mode={p.mode} auto={p.autoSubmit} /> : <Pill tone="neutral">Disabled</Pill>}
					<RunAllButton project={p.name} cells={p.cells} off={!p.enabled} />
				</div>
			</div>
			<div className={cn("grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-2.5", !p.enabled && "opacity-60")}>
				{p.cells.map((c) => (
					<div key={c.scout} className="min-w-0">
						<p className="truncate text-xs text-muted-foreground">{scoutName(c.scout)}</p>
						<ScoutCellView cell={c} />
					</div>
				))}
			</div>
		</div>
	);
}

export function ScoutGrid({ projects }: { projects: ProjectRow[] }) {
	return (
		<>
			<div className="divide-y overflow-hidden rounded-lg border bg-card">
				{projects.map((p) => (
					<ProjectBlock key={p.name} p={p} />
				))}
			</div>
			<Legend />
		</>
	);
}

export function ModeTag({ mode, auto }: { mode: string; auto?: boolean }) {
	return (
		<span className={cn("rounded-sm border bg-background px-1.5 py-0.5 font-mono text-xs", auto && "border-status-pending")} title={auto ? "Auto-submit is on" : undefined}>
			{mode}
			{auto ? " · auto" : ""}
		</span>
	);
}

function Legend() {
	return (
		<p className="mt-2 text-xs text-muted-foreground">
			OK ✓ · Error ! · Running ◔ · Late ◷ (last run more than 13 h ago) · Skipped (not an error) · Never run ◌
		</p>
	);
}
