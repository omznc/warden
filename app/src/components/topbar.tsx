import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Clock, LogOut, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { relative } from "@/lib/format";
import { shellQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const NAV = [
	{ to: "/", label: "Overview" },
	{ to: "/review", label: "Review" },
	{ to: "/findings", label: "Findings" },
	{ to: "/runs", label: "Runs" },
	{ to: "/projects", label: "Projects" },
	{ to: "/settings", label: "Settings" },
] as const;

function NextRun({ iso }: { iso: string | null }) {
	if (!iso) return <span className="text-muted-foreground">Next run not planned yet</span>;
	return (
		<span className="inline-flex items-center gap-1.5 text-muted-foreground">
			<Clock aria-hidden className="size-3.5" />
			Next run <span suppressHydrationWarning>{Date.parse(iso) < Date.now() ? "due now" : relative(iso)}</span>
		</span>
	);
}

export function TopBar() {
	const { data } = useQuery(shellQuery());
	const count = data?.pendingCount ?? 0;
	return (
		<header className="border-b bg-card">
			<div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-5 px-4 sm:px-6 min-[640px]:h-12 min-[640px]:flex-nowrap">
				<Link to="/" className="flex h-11 items-center gap-2 text-sm font-semibold text-foreground no-underline">
					<Shield aria-hidden className="size-[18px]" />
					Warden
				</Link>
				<nav aria-label="Main" className="order-3 -mx-4 flex w-[calc(100%+2rem)] gap-5 overflow-x-auto px-4 max-[639px]:h-9 min-[640px]:order-none min-[640px]:mx-0 min-[640px]:w-auto min-[640px]:px-0">
					{NAV.map((n) => (
						<Link
							key={n.to}
							to={n.to}
							activeOptions={{ exact: n.to === "/" }}
							className="inline-flex items-center gap-1.5 border-b-2 border-transparent py-3 text-muted-foreground no-underline hover:text-foreground min-[640px]:h-12 max-[639px]:py-2"
							activeProps={{ className: "border-foreground font-medium text-foreground" }}
						>
							{n.label}
							{n.to === "/review" && count > 0 ? (
								<span className={cn("rounded-full bg-status-pending-bg px-1.5 text-[11px] font-semibold leading-4 text-status-pending")} aria-label={`${count} waiting`}>
									{count}
								</span>
							) : null}
						</Link>
					))}
				</nav>
				<div className="ml-auto flex h-11 items-center gap-3 text-xs">
					<NextRun iso={data?.nextRunAt ?? null} />
					<form method="post" action="/logout">
						<Button type="submit" variant="ghost" size="icon-sm" aria-label="Sign out">
							<LogOut aria-hidden />
						</Button>
					</form>
				</div>
			</div>
		</header>
	);
}
