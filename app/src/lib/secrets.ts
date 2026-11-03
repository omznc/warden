export const FIXED_KEYS = ["GH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "SENTRY_TOKEN", "WARDEN_POSTHOG_TOKEN", "WARDEN_POSTHOG_HOST", "HERMES_WEBHOOK_SECRET"] as const;
export const POSTHOG_PREFIX = "POSTHOG_API_KEY_";
const POSTHOG_KEY = /^POSTHOG_API_KEY_[A-Z0-9_]{1,60}$/;
const COOLIFY_KEY = /^COOLIFY_TOKEN_[A-Z0-9_]{1,40}$/;

export function isSecretKey(key: unknown): key is string {
	return typeof key === "string" && ((FIXED_KEYS as readonly string[]).includes(key) || POSTHOG_KEY.test(key) || COOLIFY_KEY.test(key));
}

export function isPosthogKey(key: unknown): key is string {
	return typeof key === "string" && POSTHOG_KEY.test(key);
}

// One line, 8 to 500 characters, no spaces. Returns an error text that never contains the value.
export function secretValueError(value: unknown): string | null {
	if (typeof value !== "string") return "Enter a value.";
	if (value.length < 8 || value.length > 500) return "The value must have 8 to 500 characters.";
	if (/\s/.test(value)) return "The value must be one line with no spaces.";
	// The runner writes a Coolify token into a quoted line of a curl config.
	if (/["\\\u0000-\u001f\u007f]/.test(value)) return "The value must not have a quote, a backslash or a control character.";
	return null;
}

// Prefer a key that other projects already use. Else take the first key.
export function pickKeyEnv(candidates: string[], used: string[]): string | null {
	return candidates.find((c) => used.includes(c)) ?? candidates[0] ?? null;
}
