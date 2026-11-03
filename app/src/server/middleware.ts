import { randomBytes } from "node:crypto";
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "./env";
import { checkRequest, requireSession } from "./guard";

const nonces = new WeakMap<Request, string>();

export function nonceOf(req: Request): string | undefined {
	return nonces.get(req);
}

function csp(nonce: string): string {
	return [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}'`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self'",
		"connect-src 'self'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	].join("; ");
}

// First in line for every request: health, the 503 without a password, the Origin check and the headers.
export const requestGuard = createMiddleware().server(async ({ next }) => {
	const req = getRequest();
	const blocked = checkRequest(req, env());
	if (blocked) return blocked;
	const nonce = randomBytes(16).toString("base64");
	nonces.set(req, nonce);
	const result = await next();
	const h = result.response.headers;
	h.set("Content-Security-Policy", csp(nonce));
	h.set("X-Content-Type-Options", "nosniff");
	h.set("Referrer-Policy", "same-origin");
	h.set("Cache-Control", "no-store");
	return result;
});

// Every server function is an endpoint that anyone can call. Each one needs a session.
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
	requireSession(getRequest(), env());
	return next();
});
