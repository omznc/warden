import { resolve, sep } from "node:path";

export const NAME = /^[a-z0-9][a-z0-9-]*$/;
// Run ids are not paths. They have the form 20261103T090602Z-project-scout.
export const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isName(value: unknown): value is string {
	return typeof value === "string" && value.length <= 200 && NAME.test(value);
}

// Join strict name parts under the root. A part with a dot, a slash or a capital letter is refused.
export function stateDir(root: string, ...parts: string[]): string {
	if (!parts.every(isName)) throw new Error("bad name");
	const base = resolve(root);
	const full = resolve(base, ...parts);
	if (!full.startsWith(base + sep)) throw new Error("bad path");
	return full;
}
