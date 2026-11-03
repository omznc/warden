import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { nonceOf } from "@/server/middleware";
import { routeTree } from "./routeTree.gen";

// A 401 from a server function means the session ended. Go to the login form and come back here.
function onUnauthorized(error: unknown): void {
	const status = error instanceof Response ? error.status : (error as { status?: number })?.status;
	if (typeof window !== "undefined" && (status === 401 || /unauthorized/i.test(String(error)))) {
		window.location.assign(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
	}
}

const serverNonce = createIsomorphicFn()
	.server(() => nonceOf(getRequest()))
	.client(() => undefined);

export function getRouter() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { staleTime: 10_000, retry: false } },
		queryCache: new QueryCache({ onError: onUnauthorized }),
	});
	const router = createRouter({
		routeTree,
		context: { queryClient },
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPendingMs: 200,
		defaultPendingComponent: PendingFallback,
		defaultErrorComponent: RouteError,
		ssr: { nonce: serverNonce() },
	});
	setupRouterSsrQueryIntegration({ router, queryClient });
	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}

import { PendingFallback, RouteError } from "@/components/states";
