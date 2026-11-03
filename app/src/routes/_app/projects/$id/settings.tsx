import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ExternalLink, TriangleAlert, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Pill } from "@/components/badges";
import { ProjectAdmin } from "@/components/project-admin";
import { ProjectForm } from "@/components/project-form";
import { SettingsLayout, SIDE_LINK, SideHeading } from "@/components/settings-layout";
import { RunNowButton } from "@/components/scout-cell";
import { Section, Stale } from "@/components/states";
import { safeHref } from "@/components/markdown";
import { Time } from "@/components/time";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { scoutName } from "@/lib/format";
import { projectQuery } from "@/lib/queries";
import type { CellState, Mode, ProjectDetail } from "@/lib/types";
import { useNarrow } from "@/lib/use-narrow";
import { cn } from "@/lib/utils";
import { saveProject } from "@/server/fns";

export const Route = createFileRoute("/_app/projects/$id/settings")({
	loader: ({ context, params }) => context.queryClient.ensureQueryData(projectQuery(params.id)),
	component: SettingsPage,
});

const MODES: { value: Mode; text: string }[] = [
	{ value: "dry", text: "Simulate only. Findings are saved here, nothing goes to GitHub." },
	{ value: "issues", text: "Open issues and add comments. No code changes." },
	{ value: "prs", text: "Issues, comments and code fixes as pull requests." },
];

const STATE_LABEL: Record<CellState, string> = { ok: "OK", error: "Error", running: "Running", requested: "Starting", late: "Late", never: "Never run", skipped: "Skipped" };
const STATE_TONE = { ok: "ok", error: "error", running: "info", requested: "info", late: "pending", never: "neutral", skipped: "neutral" } as const;

function useSave(id: string) {
	const client = useQueryClient();
	const [savedAt, setSavedAt] = useState<number | null>(null);
	const m = useMutation({
		mutationFn: (v: { mode: Mode; autoSubmit: boolean }) => saveProject({ data: { id, ...v } }),
		onSuccess: async (r) => {
			setSavedAt(Date.now());
			await client.invalidateQueries();
			toast.success(`Saved: ${r.mode}${r.autoSubmit ? ", auto-submit on" : ""}`);
		},
		onError: (e, v) => toast.error("Could not save the settings", { action: { label: "Retry", onClick: () => m.mutate(v) }, description: e instanceof Error ? e.message : undefined }),
	});
	return { m, savedAt };
}

function ModeCard({ value, text, selected }: { value: Mode; text: string; selected: boolean }) {
	return (
		<Label htmlFor={`mode-${value}`} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border bg-card p-3", selected && "border-foreground ring-1 ring-foreground")}>
			<RadioGroupItem id={`mode-${value}`} value={value} className="mt-0.5" />
			<span className="space-y-0.5">
				<span className="block text-[13px] font-semibold">{value}</span>
				<span className="block font-normal text-muted-foreground">{text}</span>
			</span>
		</Label>
	);
}

function ModeSection({ p, save }: { p: ProjectDetail; save: (v: { mode: Mode; autoSubmit: boolean }) => void }) {
	const autoHelp = p.mode === "dry" ? "Not available in dry mode. Choose issues or prs first." : "Issues, comments and PRs go to GitHub without your approval.";
	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<div className="space-y-3 p-4">
				<div>
					<h2 className="text-sm font-semibold">Mode</h2>
					<p className="text-muted-foreground">What scouts may do on GitHub. Applies to all {p.scouts.length} scouts of this project.</p>
				</div>
				<RadioGroup value={p.mode} onValueChange={(v) => save({ mode: v as Mode, autoSubmit: v === "dry" ? false : p.autoSubmit })} className="grid gap-3 min-[900px]:grid-cols-3" aria-label="Mode">
					{MODES.map((m) => (
						<ModeCard key={m.value} value={m.value} text={m.text} selected={p.mode === m.value} />
					))}
				</RadioGroup>
			</div>
			<div className="space-y-2 border-t p-4">
				<div className="flex items-start justify-between gap-4">
					<div>
						<Label htmlFor="auto" className="text-sm font-semibold">Auto-submit</Label>
						<p className="text-muted-foreground">{autoHelp}</p>
					</div>
					<Switch id="auto" checked={p.autoSubmit} disabled={p.mode === "dry"} onCheckedChange={(v) => save({ mode: p.mode, autoSubmit: v })} />
				</div>
				{p.autoSubmit ? (
					<p className="flex items-center gap-2 rounded-md bg-status-pending-bg px-3 py-2 text-status-pending">
						<TriangleAlert aria-hidden className="size-3.5 shrink-0" />
						Items skip the review queue. PRs still open as drafts.
					</p>
				) : null}
			</div>
		</div>
	);
}

