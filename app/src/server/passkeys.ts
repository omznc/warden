import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { Env } from "./env";
import { readJson, writeJsonAtomic } from "./fsio";
import { checkPassword, guardedCheck } from "./limiter";

export const CHALLENGE_TTL_MS = 300_000;
const MAX_CHALLENGES = 200;
export const MAX_PASSKEYS = 20;

export type StoredPasskey = { id: string; publicKey: string; counter: number; transports: string[]; name: string; created: string };
export type PasskeyRow = { id: string; name: string; created: string };

const storePath = (e: Env) => `${e.stateRoot}/ui-passkeys.json`;

// The file is untrusted input: keep only well-formed entries.
export function readPasskeys(e: Env): StoredPasskey[] {
	const list = readJson<{ credentials?: unknown }>(storePath(e), {}).credentials;
	if (!Array.isArray(list)) return [];
	return list.flatMap((c): StoredPasskey[] => {
		const ok = c && typeof c.id === "string" && typeof c.publicKey === "string" && Number.isInteger(c.counter);
		if (!ok) return [];
		const transports = Array.isArray(c.transports) ? c.transports.filter((t: unknown): t is string => typeof t === "string") : [];
		return [{ id: c.id, publicKey: c.publicKey, counter: c.counter, transports, name: String(c.name ?? "").slice(0, 60), created: String(c.created ?? "") }];
	});
}

function writePasskeys(e: Env, credentials: StoredPasskey[]): void {
	writeJsonAtomic(storePath(e), { credentials }, 0o600);
}

export const passkeyRows = (e: Env): PasskeyRow[] => readPasskeys(e).map(({ id, name, created }) => ({ id, name, created }));

export function updateCounter(e: Env, id: string, counter: number): void {
	writePasskeys(e, readPasskeys(e).map((c) => (c.id === id ? { ...c, counter } : c)));
}

// The RP ID and the origin come from WARDEN_URL only, never from a request header.
export function relyingParty(e: Env): { rpID: string; origin: string } | null {
	if (!e.wardenUrl) return { rpID: "localhost", origin: `http://localhost:${process.env.PORT || 8650}` };
	try {
		const u = new URL(e.wardenUrl);
		const named = !u.hostname.includes(":") && !/^[\d.]+$/.test(u.hostname);
		if (named && (u.protocol === "https:" || (u.protocol === "http:" && u.hostname === "localhost"))) return { rpID: u.hostname, origin: u.origin };
	} catch {
		// An invalid URL means no passkeys.
	}
	return null;
}

function requireParty(e: Env): { rpID: string; origin: string } {
	const party = relyingParty(e);
	if (!party) throw new Error("Passkeys need WARDEN_URL with an https address.");
	return party;
}

// In memory and single use. A restart drops the open challenges, which is safe.
const challenges = new Map<string, { kind: string; expires: number }>();

export function issueChallenge(kind: string, challenge: string, now = Date.now()): void {
	for (const [c, v] of challenges) if (v.expires <= now) challenges.delete(c);
	if (challenges.size >= MAX_CHALLENGES) challenges.delete(challenges.keys().next().value as string);
	challenges.set(challenge, { kind, expires: now + CHALLENGE_TTL_MS });
}

// Delete on every check, so a challenge never works twice.
export function takeChallenge(kind: string, challenge: string, now = Date.now()): boolean {
	const v = challenges.get(challenge);
	challenges.delete(challenge);
	return Boolean(v && v.kind === kind && v.expires > now);
}

async function requirePassword(password: string, e: Env, delayMs: number): Promise<void> {
	if (!(await checkPassword(password, e, delayMs))) throw new Error("Wrong password.");
}

export async function registrationOptions(password: string, e: Env, delayMs = 1000) {
	await requirePassword(password, e, delayMs);
	const { rpID } = requireParty(e);
	const existing = readPasskeys(e);
	if (existing.length >= MAX_PASSKEYS) throw new Error("Too many passkeys. Delete one first.");
	const options = await generateRegistrationOptions({
		rpName: "Warden",
		rpID,
		userName: e.user,
		userID: new TextEncoder().encode(e.user),
		excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
		// A passkey replaces the password, so it needs a PIN or a biometric check, not only possession.
		authenticatorSelection: { residentKey: "required", userVerification: "required" },
	});
	issueChallenge("register", options.challenge);
	return options;
}

export async function registerPasskey(input: { password: string; name: string; response: RegistrationResponseJSON }, e: Env, delayMs = 1000): Promise<PasskeyRow[]> {
	await requirePassword(input.password, e, delayMs);
	const { rpID, origin } = requireParty(e);
	const verified = await verifyRegistrationResponse({
		response: input.response,
		expectedChallenge: (c) => takeChallenge("register", c),
		expectedOrigin: origin,
		expectedRPID: rpID,
		requireUserVerification: true,
	}).catch(() => null);
	if (!verified?.verified) throw new Error("Could not verify the passkey.");
	const { credential } = verified.registrationInfo;
	const entry: StoredPasskey = {
		id: credential.id,
		publicKey: Buffer.from(credential.publicKey).toString("base64url"),
		counter: credential.counter,
		transports: credential.transports ?? [],
		name: input.name.trim().slice(0, 60) || "Passkey",
		created: new Date().toISOString(),
	};
	writePasskeys(e, [...readPasskeys(e).filter((c) => c.id !== entry.id), entry]);
	return passkeyRows(e);
}

export async function deletePasskey(input: { password: string; id: string }, e: Env, delayMs = 1000): Promise<PasskeyRow[]> {
	await requirePassword(input.password, e, delayMs);
	writePasskeys(e, readPasskeys(e).filter((c) => c.id !== input.id));
	return passkeyRows(e);
}

export async function loginOptions(e: Env) {
	const { rpID } = requireParty(e);
	const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
	issueChallenge("login", options.challenge);
	return options;
}

async function verifyLogin(response: AuthenticationResponseJSON, e: Env): Promise<boolean> {
	const party = relyingParty(e);
	const stored = readPasskeys(e).find((c) => c.id === response.id);
	if (!party || !stored) return false;
	try {
		const result = await verifyAuthenticationResponse({
			response,
			expectedChallenge: (c) => takeChallenge("login", c),
			expectedOrigin: party.origin,
			expectedRPID: party.rpID,
			requireUserVerification: true,
			credential: { id: stored.id, publicKey: Buffer.from(stored.publicKey, "base64url"), counter: stored.counter, transports: stored.transports as never },
		});
		if (result.verified) updateCounter(e, stored.id, result.authenticationInfo.newCounter);
		return result.verified;
	} catch {
		return false;
	}
}

// Same limiter as the password login. Throws LockedError while locked.
export const passkeyLogin = (response: AuthenticationResponseJSON, e: Env, delayMs = 1000): Promise<boolean> => guardedCheck(() => verifyLogin(response, e), delayMs);
