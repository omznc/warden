import { Check, Hourglass, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { safeHref } from "@/components/markdown";
import type { ItemDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

function Banner({ tone, icon, children }: { tone: "info" | "ok" | "error" | "neutral"; icon: ReactNode; children: ReactNode }) {
	const cls = { info: "bg-status-info-bg", ok: "bg-status-ok-bg", error: "bg-status-error-bg", neutral: "bg-status-neutral-bg" }[tone];
	return (
		<div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-lg px-4 py-3", cls)}>
			<span className="mt-0.5">{icon}</span>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

const DONE: Record<string, string> = { pr: "The server pushes the branch and opens a draft PR.", "pr-update": "The server pushes the new commits to the PR.", issue: "The server opens the issue.", comment: "The server posts the comment." };
const SUBMITTED: Record<string, string> = { pr: "Draft PR opened.", "pr-update": "PR updated.", issue: "Issue opened.", comment: "Comment posted." };

export function StatusBanner({ item }: { item: ItemDetail }) {
	if (item.status === "approved" || item.status === "submitting") {
		return (
			<Banner tone="info" icon={<Spinner />}>
				<strong>{item.status === "submitting" ? "Submitting…" : "Approved."}</strong> {DONE[item.kind]} This usually takes less than a minute.
			</Banner>
		);
	}
	if (item.status === "submitted") {
		const href = safeHref(item.url ?? undefined);
		return (
			<Banner tone="ok" icon={<Check aria-hidden className="size-4 text-status-ok" />}>
				<strong>{SUBMITTED[item.kind]}</strong>{" "}
				{href ? (
					<a href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium">
						Open on GitHub ↗
					</a>
				) : null}
			</Banner>
		);
	}
	if (item.status === "rejected") {
		return (
			<Banner tone="neutral" icon={<X aria-hidden className="size-4" />}>
				<strong>Rejected.</strong> Nothing was sent. {item.reject_reason ? <>Reason: <q>{item.reject_reason}</q></> : null}
				{item.feedback_recorded ? <span className="mt-0.5 block text-xs text-muted-foreground">Sent to the scout as feedback</span> : null}
			</Banner>
		);
	}
	if (item.status === "stale") {
		return (
			<Banner tone="neutral" icon={<Hourglass aria-hidden className="size-4" />}>
				<strong>Stale.</strong>{" "}
				{item.error ? `${item.error}.` : `This item is older than ${item.staleDays} days. Ask for a new run.`}
			</Banner>
		);
	}
	if (item.status === "error") {
		return (
			<Banner tone="error" icon={<TriangleAlert aria-hidden className="size-4 text-status-error" />}>
				<strong className="text-status-error">The runner could not submit this item.</strong>
				<pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{item.error ?? "Unknown error"}</pre>
			</Banner>
		);
	}
	return null;
}
