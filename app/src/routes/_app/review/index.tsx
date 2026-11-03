import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { z } from "zod";
import { KindIcon } from "@/components/badges";
import { ItemState } from "@/components/gh-state";
import { EmptyState, Stale } from "@/components/states";
import { Time } from "@/components/time";
import { scoutName } from "@/lib/format";
import { reviewQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const STATUSES = ["pending", "approved", "submitted", "rejected", "stale", "error"] as const;

export const Route = createFileRoute("/_app/review/")({
	validateSearch: z.object({ status: z.enum(STATUSES).catch("pending").default("pending") }),
	loaderDeps: ({ search }) => ({ status: search.status }),
	loader: ({ context, deps }) => context.queryClient.ensureQueryData(reviewQuery(deps.status)),
	component: ReviewQueue,
});

function ReviewQueue() {
	const { status } = Route.useSearch();
	const query = useQuery(reviewQuery(status));
	const items = query.data ?? [];
	return (
		<div className="space-y-4">
			<Stale query={query} />
			<h1 className="text-xl font-semibold leading-7 max-[639px]:text-lg">Review</h1>
			<nav aria-label="Status" className="flex flex-wrap gap-1.5">
				{STATUSES.map((s) => (
					<Link
						key={s}
						to="/review"
						search={{ status: s }}
						className={cn("rounded-full border px-3 py-1 text-xs capitalize text-muted-foreground no-underline", s === status && "border-foreground bg-foreground font-medium text-background")}
					>
						{s}
					</Link>
				))}
			</nav>
			{items.length === 0 ? (
				<div className="rounded-lg border bg-card">
					<EmptyState
						title={
							status === "pending" ? (
								<span className="inline-flex items-center gap-1.5 text-status-ok">
									<Check aria-hidden className="size-4" />
									Nothing waits for you
								</span>
							) : (
								`No ${status} items`
							)
						}
					>
						{status === "pending" ? "New issues, comments and PRs show here after the next run." : "Items with this status show here."}
					</EmptyState>
				</div>
			) : (
				<ul className="divide-y rounded-lg border bg-card">
					{items.map((i) => (
						<li key={`${i.project}/${i.id}`}>
							<Link to="/review/$id" params={{ id: i.id }} search={{ project: i.project }} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 text-foreground no-underline hover:bg-muted/50 max-[639px]:flex-wrap">
								<KindIcon kind={i.kind} />
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium">{i.title}</p>
									<p className="truncate text-xs text-muted-foreground">
										{i.project} · {scoutName(i.scout)}
									</p>
								</div>
								<ItemState item={i} />
								<span className="text-xs"><Time iso={i.created} /></span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
