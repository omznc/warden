import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Pill } from "@/components/badges";
import { EmptyState, Stale } from "@/components/states";
import { Button } from "@/components/ui/button";
import { projectListQuery } from "@/lib/queries";
import type { ProjectListRow } from "@/lib/types";

export const Route = createFileRoute("/_app/projects/")({
	loader: ({ context }) => context.queryClient.ensureQueryData(projectListQuery()),
	component: ProjectsPage,
});

function CheckBadge({ row }: { row: ProjectListRow }) {
	if (row.check === "works") return <Pill tone="ok">Works</Pill>;
	if (row.check === "checking") return <Pill tone="info">Checking…</Pill>;
	return (
		<span className="inline-flex flex-wrap items-center gap-x-2">
			<Pill tone="error">Problem</Pill>
			{row.detail ? <span className="text-xs text-muted-foreground">{row.detail}</span> : null}
		</span>
	);
}

function Row({ row }: { row: ProjectListRow }) {
	return (
		<li className="grid items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto]">
			<div className="min-w-0">
				<Link to="/projects/$id/settings" params={{ id: row.name }} className="font-semibold text-foreground no-underline hover:underline">{row.name}</Link>
				<p className="truncate font-mono text-xs text-muted-foreground">{row.repo}</p>
			</div>
			<div className="min-w-0 text-xs">
				<p className="text-xs text-muted-foreground sm:hidden">PostHog</p>
				<p className="truncate">{row.posthogName ?? "-"}</p>
				{row.posthogKeyEnv ? <p className="truncate font-mono text-muted-foreground">{row.posthogKeyEnv}</p> : null}
			</div>
			<div className="min-w-0 text-xs">
				<p className="text-xs text-muted-foreground sm:hidden">Sentry</p>
				<p className="truncate">{row.sentry ?? "-"}</p>
			</div>
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				{row.enabled ? <CheckBadge row={row} /> : <Pill tone="neutral">Disabled</Pill>}
			</div>
			<Button variant="outline" size="sm" render={<Link to="/projects/$id/settings" params={{ id: row.name }} />}>Settings</Button>
		</li>
	);
}

function ProjectsPage() {
	const query = useQuery(projectListQuery());
	const rows = query.data ?? [];
	return (
		<div className="space-y-4">
			<Stale query={query} />
			<div className="flex items-center justify-between gap-3">
				<h1 className="text-xl font-semibold leading-7 max-[639px]:text-lg">Projects</h1>
				<Button render={<Link to="/projects/new" />}>
					<Plus aria-hidden />
					Add project
				</Button>
			</div>
			{rows.length === 0 ? (
				<div className="rounded-lg border bg-card">
					<EmptyState title="No projects yet">Add a project to start the scouts.</EmptyState>
				</div>
			) : (
				<>
					<div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] gap-x-4 px-4 text-xs text-muted-foreground sm:grid">
						<span>Project</span>
						<span>PostHog</span>
						<span>Sentry</span>
						<span>Check</span>
						<span className="w-[72px]" />
					</div>
					<ul className="divide-y overflow-hidden rounded-lg border bg-card">
						{rows.map((r) => (
							<Row key={r.name} row={r} />
						))}
					</ul>
				</>
			)}
		</div>
	);
}
