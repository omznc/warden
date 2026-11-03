// Only a path on this site. This stops an open redirect after login.
export function safeRedirect(value: unknown): string {
	return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/";
}
