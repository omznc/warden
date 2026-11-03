import { exactTime, relative } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Relative time. The exact time shows on hover. The server and the browser can differ by a minute, so the text is not hydration-checked.
export function Time({ iso, className }: { iso: string | null | undefined; className?: string }) {
	if (!iso || Number.isNaN(Date.parse(iso))) return <span className={className}>never</span>;
	return (
		<Tooltip>
			<TooltipTrigger
				render={<time dateTime={iso} suppressHydrationWarning className={`tabular cursor-default underline decoration-dotted decoration-muted-foreground/60 underline-offset-4 ${className ?? ""}`} />}
			>
				{relative(iso)}
			</TooltipTrigger>
			<TooltipContent>{exactTime(iso)}</TooltipContent>
		</Tooltip>
	);
}
