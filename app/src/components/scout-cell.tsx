import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, CircleAlert, CircleDashed, Clock, Loader, Play, SkipForward } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Time } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { scoutName } from "@/lib/format";
import type { CellState, ScoutCell } from "@/lib/types";
import { cn } from "@/lib/utils";
import { startRunFn } from "@/server/fns";

const LABEL: Record<CellState, string> = { ok: "OK", error: "Error", running: "Running…", requested: "Starting…", late: "Late", never: "Never run", skipped: "Skipped" };

function StateIcon({ state }: { state: CellState }) {
	const cls = "size-3.5 shrink-0";
	if (state === "ok") return <Check aria-hidden className={cn(cls, "text-status-ok")} />;
	if (state === "error") return <CircleAlert aria-hidden className={cn(cls, "text-status-error")} />;
	if (state === "running" || state === "requested") return <Loader aria-hidden className={cn(cls, "animate-spin text-status-info")} />;
	if (state === "skipped") return <SkipForward aria-hidden className={cn(cls, "text-muted-foreground")} />;
	if (state === "late") return <Clock aria-hidden className={cn(cls, "text-status-pending")} />;
	return <CircleDashed aria-hidden className={cn(cls, "text-muted-foreground")} />;
}

const TEXT: Record<CellState, string> = { ok: "", error: "font-medium text-status-error", running: "text-status-info", requested: "text-status-info", late: "text-status-pending", never: "text-muted-foreground", skipped: "text-muted-foreground" };

// A status icon with a word for each state that is not OK, so colour is never the only signal.
export function ScoutCellView({ cell }: { cell: ScoutCell }) {
	const body: ReactNode = (
		<span className="inline-flex items-center gap-1.5">
			<StateIcon state={cell.state} />
			{cell.state !== "ok" ? <span className={TEXT[cell.state]}>{LABEL[cell.state]}</span> : null}
			{cell.at && cell.state !== "running" && cell.state !== "requested" ? <Time iso={cell.at} /> : null}
			{cell.state === "ok" ? <span className="sr-only">OK</span> : null}
		</span>
	);
	return cell.runId ? (
		<Link to="/runs/$runId" params={{ runId: cell.runId }} className="text-foreground no-underline hover:underline">
			{body}
		</Link>
	) : (
		body
	);
}

export function useStartRuns() {
	const client = useQueryClient();
	const [busy, setBusy] = useState(false);
	const start = async (project: string, scouts: string[]) => {
		setBusy(true);
		try {
			await Promise.all(scouts.map((scout) => startRunFn({ data: { project, scout } })));
			toast.success(scouts.length === 1 ? `Run started: ${scoutName(scouts[0])} on ${project}` : `Run started: ${scouts.length} scouts on ${project}`);
			await client.invalidateQueries();
		} catch (e) {
			toast.error(`Could not start the run: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy(false);
		}
	};
	return { busy, start };
}

const LIVE = new Set<CellState>(["running", "requested"]);

// One scout. The state comes from the server, so the button stays off on every screen while the scout runs.
export function RunNowButton({ project, cell, label = "Run now" }: { project: string; cell: ScoutCell; label?: string }) {
	const { busy, start } = useStartRuns();
	const live = LIVE.has(cell.state);
	return (
		<Button variant="outline" size="sm" disabled={busy || live} onClick={() => start(project, [cell.scout])}>
			{busy || live ? <Spinner /> : <Play aria-hidden />}
			{cell.state === "requested" ? "Starting…" : busy || live ? "Running…" : label}
		</Button>
	);
}

// All idle scouts of a project.
export function RunAllButton({ project, cells, off }: { project: string; cells: ScoutCell[]; off?: boolean }) {
	const { busy, start } = useStartRuns();
	const idle = cells.filter((c) => !LIVE.has(c.state)).map((c) => c.scout);
	return (
		<Button variant="outline" size="icon" aria-label={`Run all scouts of ${project}`} title="Run all scouts now" disabled={busy || off || idle.length === 0} onClick={() => start(project, idle)}>
			{busy ? <Spinner /> : <Play aria-hidden />}
		</Button>
	);
}
