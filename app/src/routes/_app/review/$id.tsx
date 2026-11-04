import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ExternalLink, Lock, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { SeverityBadge } from "@/components/badges";
import { ItemState } from "@/components/gh-state";
import { DiffView } from "@/components/diff-view";
import { EditForm, Footer } from "@/components/edit-form";
import { TestsCard } from "@/components/tests-card";
import { Button } from "@/components/ui/button";
import { Markdown, safeHref } from "@/components/markdown";
import { ActionBar } from "@/components/review-actions";
import { StatusBanner } from "@/components/review-banner";
import { Stale } from "@/components/states";
import { Time } from "@/components/time";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { money, scoutName } from "@/lib/format";
import { itemQuery } from "@/lib/queries";
import { useNarrow } from "@/lib/use-narrow";
import type { ItemDetail } from "@/lib/types";

export const Route = createFileRoute("/_app/review/$id")({
	validateSearch: z.object({ project: z.string().optional(), file: z.string().optional() }),
	loaderDeps: ({ search }) => ({ project: search.project }),
	loader: async ({ context, params, deps }) => {
		if (!(await context.queryClient.ensureQueryData(itemQuery(params.id, deps.project)))) throw notFound();
	},
	component: ReviewPage,
});

function issueUrl(item: ItemDetail): string | null {
	return item.repo && item.number ? `https://github.com/${item.repo}/issues/${item.number}` : null;
}

function ExtLink({ href, children }: { href: string | null; children: React.ReactNode }) {
	const ok = safeHref(href ?? undefined);
	if (!ok) return <>{children}</>;
	return (
		<a href={ok} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1">
			{children}
			<ExternalLink aria-hidden className="size-3" />
		</a>
	);
}

