import { cn } from "@/lib/utils";

// The app follows prefers-color-scheme, so the picture switches the same way.
export function Logo({ className }: { className?: string }) {
	return (
		<picture>
			<source media="(prefers-color-scheme: dark)" srcSet="/warden-lockup-dark.svg" />
			<img src="/warden-lockup-light.svg" alt="Warden" width={157} height={48} className={cn("w-auto", className)} />
		</picture>
	);
}
