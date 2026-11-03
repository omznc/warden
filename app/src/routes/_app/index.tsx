import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FindingRowView } from "@/components/finding-row";
import { AttentionCard, nextClock, QuietCard, ScoutGrid } from "@/components/overview-parts";
import { EmptyState, Section, Stale } from "@/components/states";
import { money } from "@/lib/format";
import { overviewQuery } from "@/lib/queries";

export const Route = createFileRoute("/_app/")({
	loader: ({ context }) => context.queryClient.ensureQueryData(overviewQuery()),
	component: OverviewPage,
});

function OverviewPage() {
	const query = useQuery(overviewQuery());
	const o = query.data;
	if (!o) return null;
	const quiet = o.attention.length === 0 && o.projects.length > 0;
	return (
		<div className="space-y-0">
			<Stale query={query} />
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h1 className="text-xl font-semibold leading-7 max-[639px]:text-lg">Overview</h1>
				<p className="text-xs text-muted-foreground">
					{o.projects.length} projects · {o.scoutCount} scouts · every {o.intervalHours} h ·{" "}
					<Link to="/runs" search={{}} className="tabular text-muted-foreground">
						{money(o.cost.today)} today{o.cost.cap ? ` of ${money(o.cost.cap)} cap` : ", no cap"}
					</Link>
				</p>
			</div>
			{o.projects.length === 0 ? (
				<div className="mt-5 rounded-lg border bg-card">
					<EmptyState title="No projects yet">
						Add a project to <code className="font-mono text-xs">projects.json</code>. Warden reads it on the next request.
					</EmptyState>
				</div>
			) : quiet ? (
				<div className="mt-5">
					<QuietCard o={o} />
				</div>
			) : (
				<Section title={<>Needs your attention <span className="font-normal text-muted-foreground">· {o.attention.length}</span></>}>
					<AttentionCard items={o.attention} />
				</Section>
			)}
			{o.projects.length > 0 ? (
				<Section title="Projects" aside="Hover a time for the exact date">
					<ScoutGrid projects={o.projects} />
				</Section>
			) : null}
			<Section
				title="Recent findings"
				aside={
					<Link to="/findings" className="text-link">
						All findings →
					</Link>
				}
			>
				{o.recent.length ? (
					<ul className="rounded-lg border bg-card">
						{o.recent.map((f) => (
							<FindingRowView key={f.id} f={f} />
						))}
					</ul>
				) : (
					<p className="rounded-lg border bg-card p-4 text-muted-foreground">No findings yet.</p>
				)}
			</Section>
			{quiet ? <p className="mt-6 text-center text-xs text-muted-foreground">You are up to date. Warden checks again at <span suppressHydrationWarning>{nextClock(o.nextRunAt)}</span>.</p> : null}
		</div>
	);
}
