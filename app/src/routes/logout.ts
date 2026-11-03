import { createFileRoute } from "@tanstack/react-router";
import { sessionCookie } from "@/server/session";

export const Route = createFileRoute("/logout")({
	server: {
		handlers: {
			POST: ({ request }) => new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": sessionCookie("", request, 0) } }),
		},
	},
});