function MetaRow({ item }: { item: ItemDetail }) {
	const related = item.related_issue ? `https://github.com/${item.repo}/issues/${item.related_issue}` : null;
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
			<ItemState item={item} />
			<span>{item.project} · {scoutName(item.scout)}</span>
			{item.kind === "pr" && related ? <ExtLink href={related}>Refs #{item.related_issue}</ExtLink> : null}
			{item.kind === "pr-update" ? <ExtLink href={item.repo && item.number ? `https://github.com/${item.repo}/pull/${item.number}` : null}>Update to PR #{item.number}</ExtLink> : null}
			{item.kind === "comment" && item.number ? <ExtLink href={issueUrl(item)}>Comment on #{item.number}</ExtLink> : null}
			{item.kind === "issue" ? <span>New issue in {item.repo}</span> : null}
			<span>Created <Time iso={item.created} /></span>
			{item.edited_at ? <span>Edited <Time iso={item.edited_at} /></span> : null}
			{item.kind === "pr" ? <code className="w-full font-mono text-xs">{item.branch}</code> : null}
		</div>
	);
}

function Description({ item, onEdit }: { item: ItemDetail; onEdit: () => void }) {
	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<div className="flex items-center justify-between gap-3 border-b px-4 py-2">
				<h2 className="text-sm font-semibold">Description</h2>
				{item.status === "pending" ? (
					<Button variant="outline" size="sm" onClick={onEdit}>
						<Pencil aria-hidden />
						Edit
					</Button>
				) : null}
			</div>
			<div className="px-4 py-3">
				<Markdown>{item.body || "No description."}</Markdown>
			</div>
			<Footer footer={item.footer} />
			<p className="flex items-center gap-2 border-t bg-muted px-4 py-2.5 text-xs text-muted-foreground">
				<Lock aria-hidden className="size-3.5 shrink-0" />
				Written by {item.model ?? "the agent"}.
			</p>
		</div>
	);
}

function Source({ item }: { item: ItemDetail }) {
	const rows: [string, React.ReactNode][] = [
		["Finding", item.title],
		["Severity", <SeverityBadge key="s" severity={item.severity} />],
		["Fingerprint", <code key="f" className="font-mono text-xs">{item.fingerprint}</code>],
	];
	if (item.related_issue) rows.push(["Issue", <ExtLink key="i" href={`https://github.com/${item.repo}/issues/${item.related_issue}`}>{item.repo} #{item.related_issue}</ExtLink>]);
	if (item.run) {
		rows.push(["Run", <Link key="r" to="/runs/$runId" params={{ runId: item.run.id }}>{scoutName(item.run.scout)} · <Time iso={item.run.started} /></Link>]);
		rows.push(["Cost", `${item.run.turns ?? 0} turns · ${money(item.run.cost_usd)}`]);
	}
	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<h2 className="border-b px-4 py-3 text-sm font-semibold">Source</h2>
			<dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 px-4 py-3">
				{rows.map(([k, v]) => (
					<div key={k} className="contents">
						<dt className="text-muted-foreground">{k}</dt>
						<dd className="min-w-0 break-words">{v}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

function Header({ item, narrow, locked }: { item: ItemDetail; narrow: boolean; locked: boolean }) {
	const position = item.status === "pending" ? `1 of ${item.pendingTotal} pending` : null;
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-3">
				<Breadcrumb>
					<BreadcrumbList className="text-xs">
						<BreadcrumbItem><BreadcrumbLink render={<Link to="/review" search={{ status: "pending" }} />}>Review</BreadcrumbLink></BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>{item.project}</BreadcrumbItem>
						{position ? (
							<>
								<BreadcrumbSeparator />
								<BreadcrumbItem><BreadcrumbPage>{position}</BreadcrumbPage></BreadcrumbItem>
							</>
						) : null}
					</BreadcrumbList>
				</Breadcrumb>
				{item.nextPendingId ? (
					<Link to="/review/$id" params={{ id: item.nextPendingId }} className="inline-flex items-center gap-1 text-xs">
						Next pending <ArrowRight aria-hidden className="size-3" />
					</Link>
				) : null}
			</div>
			<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
				<div className="min-w-0 flex-1 basis-[420px] space-y-2">
					<h1 className="text-xl font-semibold leading-7 max-[639px]:text-lg">{item.title}</h1>
					<MetaRow item={item} />
				</div>
				{narrow ? null : <ActionBar item={item} locked={locked} className="flex items-center gap-2" />}
			</div>
		</div>
	);
}

// ] opens the next waiting item.
function useNextKey(next: string | null) {
	const navigate = useNavigate();
	useEffect(() => {
		const onKey = (ev: KeyboardEvent) => {
			const t = ev.target as HTMLElement;
			if (ev.key !== "]" || !next || ev.metaKey || ev.ctrlKey || t.closest("input, textarea, select, [role=dialog], [role=alertdialog]")) return;
			navigate({ to: "/review/$id", params: { id: next } });
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [next, navigate]);
}

function PrBody({ item, narrow, file, onFile, description }: { item: ItemDetail; narrow: boolean; file?: string; onFile: (f: string) => void; description: React.ReactNode }) {
	const side = (
		<div className="space-y-4">
			{description}
			<TestsCard result={item.tests} />
			<Source item={item} />
		</div>
	);
	const diff = <DiffView patch={item.diff ?? ""} file={file} onFile={onFile} collapseKey={item.id} />;
	const fileSummary = `Diff · ${item.files ?? 0} ${item.files === 1 ? "file" : "files"} +${item.add ?? 0} −${item.del ?? 0}`;
	return (
		<>
			{narrow ? (
				<Tabs defaultValue="description">
					<TabsList>
						<TabsTrigger value="description">Description</TabsTrigger>
						<TabsTrigger value="diff">{fileSummary}</TabsTrigger>
					</TabsList>
					<TabsContent value="description" className="space-y-4">{side}</TabsContent>
					<TabsContent value="diff">{diff}</TabsContent>
				</Tabs>
			) : (
				<div className="grid grid-cols-[360px_minmax(0,1fr)] gap-6">
					{side}
					{diff}
				</div>
			)}
			<p className="text-xs text-muted-foreground">
				{item.kind === "pr-update"
					? "Warden pushes only if the PR branch did not move since the run."
					: "Approve sends exactly this diff. To change it, reject and let the next run propose again, or edit the branch on GitHub after it opens."}
			</p>
		</>
	);
}

type BodyProps = { item: ItemDetail; narrow: boolean; file?: string; onFile: (f: string) => void; description: React.ReactNode };

function ItemBody(props: BodyProps) {
	const { item, description } = props;
	if (item.kind === "pr" || item.kind === "pr-update") return <PrBody {...props} />;
	return (
		<div className="grid gap-6 min-[640px]:grid-cols-[minmax(0,1fr)_360px]">
			{description ?? <div />}
			<Source item={item} />
		</div>
	);
}

function ReviewPage() {
	const { id } = Route.useParams();
	const { project, file } = Route.useSearch();
	const navigate = Route.useNavigate();
	const query = useQuery(itemQuery(id, project));
	const narrow = useNarrow();
	const [editing, setEditing] = useState(false);
	const item = query.data;
	useNextKey(item?.nextPendingId ?? null);
	if (!item) return null;
	const isEditing = editing && item.status === "pending";
	const description = isEditing ? null : <Description item={item} onEdit={() => setEditing(true)} />;
	return (
		<div className="space-y-4 max-[639px]:pb-20">
			<Stale query={query} />
			<Header item={item} narrow={narrow} locked={isEditing} />
			<StatusBanner item={item} />
			{isEditing ? <EditForm item={item} onDone={() => setEditing(false)} /> : null}
			<ItemBody item={item} narrow={narrow} file={file} description={description} onFile={(f) => navigate({ search: (s) => ({ ...s, file: f }), replace: true })} />
			{narrow ? <ActionBar item={item} locked={isEditing} className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t bg-card p-3" /> : null}
		</div>
	);
}
