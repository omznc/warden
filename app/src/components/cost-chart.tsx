import { money } from "@/lib/format";
import type { CostView } from "@/lib/types";
import { cn } from "@/lib/utils";

const HEIGHT = 80;

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="tabular text-base font-semibold leading-6">{children}</p>
		</div>
	);
}

function dayLabel(date: string): string {
	return String(Number(date.slice(8, 10)));
}

// Notional cost per day. Plain elements, no chart library. Hover or focus a bar for the amount.
export function CostChart({ cost }: { cost: CostView }) {
	const max = Math.max(0.01, ...cost.days.map((d) => d.usd), cost.cap ?? 0);
	const capAt = cost.cap ? (cost.cap / max) * HEIGHT : null;
	return (
		<section aria-label="Cost" className="rounded-lg border bg-card p-4">
			<div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
				<div className="flex flex-wrap gap-x-8 gap-y-2">
					<Stat label="Today">{money(cost.today)}</Stat>
					<Stat label="Daily cap">{cost.cap ? money(cost.cap) : "No cap"}</Stat>
					<Stat label="Last 14 days">{money(cost.total)}</Stat>
				</div>
				<p className="text-xs text-muted-foreground">Notional cost: what the tokens would cost at API prices. Days are in UTC.</p>
			</div>
			<ul className="relative mt-4 flex items-end gap-1" style={{ height: HEIGHT + 20 }}>
				{capAt !== null ? (
					<li aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-status-pending" style={{ bottom: capAt + 20 }} />
				) : null}
				{cost.days.map((d, i) => {
					const today = i === cost.days.length - 1;
					return (
						<li key={d.date} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.date}: ${money(d.usd)}`}>
							<span className={cn("tabular hidden text-[10px] leading-3 text-muted-foreground min-[900px]:block", d.usd === 0 && "invisible")}>{d.usd >= 10 ? Math.round(d.usd) : d.usd.toFixed(1)}</span>
							<span
								className={cn("w-full max-w-7 rounded-t-sm", today ? "bg-foreground" : "bg-status-info", d.usd === 0 && "bg-border")}
								style={{ height: Math.max(2, (d.usd / max) * HEIGHT) }}
							/>
							<span className={cn("tabular text-[10px] leading-3 text-muted-foreground", today && "font-semibold text-foreground")}>{dayLabel(d.date)}</span>
							<span className="sr-only">{d.date}: {money(d.usd)}</span>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
