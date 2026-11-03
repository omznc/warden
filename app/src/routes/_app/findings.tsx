import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { SeverityBadge } from "@/components/badges";
import { ExternalFindingLink, FindingTitle, ROW_HOVER } from "@/components/finding-row";
import { FindingBadge } from "@/components/gh-state";
import { FilterBar, type Patch } from "@/components/findings-filters";
import { FindingRowView } from "@/components/finding-row";
import { safeHref } from "@/components/markdown";
import { EmptyState, Stale } from "@/components/states";
import { Time } from "@/components/time";
import { Button } from "@/components/ui/button";
import { dayLabel, scoutName } from "@/lib/format";
import { findingsQuery, overviewQuery } from "@/lib/queries";
import type { FindingRow, FindingsFilter, FindingsPage as FindingsData } from "@/lib/types";
import { useNarrow } from "@/lib/use-narrow";

const search = z.object({
	project: z.string().optional(),
	scout: z.string().optional(),
	severity: z.string().optional(),
	action: z.string().optional(),
	gh: z.enum(["open", "merged", "closed"]).optional().catch(undefined),
	q: z.string().max(200).optional(),
});

export const Route = createFileRoute("/_app/findings")({
	validateSearch: search,
	loaderDeps: ({ search: s }) => ({ s }),
	loader: async ({ context, deps }) => {
		await Promise.all([context.queryClient.ensureInfiniteQueryData(findingsQuery(deps.s)), context.queryClient.ensureQueryData(overviewQuery())]);
	},
	component: FindingsPage,
});

function groupByDay(rows: FindingRow[]): { day: string; rows: FindingRow[] }[] {
	const groups: { day: string; rows: FindingRow[] }[] = [];
	for (const r of rows) {
		const day = dayLabel(r.at);
		const last = groups.at(-1);
		if (last?.day === day) last.rows.push(r);
		else groups.push({ day, rows: [r] });
	}
	return groups;
}

// On a narrow screen a click opens the links of the finding.
function NarrowRow({ f }: { f: FindingRow }) {
	return f.itemId ? <LinkedNarrowRow f={f} /> : <PlainNarrowRow f={f} />;
}

// A finding with an item: the title is the one link and it covers the row.
function LinkedNarrowRow({ f }: { f: FindingRow }) {
	return (
		<li className={`relative border-b px-3 py-2.5 last:border-b-0 ${ROW_HOVER}`}>
			<span className="mb-1 flex items-center justify-between gap-2">
				<SeverityBadge severity={f.severity} />
				<FindingBadge f={f} />
			</span>
			<FindingTitle f={f} className="font-medium" />
			<span className="block text-xs text-muted-foreground">
				{f.project} · {scoutName(f.scout)} · <Time iso={f.at} className="relative z-10" />
				{f.gh?.syncedAt ? <> · Synced <Time iso={f.gh.syncedAt} className="relative z-10" /></> : null}
			</span>
			<span className="mt-1 flex gap-4 text-xs">
				<Link to="/runs/$runId" params={{ runId: f.runId }} className="relative z-10">Open the run</Link>
				<span className="relative z-10 empty:hidden"><ExternalFindingLink f={f} /></span>
			</span>
		</li>
	);
}

function PlainNarrowRow({ f }: { f: FindingRow }) {
	const [open, setOpen] = useState(false);
	const href = safeHref(f.url ?? undefined);
	return (
		<li className="border-b px-3 py-2.5 last:border-b-0">
			<button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 text-left">
				{open ? <ChevronDown aria-hidden className="mt-0.5 size-4 shrink-0" /> : <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0" />}
				<span className="min-w-0 flex-1">
					<span className="mb-1 flex items-center justify-between gap-2">
						<SeverityBadge severity={f.severity} />
						<FindingBadge f={f} />
					</span>
					<span className="block font-medium">{f.title}</span>
					<span className="block text-xs text-muted-foreground">
						{f.project} · {scoutName(f.scout)} · <Time iso={f.at} />
							{f.gh?.syncedAt ? <> · Synced <Time iso={f.gh.syncedAt} /></> : null}
					</span>
				</span>
			</button>
			{open ? (
				<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-6 text-xs">
					{f.fingerprint ? <span className="font-mono text-muted-foreground">{f.fingerprint}</span> : null}
					{f.itemId ? <Link to="/review/$id" params={{ id: f.itemId }} search={{ project: f.project }}>Open the item</Link> : null}
					{href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">Open on GitHub ↗</a> : null}
					<Link to="/runs/$runId" params={{ runId: f.runId }}>Open the run</Link>
				</div>
			) : null}
		</li>
	);
}

function FindingGroups({ rows, hidden, narrow, onClear }: { rows: FindingRow[]; hidden: number; narrow: boolean; onClear: () => void }) {
	if (rows.length === 0) {
		return (
			<div className="rounded-lg border bg-card">
				<EmptyState title="No findings match these filters" action={<Button variant="outline" size="sm" onClick={onClear}>Clear all filters</Button>}>
					{hidden} {hidden === 1 ? "finding is" : "findings are"} hidden.
				</EmptyState>
			</div>
		);
	}
	return (
		<div className="space-y-4">
			{groupByDay(rows).map((g) => (
				<section key={g.day} className="overflow-hidden rounded-lg border bg-card">
					<h2 className="border-b bg-muted px-4 py-2 text-xs font-semibold text-muted-foreground">{g.day}</h2>
					<ul>{g.rows.map((f) => (narrow ? <NarrowRow key={f.id} f={f} /> : <FindingRowView key={f.id} f={f} />))}</ul>
				</section>
			))}
		</div>
	);
}

function flatten(pages: FindingsData[]): { rows: FindingRow[]; total: number; hidden: number } {
	return { rows: pages.flatMap((p) => p.rows), total: pages[0]?.total ?? 0, hidden: pages[0]?.hidden ?? 0 };
}

function FindingsPage() {
	const filters: FindingsFilter = Route.useSearch();
	const navigate = Route.useNavigate();
	const narrow = useNarrow();
	const overview = useQuery(overviewQuery());
	const query = useInfiniteQuery(findingsQuery(filters));
	const { rows, total, hidden } = flatten(query.data?.pages ?? []);
	const patch: Patch = (p) => navigate({ search: (s) => ({ ...s, ...p }), replace: true });
	const clear = () => navigate({ search: {}, replace: true });
	return (
		<div className="space-y-4">
			<Stale query={query} />
			<div className="flex items-baseline justify-between gap-3">
				<h1 className="text-xl font-semibold leading-7 max-[639px]:text-lg">Findings</h1>
				<p className="text-xs text-muted-foreground">{total} {total === 1 ? "finding" : "findings"}</p>
			</div>
			<FilterBar f={filters} projects={overview.data?.projects ?? []} patch={patch} narrow={narrow} />
			<FindingGroups rows={rows} hidden={hidden} narrow={narrow} onClear={clear} />
			{query.hasNextPage ? (
				<div className="text-center">
					<Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
						{query.isFetchingNextPage ? "Loading…" : "Load more"}
					</Button>
				</div>
			) : null}
		</div>
	);
}
