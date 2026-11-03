import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { relative } from "@/lib/format";

export function PendingFallback() {
	return (
		<div className="space-y-3" aria-busy="true" aria-label="Loading">
			<Skeleton className="h-7 w-48 bg-skeleton" />
			<div className="rounded-lg border bg-card">
				{[0, 1, 2].map((n) => (
					<div key={n} className="flex items-center gap-3 border-b p-3 last:border-b-0">
						<Skeleton className="size-4 rounded-full bg-skeleton" />
						<div className="flex-1 space-y-2">
							<Skeleton className="h-3.5 w-1/2 bg-skeleton" />
							<Skeleton className="h-3 w-1/3 bg-skeleton" />
						</div>
						<Skeleton className="h-7 w-20 bg-skeleton" />
					</div>
				))}
			</div>
		</div>
	);
}

export function ErrorAlert({ title, error, onRetry, since }: { title: string; error: unknown; onRetry: () => void; since?: number }) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		<Alert variant="destructive" className="border-status-error bg-status-error-bg">
			<TriangleAlert aria-hidden />
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>
				<code className="font-mono text-xs">{message}</code>
				<div className="mt-2 flex items-center justify-between gap-3">
					{since ? <span className="text-muted-foreground">Showing data from {relative(new Date(since).toISOString()).replace(" ago", "")} ago</span> : <span />}
					<Button variant="outline" size="sm" onClick={onRetry}>
						Try again
					</Button>
				</div>
			</AlertDescription>
		</Alert>
	);
}

export function RouteError({ error }: ErrorComponentProps) {
	const router = useRouter();
	return <ErrorAlert title="Could not load this page" error={error} onRetry={() => router.invalidate()} />;
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
	return (
		<div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
			<p className="text-[13px] font-semibold">{title}</p>
			{children ? <p className="max-w-md text-muted-foreground">{children}</p> : null}
			{action}
		</div>
	);
}

// Keep the last good data on screen and say that it is old.
export function Stale({ query }: { query: { isError: boolean; error: unknown; dataUpdatedAt: number; refetch: () => unknown; data: unknown } }) {
	const [, tick] = useState(0);
	useEffect(() => {
		const t = setInterval(() => tick((n) => n + 1), 30_000);
		return () => clearInterval(t);
	}, []);
	if (!query.isError || !query.data) return null;
	return <ErrorAlert title="Could not refresh this page" error={query.error} since={query.dataUpdatedAt} onRetry={() => query.refetch()} />;
}

export function Section({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
	return (
		<section className="mt-7">
			<div className="mb-3 flex items-baseline justify-between gap-3">
				<h2 className="text-sm font-semibold">{title}</h2>
				{aside ? <div className="text-xs text-muted-foreground">{aside}</div> : null}
			</div>
			{children}
		</section>
	);
}