function ScoutsSection({ p }: { p: ProjectDetail }) {
	return (
		<Section title="Scouts" aside={`All scouts run every ${p.intervalHours} hours`}>
			<div className="overflow-hidden rounded-lg border bg-card">
				<table className="w-full text-[13px]">
					<thead className="bg-muted text-left text-muted-foreground">
						<tr className="h-[38px]">
							<th scope="col" className="px-4 font-medium">Scout</th>
							<th scope="col" className="px-2 font-medium">Status</th>
							<th scope="col" className="hidden px-2 font-medium sm:table-cell">Last run</th>
							<th scope="col" className="hidden px-2 font-medium sm:table-cell">Last run without error</th>
							<th scope="col" className="hidden px-2 font-medium sm:table-cell">Next run</th>
							<th scope="col" className="px-4"><span className="sr-only">Run now</span></th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{p.scouts.map((s) => (
							<tr key={s.scout} className="h-[48px]">
								<th scope="row" className="px-4 text-left font-semibold">{scoutName(s.scout)}</th>
								<td className="px-2">
									<Pill tone={STATE_TONE[s.state]}>{STATE_LABEL[s.state]}</Pill>
									{s.fails > 0 ? <span className="ml-2 text-xs text-status-error">{s.fails} failed in a row</span> : null}
								</td>
								<td className="hidden px-2 sm:table-cell">{s.lastRunId ? <Link to="/runs/$runId" params={{ runId: s.lastRunId }}><Time iso={s.lastAt} /></Link> : "never"}</td>
								<td className="hidden px-2 sm:table-cell">{s.lastGood ? <Time iso={s.lastGood} /> : "never"}</td>
								<td className="hidden px-2 sm:table-cell"><Time iso={p.nextRunAt} /></td>
								<td className="px-4 text-right"><RunNowButton project={p.name} cell={{ scout: s.scout, state: s.state, at: s.lastAt, runId: s.lastRunId }} /></td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</Section>
	);
}

function ExtLink({ href, children }: { href: string | null; children: React.ReactNode }) {
	const ok = safeHref(href ?? undefined);
	return ok ? (
		<a href={ok} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1">
			{children}
			<ExternalLink aria-hidden className="size-3" />
		</a>
	) : (
		<>{children}</>
	);
}

function ProjectList({ p, narrow }: { p: ProjectDetail; narrow: boolean }) {
	const navigate = useNavigate();
	if (narrow) {
		const options = p.all.map((x) => ({ value: x.name, label: x.name }));
		return (
			<Select value={p.name} items={options} onValueChange={(v) => navigate({ to: "/projects/$id/settings", params: { id: String(v) } })}>
				<SelectTrigger aria-label="Project" className="h-9 w-full bg-card"><SelectValue /></SelectTrigger>
				<SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
			</Select>
		);
	}
	return (
		<nav aria-label="Projects" className="space-y-1">
			<SideHeading first>Projects</SideHeading>
			{p.all.map((x) => (
				<Link {...SIDE_LINK} key={x.name} to="/projects/$id/settings" params={{ id: x.name }}>
					{x.name}
					<span className="text-xs font-normal text-muted-foreground">{x.mode}</span>
				</Link>
			))}
		</nav>
	);
}

function SettingsPage() {
	const { id } = Route.useParams();
	const query = useQuery(projectQuery(id));
	const { m, savedAt } = useSave(id);
	const narrow = useNarrow();
	const p = query.data;
	if (!p) return null;
	// Show the value that waits to save at once, so the control feels instant.
	const shown: ProjectDetail = m.isPending && m.variables ? { ...p, ...m.variables } : p;
	return (
		<SettingsLayout nav={<ProjectList p={p} narrow={narrow} />}>
				<Stale query={query} />
				<div className="flex items-start justify-between gap-3">
					<div className="space-y-1">
						<h1 className="text-xl font-semibold leading-7 max-[639px]:text-lg">{p.name}</h1>
						<p className="flex flex-wrap gap-x-4 text-xs">
							<ExtLink href={`https://github.com/${p.repo}`}>{p.repo}</ExtLink>
							{p.posthog_ui ? <ExtLink href={p.posthog_ui}>PostHog project {p.posthog_project_id}</ExtLink> : null}
						</p>
					</div>
					<p role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
						{m.isPending ? "Saving…" : savedAt ? <><Check aria-hidden className="size-3.5 text-status-ok" />Saved just now</> : null}
					</p>
				</div>
				<ModeSection p={shown} save={(v) => m.mutate(v)} />
				<ScoutsSection p={p} />
				<Section title="Edit connection">
						<ProjectForm mode="edit" name={p.name} repo={p.repo} connection={p.connection} />
					</Section>
					<Section title="Project">
						<ProjectAdmin name={p.name} enabled={p.connection.enabled} />
					</Section>
		</SettingsLayout>
	);
}
