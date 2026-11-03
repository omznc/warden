import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { RunStatusBadge } from "@/components/badges";
import { CostChart } from "@/components/cost-chart";
import { EmptyState, Stale } from "@/components/states";
import { Time } from "@/components/time";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { money, scoutName } from "@/lib/format";
import { costQuery, overviewQuery, runsQuery } from "@/lib/queries";

const search = z.object({ project: z.string().optional(), scout: z.string().optional(), status: z.enum(["ok", "error", "skipped"]).optional().catch(undefined) });

export const Route = createFileRoute("/_app/runs/")({
	validateSearch: search,
	loaderDeps: ({ search: s }) => ({ s }),
	loader: ({ context, deps }) => Promise.all([context.queryClient.ensureQueryData(runsQuery(deps.s)), context.queryClient.ensureQueryData(overviewQuery())]),
	component: RunsPage,
});

function Filter({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string | undefined) => void }) {
	return (
		<Select value={value} items={options} onValueChange={(v) => onChange(v === "all" ? undefined : String(v))}>
			<SelectTrigger aria-label={label} className="h-8 min-w-[130px] bg-card">
				<span className="text-muted-foreground">{label}</span>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((o) => (
					<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function RunsPage() {
	const f = Route.useSearch();
	const navigate = Route.useNavigate();
	const query = useQuery(runsQuery(f));
	const overview = useQuery(overviewQuery());
	const cost = useQuery(costQuery());
	const runs = query.data ?? [];
	const projects = overview.data?.projects ?? [];
	const scouts = [...new Set(projects.flatMap((p) => p.cells.map((c) => c.scout)))];
	const set = (k: "project" | "scout" | "status") => (v: string | undefined) => navigate({ search: (s) => ({ ...s, [k]: v }), replace: true });
	return (
		<div className="space-y-4">
			<Stale query={query} />
			<h1 className="text-xl font-semibold leading-7 max-[639px]:text-lg">Runs</h1>
			{cost.data ? <CostChart cost={cost.data} /> : null}
			<div className="flex flex-wrap gap-2">
				<Filter label="Project" value={f.project ?? "all"} options={[{ value: "all", label: "All" }, ...projects.map((p) => ({ value: p.name, label: p.name }))]} onChange={set("project")} />
				<Filter label="Scout" value={f.scout ?? "all"} options={[{ value: "all", label: "All" }, ...scouts.map((s) => ({ value: s, label: scoutName(s) }))]} onChange={set("scout")} />
				<Filter label="Status" value={f.status ?? "all"} options={[{ value: "all", label: "All" }, { value: "ok", label: "OK" }, { value: "error", label: "Error" }, { value: "skipped", label: "Skipped" }]} onChange={set("status")} />
			</div>
			{runs.length === 0 ? (
				<div className="rounded-lg border bg-card"><EmptyState title="No runs yet">Runs show here after the first pass.</EmptyState></div>
			) : (
				<>
					<div className="hidden overflow-hidden rounded-lg border bg-card sm:block">
						<table className="w-full text-[13px]">
							<thead className="bg-muted text-left text-muted-foreground">
								<tr className="h-[38px]">
									{["Started", "Project", "Scout", "Status", "Mode", "Turns", "Cost", "Findings"].map((h) => (
										<th key={h} scope="col" className="px-3 font-medium first:pl-4">{h}</th>
									))}
								</tr>
							</thead>
							<tbody className="divide-y">
								{runs.map((r) => (
									<tr key={r.id} className="h-[38px] hover:bg-muted/50">
										<td className="px-3 pl-4"><Link to="/runs/$runId" params={{ runId: r.id }} className="text-foreground no-underline"><Time iso={r.started} /></Link></td>
										<td className="px-3">{r.project}</td>
										<td className="px-3">{scoutName(r.scout)}</td>
										<td className="px-3">
											<span className="flex items-center gap-2">
												<RunStatusBadge status={r.status} />
												{r.status === "skipped" && r.error ? <span className="max-w-[180px] truncate text-xs text-muted-foreground" title={r.error}>{r.error}</span> : null}
											</span>
										</td>
										<td className="px-3">{r.mode ?? "-"}</td>
										<td className="tabular px-3">{r.turns ?? "-"}</td>
										<td className="tabular px-3">{money(r.cost_usd)}</td>
										<td className="tabular px-3">{r.findings.length}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<ul className="divide-y rounded-lg border bg-card sm:hidden">
						{runs.map((r) => (
							<li key={r.id}>
								<Link to="/runs/$runId" params={{ runId: r.id }} className="block px-3 py-2.5 text-foreground no-underline">
									<span className="flex items-center justify-between gap-2"><span className="font-medium">{scoutName(r.scout)}</span><RunStatusBadge status={r.status} /></span>
									<span className="block text-xs text-muted-foreground">{r.project} · {r.status === "skipped" && r.error ? r.error : `${r.findings.length} findings · ${money(r.cost_usd)}`}</span>
								</Link>
							</li>
						))}
					</ul>
				</>
			)}
		</div>
	);
}
