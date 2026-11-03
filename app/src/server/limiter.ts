import type { Env } from "./env";
import { passwordMatches, rotateGeneration } from "./session";

export const MAX_FAILURES = 5;
export const WINDOW_MS = 600_000;
export const LOCK_MS = 600_000;

// Process-wide. One user, so one counter covers login and every password check.
let failures: number[] = [];
let lockedUntil = 0;

export function resetLimiter(): void {
	failures = [];
	lockedUntil = 0;
}

export class LockedError extends Error {
	constructor(readonly minutes: number) {
		super(`Too many failed attempts. Try again in ${minutes} min.`);
	}
}

function recordFailure(now: number): void {
	failures = [...failures.filter((t) => now - t < WINDOW_MS), now];
	if (failures.length >= MAX_FAILURES) {
		lockedUntil = now + LOCK_MS;
		failures = [];
	}
}

// Run a password check. Refuse while locked. A failure waits delayMs, then counts.
export async function guardedCheck(check: () => boolean, delayMs = 1000, now = Date.now()): Promise<boolean> {
	if (now < lockedUntil) throw new LockedError(Math.ceil((lockedUntil - now) / 60_000));
	if (check()) return true;
	recordFailure(now);
	await new Promise((r) => setTimeout(r, delayMs));
	return false;
}

export const checkPassword = (password: string, e: Env, delayMs = 1000, now = Date.now()): Promise<boolean> =>
	guardedCheck(() => passwordMatches(password, e), delayMs, now);

// Ends every session, this one too. The password check is the same as for a secret.
export async function signOutEverywhere(password: string, e: Env, delayMs = 1000): Promise<void> {
	if (!(await checkPassword(password, e, delayMs))) throw new Error("Wrong password.");
	rotateGeneration(e);
}
