import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readText(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

export function readJson<T>(path: string, fallback: T): T {
	try {
		return JSON.parse(readText(path)) as T;
	} catch {
		return fallback;
	}
}

// Temp file and rename: a reader never sees a partial file. The mode is for files that hold secrets.
export function writeJsonAtomic(path: string, value: unknown, mode = 0o644): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(value, null, 2), { mode });
	chmodSync(tmp, mode);
	renameSync(tmp, path);
}
