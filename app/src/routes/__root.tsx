/// <reference types="vite/client" />
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import appCss from "@/styles.css?url";

const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2318181B' stroke-width='2'%3E%3Cpath d='M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z'/%3E%3C/svg%3E";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
	head: () => ({
		meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { name: "color-scheme", content: "light dark" }],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", href: ICON },
		],
	}),
	shellComponent: RootDocument,
	component: () => <Outlet />,
	notFoundComponent: () => (
		<div className="mx-auto max-w-md py-24 text-center">
			<p className="text-sm font-semibold">Page not found</p>
			<Link to="/" className="text-link underline">
				Back to the overview
			</Link>
		</div>
	),
});

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<TooltipProvider delay={300}>{children}</TooltipProvider>
				<Toaster position="bottom-right" />
				<Scripts />
			</body>
		</html>
	);
}
