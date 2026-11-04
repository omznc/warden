import { queryOptions } from "@tanstack/react-query";
import type { FindingsFilter } from "@/lib/types";
import { getConnections, getCoolify, getCost, getFindings, getFixRuns, getItem, getOverview, getProject, getProjectList, getIntegrations, getRejectDays, getRun, getRuns, getSecrets, getShell, getStale, listReview } from "@/server/fns";

const POLL = 30_000;
const FAST = 5000;

export const shellQuery = () => queryOptions({ queryKey: ["shell"], queryFn: () => getShell(), refetchInterval: POLL });
export const overviewQuery = () => queryOptions({ queryKey: ["overview"], queryFn: () => getOverview(), refetchInterval: POLL });
export const reviewQuery = (status: "pending" | "approved" | "submitted" | "rejected" | "stale" | "error") =>
	queryOptions({ queryKey: ["review", status], queryFn: () => listReview({ data: { status } }), refetchInterval: POLL });
// Poll fast while the item is approved or its tests are not finished.
export const itemQuery = (id: string, project?: string) =>
	queryOptions({
		queryKey: ["item", id, project ?? ""],
		queryFn: () => getItem({ data: { id, project } }),
		refetchInterval: (q) => {
			const live = q.state.data?.tests?.status;
			const s = q.state.data?.status;
			return s === "approved" || s === "submitting" || live === "queued" || live === "running" ? FAST : POLL;
		},
	});
export const findingsQuery = (filters: FindingsFilter) => ({
	queryKey: ["findings", filters] as const,
	queryFn: ({ pageParam }: { pageParam: number }) => getFindings({ data: { filters, cursor: pageParam } }),
	initialPageParam: 0,
	getNextPageParam: (last: { next: number | null }) => last.next ?? undefined,
});
export const runsQuery = (f: { project?: string; scout?: string; status?: string }) =>
	queryOptions({ queryKey: ["runs", f], queryFn: () => getRuns({ data: f }), refetchInterval: POLL });
export const runQuery = (id: string) => queryOptions({ queryKey: ["run", id], queryFn: () => getRun({ data: { id } }), refetchInterval: POLL });
export const projectQuery = (id: string) => queryOptions({ queryKey: ["project", id], queryFn: () => getProject({ data: { id } }), refetchInterval: 10_000 });
export const costQuery = () => queryOptions({ queryKey: ["cost"], queryFn: () => getCost(), refetchInterval: POLL });
export const staleQuery = () => queryOptions({ queryKey: ["stale-days"], queryFn: () => getStale(), refetchInterval: POLL });
export const rejectQuery = () => queryOptions({ queryKey: ["reject-days"], queryFn: () => getRejectDays(), refetchInterval: POLL });
export const fixRunsQuery = () => queryOptions({ queryKey: ["fix-runs"], queryFn: () => getFixRuns(), refetchInterval: POLL });
// Poll fast while a test notice waits for the runner.
export const integrationsQuery = () =>
	queryOptions({ queryKey: ["integrations"], queryFn: () => getIntegrations(), refetchInterval: (q) => (q.state.data?.test.requested ? 2000 : POLL) });
export const secretsQuery = () => queryOptions({ queryKey: ["secrets"], queryFn: () => getSecrets(), refetchInterval: FAST * 2 });
export const projectListQuery = () => queryOptions({ queryKey: ["project-list"], queryFn: () => getProjectList(), refetchInterval: 10_000 });
export const connectionsQuery = () => queryOptions({ queryKey: ["connections"], queryFn: () => getConnections(), refetchInterval: 10_000 });
export const coolifyQuery = () => queryOptions({ queryKey: ["coolify"], queryFn: () => getCoolify(), refetchInterval: FAST * 2 });
