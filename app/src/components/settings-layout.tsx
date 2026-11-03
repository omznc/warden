import type { ReactNode } from "react";

// The page layout of every settings page: a side menu and a content column.
export function SettingsLayout({ nav, children }: { nav: ReactNode; children: ReactNode }) {
	return (
		<div className="grid gap-6 min-[640px]:grid-cols-[200px_minmax(0,1fr)]">
			{nav}
			<div className="min-w-0 space-y-4">{children}</div>
		</div>
	);
}

export function SideHeading({ children, first }: { children: ReactNode; first?: boolean }) {
	return <p className={first ? "px-2.5 pb-1 text-xs text-muted-foreground" : "px-2.5 pb-1 pt-3 text-xs text-muted-foreground"}>{children}</p>;
}

// Props for a router Link in the side menu. Spread them: <Link {...SIDE_LINK} to="...">.
export const SIDE_LINK = {
	className: "flex h-8 items-center justify-between rounded-lg border border-transparent px-2.5 text-foreground no-underline hover:bg-muted",
	activeProps: { className: "border-border bg-card font-semibold" },
} as const;
