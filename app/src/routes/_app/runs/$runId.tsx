import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { CircleAlert, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { RunStatusBadge } from "@/components/badges";
import { FindingRowView } from "@/components/finding-row";
import { RunNowButton } from "@/components/scout-cell";
import { EmptyState, Section, Stale } from "@/components/states";
import { Time } from "@/components/time";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatDuration, money, scoutName } from "@/lib/format";
import { overviewQuery, runQuery } from "@/lib/queries";
import type { FindingRow, Run } from "@/lib/types";

export const Route = createFileRoute("/_app/runs/$runId")({
	loader: async ({ context, params }) => {
		const [run] = await Promise.all([context.queryClient.ensureQueryData(runQuery(params.runId)), context.queryClient.ensureQueryData(overviewQuery())]);
		if (!run) throw notFound();
	},
	component: RunPage,
});

function Fact({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
	return (
		<div className="min-w-0 px-4 py-3">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="font-semibold">{children}</p>
			{sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
		</div>
	);
}

function clock(iso: string): string {
	return new Date(iso).toLocaleTimeString("en-GB");
}

function Facts({ run, maxTurns }: { run: Run; maxTurns: number }) {
	const dur = run.ended ? formatDuration(Date.parse(run.ended) - Date.parse(run.started)) : "Running";
	return (
		<div className="grid grid-cols-3 divide-x divide-y overflow-hidden rounded-lg border bg-card min-[1024px]:grid-cols-6 min-[1024px]:divide-y-0 [&>*:nth-child(4)]:border-l-0 min-[1024px]:[&>*:nth-child(4)]:border-l">
			<Fact label="Started" sub={<span className="tabular" suppressHydrationWarning>{clock(run.started)}</span>}><Time iso={run.started} /></Fact>
			<Fact label="Ended" sub={run.ended ? <span className="tabular" suppressHydrationWarning>{clock(run.ended)}</span> : null}>{run.ended ? <Time iso={run.ended} /> : "-"}</Fact>
			<Fact label="Duration"><span className="tabular">{dur}</span></Fact>
			<Fact label="Mode">{run.mode ?? "-"}</Fact>
			<Fact label="Turns" sub={<Progress value={Math.min(100, ((run.turns ?? 0) / maxTurns) * 100)} aria-label="Turns used" className="mt-1" />}><span className="tabular">{run.turns ?? 0} of {maxTurns}</span></Fact>
			<Fact label="Cost (notional)"><span className="tabular">{money(run.cost_usd)}</span></Fact>
		</div>
	);
}

function ErrorBox({ error }: { error: string }) {
	return (
		<Alert variant="destructive" className="border-status-error bg-status-error-bg p-0">
			<div className="flex items-center justify-between gap-3 border-b border-status-error/30 px-4 py-3">
				<AlertTitle className="flex items-center gap-2 text-status-error"><CircleAlert aria-hidden className="size-4" />{error.split("\n")[0]}</AlertTitle>
				<Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(error).then(() => toast.success("Error copied"))}>Copy error</Button>
			</div>
			<pre className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-[18px] text-foreground">{error}</pre>
		</Alert>
	);
}

function asRows(run: Run): FindingRow[] {
	return run.findings.map((f, i) => ({ ...f, id: `${run.id}:${i}`, runId: run.id, project: run.project, scout: run.scout, at: run.ended ?? run.started, itemId: null }));
}

function RunPage() {
	const { runId } = Route.useParams();
	const query = useQuery(runQuery(runId));
	const overview = useQuery(overviewQuery());
	const data = query.data;
	if (!data) return null;
	const { run, recent, maxTurns } = data;
	const cell = overview.data?.projects.find((p) => p.name === run.project)?.cells.find((c) => c.scout === run.scout);
	const rows = asRows(run);
	return (
		<div className="space-y-4">
			<Stale query={query} />
			<div className="space-y-2">
				<Breadcrumb>
					<BreadcrumbList className="text-xs">
						<BreadcrumbItem><BreadcrumbLink render={<Link to="/runs" search={{}} />}>Runs</BreadcrumbLink></BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>{run.project}</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem><BreadcrumbPage>{scoutName(run.scout)}</BreadcrumbPage></BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0 space-y-1">
						<h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold leading-7 max-[639px]:text-lg">
							{scoutName(run.scout)} on {run.project} <RunStatusBadge status={run.status} />
						</h1>
						<p className="break-all text-xs text-muted-foreground">Run <code className="font-mono">{run.id}</code></p>
					</div>
					<div className="flex items-center gap-2">
						<Button variant="outline" render={<Link to="/projects/$id/settings" params={{ id: run.project }} />}>Project settings</Button>
						{cell ? <RunNowButton project={run.project} cell={cell} label="Run again" /> : null}
					</div>
				</div>
			</div>
			<Facts run={run} maxTurns={maxTurns} />
			{run.status === "error" && run.error ? <ErrorBox error={run.error} /> : null}
			{run.status === "skipped" ? (
				<div role="status" className="flex items-start gap-2.5 rounded-lg bg-status-neutral-bg px-4 py-3">
					<SkipForward aria-hidden className="mt-0.5 size-4 shrink-0" />
					<p><strong>Skipped.</strong> {run.error || "Warden did not start this run."} This is not an error.</p>
				</div>
			) : null}
			<div className="rounded-lg border bg-card px-4 py-3">
				<p className="text-xs text-muted-foreground">Agent summary</p>
				<p>{run.summary || "The agent wrote no summary."}</p>
			</div>
			<Section title="Findings in this run" aside={rows.length}>
				{rows.length ? (
					<ul className="rounded-lg border bg-card">{rows.map((f) => <FindingRowView key={f.id} f={f} />)}</ul>
				) : (
					<div className="rounded-lg border bg-card"><EmptyState title="No findings">{run.status === "error" ? "This run stopped before it could look at any data, so it has no findings." : "This run found nothing new."}</EmptyState></div>
				)}
			</Section>
			<Section title="Recent runs of this scout" aside={<Link to="/runs" search={{ project: run.project, scout: run.scout }} className="text-link">All runs →</Link>}>
				<ul className="divide-y rounded-lg border bg-card">
					{recent.map((r) => (
						<li key={r.id} className={r.id === run.id ? "bg-muted" : undefined}>
							<Link to="/runs/$runId" params={{ runId: r.id }} className="flex min-h-[38px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-foreground no-underline hover:bg-muted/50">
								<span className="w-20"><Time iso={r.started} /></span>
								<RunStatusBadge status={r.status} />
								<span className="tabular w-16 text-muted-foreground">{r.turns ?? "-"} turns</span>
								<span className="tabular w-14 text-muted-foreground">{money(r.cost_usd)}</span>
								<span className="tabular w-20 text-muted-foreground">{r.findings.length} findings</span>
								<span className="min-w-0 flex-1 basis-60 truncate text-muted-foreground">{r.summary}</span>
							</Link>
						</li>
					))}
				</ul>
			</Section>
		</div>
	);
}
