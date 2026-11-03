import type { Env } from "./env";
import { hasSession } from "./session";

export function sameOrigin(req: Request): boolean {
	const host = req.headers.get("host");
	const source = req.headers.get("origin") ?? req.headers.get("referer");
	if (!host || !source) return false;
	try {
		return new URL(source).host === host;
	} catch {
		return false;
	}
}

function text(body: string, status: number): Response {
	return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

// Runs for every request. A Response is the final answer. null lets the request go on.
export function checkRequest(req: Request, e: Env): Response | null {
	if (new URL(req.url).pathname === "/health") return text("ok", 200);
	if (!e.password) return text("service unavailable: WARDEN_PASSWORD is not set", 503);
	const safe = req.method === "GET" || req.method === "HEAD";
	if (!safe && !sameOrigin(req)) return text("forbidden", 403);
	return null;
}

// Runs for every server function. A server function is a POST or GET endpoint that anyone can call.
export function requireSession(req: Request, e: Env): void {
	if (!hasSession(req, e)) throw new Response("unauthorized", { status: 401 });
}
