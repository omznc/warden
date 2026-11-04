import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/server/env";
import { loginOptions, relyingParty } from "@/server/passkeys";

// Open without a session, on purpose: the login page calls it. It is a POST, so the Origin check applies.
async function options(): Promise<Response> {
	const e = env();
	if (!relyingParty(e)) return Response.json({ error: "Passkeys need WARDEN_URL with an https address." }, { status: 503 });
	return Response.json(await loginOptions(e));
}

export const Route = createFileRoute("/passkey-options")({
	server: { handlers: { POST: () => options() } },
});
