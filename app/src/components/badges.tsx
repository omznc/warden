import { Check, CircleDashed, CircleDot, Clock, GitPullRequest, Hourglass, Loader, MessageSquare, SkipForward, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { actionGroup, actionLabel, normSeverity } from "@/lib/format";
import type { ItemKind, ItemStatus, RunStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export type Tone = "ok" | "error" | "pending" | "info" | "neutral";

const TONE: Record<Tone, string> = {
	ok: "bg-status-ok-bg text-status-ok",
	error: "bg-status-error-bg text-status-error",
	pending: "bg-status-pending-bg text-status-pending",
	info: "bg-status-info-bg text-status-info",
	neutral: "bg-status-neutral-bg text-status-neutral",
};

export function Pill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
	return <Badge className={cn("h-5 px-2 text-xs font-medium", TONE[tone], className)}>{children}</Badge>;
}

const ITEM: Record<ItemStatus, { tone: Tone; label: string; icon: ReactNode }> = {
	pending: { tone: "pending", label: "Pending approval", icon: <Clock aria-hidden /> },
	approved: { tone: "info", label: "Approved", icon: <Loader aria-hidden /> },
	submitting: { tone: "info", label: "Submitting…", icon: <Loader aria-hidden /> },
	submitted: { tone: "ok", label: "Submitted", icon: <Check aria-hidden /> },
	rejected: { tone: "neutral", label: "Rejected", icon: <X aria-hidden /> },
	stale: { tone: "neutral", label: "Stale", icon: <Hourglass aria-hidden /> },
	error: { tone: "error", label: "Error", icon: <TriangleAlert aria-hidden /> },
};

export function ItemStatusBadge({ status }: { status: ItemStatus }) {
	const s = ITEM[status] ?? ITEM.pending;
	return (
		<Pill tone={s.tone}>
			{s.icon}
			{s.label}
		</Pill>
	);
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
	if (status === "skipped") {
		return (
			<Pill tone="neutral">
				<SkipForward aria-hidden />
				Skipped
			</Pill>
		);
	}
	return status === "ok" ? (
		<Pill tone="ok">
			<Check aria-hidden />
			OK
		</Pill>
	) : (
		<Pill tone="error">
			<TriangleAlert aria-hidden />
			Error
		</Pill>
	);
}

const ACTION_TONE = { issue: "info", comment: "neutral", pr: "info", pending: "pending", dry: "neutral", skipped: "neutral", blocked: "error", other: "neutral" } as const;

export function ActionBadge({ action }: { action: string | undefined }) {
	return <Pill tone={ACTION_TONE[actionGroup(action)]}>{actionLabel(action)}</Pill>;
}

const SEV = {
	high: { label: "High", bars: 3, cls: "text-status-error" },
	medium: { label: "Medium", bars: 2, cls: "text-status-pending" },
	low: { label: "Low", bars: 1, cls: "text-status-neutral" },
};

export function SeverityBadge({ severity }: { severity: string | undefined }) {
	const s = SEV[normSeverity(severity)];
	return (
		<span className={cn("inline-flex items-center gap-1.5 text-[13px] font-semibold", s.cls)}>
			<span aria-hidden className="flex items-end gap-px">
				{[1, 2, 3].map((n) => (
					<span key={n} className={cn("w-[3px] rounded-[1px] bg-current", n === 1 ? "h-1.5" : n === 2 ? "h-2.5" : "h-3.5", n > s.bars && "opacity-25")} />
				))}
			</span>
			{s.label}
		</span>
	);
}

export function KindIcon({ kind, className }: { kind: ItemKind; className?: string }) {
	const Icon = kind === "pr" || kind === "pr-update" ? GitPullRequest : kind === "comment" ? MessageSquare : CircleDot;
	return <Icon aria-hidden className={cn("size-4 text-status-pending", className)} />;
}

export const KIND_LABEL: Record<ItemKind, string> = { issue: "Issue", comment: "Comment", pr: "Pull request", "pr-update": "PR update" };

export function approveLabel(item: { kind: ItemKind; number?: number | null }): string {
	if (item.kind === "pr-update") return `Approve and push to PR #${item.number ?? "?"}`;
	return { issue: "Approve and open issue", comment: "Approve and post comment", pr: "Approve and open draft PR" }[item.kind];
}

export function NeverIcon() {
	return <CircleDashed aria-hidden className="size-3.5" />;
}
