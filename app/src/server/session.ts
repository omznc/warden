import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Env } from "./env";
import { readJson, writeJsonAtomic } from "./fsio";

export const COOKIE = "warden_session";
export const SESSION_DAYS = 30;

// Without a secret the key is random per process, so sessions end on restart.
let ephemeralKey: string | null = null;

function key(e: Env): string {
	if (e.sessionSecret) return e.sessionSecret;
	if (!ephemeralKey) {
		ephemeralKey = randomBytes(32).toString("hex");
		console.warn("WARDEN_SESSION_SECRET is not set. Sessions end when the UI restarts.");
	}
	return ephemeralKey;
}

const generationPath = (e: Env) => `${e.stateRoot}/ui-session.json`;

export function sessionGeneration(e: Env): number {
	const g = readJson<{ generation?: unknown }>(generationPath(e), {}).generation;
	return typeof g === "number" && Number.isInteger(g) ? g : 0;
}

// Every cookie from an earlier generation stops working.
export function rotateGeneration(e: Env): number {
	const generation = sessionGeneration(e) + 1;
	writeJsonAtomic(generationPath(e), { generation }, 0o600);
	return generation;
}

function mac(payload: string, e: Env): string {
	return createHmac("sha256", key(e)).update(payload).digest("base64url");
}

export function createSession(e: Env, now = Date.now()): string {
	const payload = Buffer.from(JSON.stringify({ u: e.user, g: sessionGeneration(e), exp: now + SESSION_DAYS * 86_400_000 })).toString("base64url");
	return `${payload}.${mac(payload, e)}`;
}

// Returns the payload only when the signature is right.
function signedPayload(token: string, e: Env): string | null {
	const [payload, given, extra] = token.split(".");
	if (!payload || !given || extra !== undefined) return null;
	const want = Buffer.from(mac(payload, e));
	const have = Buffer.from(given);
	return want.length === have.length && timingSafeEqual(want, have) ? payload : null;
}

export function verifySession(token: string | null | undefined, e: Env, now = Date.now()): boolean {
	const payload = token && e.password ? signedPayload(token, e) : null;
	if (!payload) return false;
	try {
		const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		return data.u === e.user && (data.g ?? 0) === sessionGeneration(e) && typeof data.exp === "number" && data.exp > now;
	} catch {
		return false;
	}
}

function digest(value: string): Buffer {
	return createHash("sha256").update(value).digest();
}

// Compare fixed-size digests, so the compare time does not show where the strings differ.
export function passwordMatches(password: string, e: Env): boolean {
	return Boolean(e.password) && timingSafeEqual(digest(password), digest(e.password));
}

export function checkLogin(user: string, password: string, e: Env): boolean {
	const a = timingSafeEqual(digest(user), digest(e.user));
	return passwordMatches(password, e) && a;
}

export function readCookie(header: string | null, name: string): string | null {
	for (const part of (header ?? "").split(";")) {
		const i = part.indexOf("=");
		if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
	}
	return null;
}

export function isHttps(req: Request): boolean {
	return req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" || new URL(req.url).protocol === "https:";
}

export function sessionCookie(value: string, req: Request, maxAge = SESSION_DAYS * 86_400): string {
	return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${isHttps(req) ? "; Secure" : ""}`;
}

export function hasSession(req: Request, e: Env): boolean {
	return verifySession(readCookie(req.headers.get("cookie"), COOKIE), e);
}
