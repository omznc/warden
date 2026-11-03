import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { SeverityBadge } from "@/components/badges";
import { FindingBadge, GhTimes } from "@/components/gh-state";
import { Time } from "@/components/time";
import { ACTION_HELP, scoutName } from "@/lib/format";
import type { FindingRow } from "@/lib/types";
import { safeHref } from "@/components/markdown";

// The pseudo-element of the title link covers the row. Inner controls use "relative z-10" to stay above it.
export const STRETCH = "after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring";
export const ROW_HOVER = "hover:bg-muted/50";

export function ExternalFindingLink({ f }: { f: FindingRow }) {
	const href = safeHref(f.url ?? undefined);
	if (!href) return null;
	return (
		<a href={href} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open ${f.title} on GitHub`} className="relative z-10 text-muted-foreground hover:text-foreground">
			<ExternalLink aria-hidden className="size-4" />
		</a>
	);
}

// The one real link of a row goes to the item. A finding without an item is plain text.
export function FindingTitle({ f, className }: { f: FindingRow; className?: string }) {
	if (!f.itemId) return <p className={className}>{f.title}</p>;
	return (
		<p className={className}>
			<Link to="/review/$id" params={{ id: f.itemId }} search={{ project: f.project }} className={`text-inherit no-underline ${STRETCH}`}>
				{f.title}
			</Link>
		</p>
	);
}

// One row of the findings list. It is used on the overview and on the findings page.
export function FindingRowView({ f }: { f: FindingRow }) {
	const hasLink = Boolean(f.itemId);
	return (
		<li className={`relative grid min-h-[48px] grid-cols-[84px_1fr_auto] items-center gap-x-4 gap-y-1 border-b px-4 py-2 last:border-b-0 max-[639px]:grid-cols-[1fr_auto] sm:grid-cols-[84px_1fr_auto_auto_20px] ${hasLink ? ROW_HOVER : ""}`}>
			<span className="max-[639px]:order-1"><SeverityBadge severity={f.severity} /></span>
			<div className="min-w-0 max-[639px]:order-3 max-[639px]:col-span-2">
				<FindingTitle f={f} className="truncate font-medium" />
				<p className="truncate text-xs text-muted-foreground">
					{f.project} · {scoutName(f.scout)}
					{f.fingerprint ? <span className="font-mono"> · {f.fingerprint}</span> : null}
				</p>
				{f.gh ? <p className="flex gap-2 text-xs"><GhTimes gh={f.gh} /></p> : null}
				{f.action && ACTION_HELP[f.action] ? <p className="truncate text-xs text-muted-foreground">{ACTION_HELP[f.action]}</p> : null}
			</div>
			<span className="flex items-center gap-2 max-[639px]:order-2 max-[639px]:justify-self-end"><FindingBadge f={f} /></span>
			<span className="hidden text-xs sm:block"><Time iso={f.at} className="relative z-10" /></span>
			<span className="hidden sm:block">{f.url ? <ExternalFindingLink f={f} /> : hasLink ? null : <span aria-hidden className="text-muted-foreground">—</span>}</span>
		</li>
	);
}
