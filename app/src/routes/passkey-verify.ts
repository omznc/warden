import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { env } from "@/server/env";
import { LockedError } from "@/server/limiter";
import { passkeyLogin } from "@/server/passkeys";
import { createSession, sessionCookie } from "@/server/session";

const body = z.object({ id: z.string().max(1024) }).passthrough();
const FAIL_DELAY_MS = 1000;

// Open without a session, on purpose: this is a login. It is a POST, so the Origin check applies.
async function verify(request: Request): Promise<Response> {
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return Response.json({ error: "Bad request." }, { status: 400 });
	const e = env();
	try {
		if (!(await passkeyLogin(parsed.data as never, e, FAIL_DELAY_MS))) return Response.json({ error: "Passkey sign-in failed." }, { status: 401 });
	} catch (err) {
		if (err instanceof LockedError) return Response.json({ error: err.message }, { status: 429 });
		throw err;
	}
	return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(createSession(e), request) } });
}

export const Route = createFileRoute("/passkey-verify")({
	server: { handlers: { POST: ({ request }) => verify(request) } },
});
