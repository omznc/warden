import parseDiff from "parse-diff";

export type Line = { kind: "add" | "del" | "ctx"; old?: number; next?: number; text: string };
export type DiffFile = { path: string; add: number; del: number; chunks: { header: string; lines: Line[] }[] };
export type DiffRow =
	| { t: "file"; key: string; file: DiffFile; index: number; collapsed: boolean }
	| { t: "hunk"; key: string; text: string }
	| { t: "line"; key: string; line: Line }
	| { t: "split"; key: string; left?: Line; right?: Line };

const MAX_CHARS = 500_000;

export function parsePatch(text: string): DiffFile[] {
	return parseDiff(text.slice(0, MAX_CHARS)).map((f) => ({
		path: (f.deleted ? f.from : f.to) ?? f.to ?? f.from ?? "unknown",
		add: f.additions,
		del: f.deletions,
		chunks: f.chunks.map((c) => ({
			header: c.content,
			lines: c.changes.map((ch): Line => {
				const text = ch.content.slice(1);
				if (ch.type === "add") return { kind: "add", next: ch.ln, text };
				if (ch.type === "del") return { kind: "del", old: ch.ln, text };
				return { kind: "ctx", old: ch.ln1, next: ch.ln2, text };
			}),
		})),
	}));
}

export function totalLines(files: DiffFile[]): number {
	return files.reduce((n, f) => n + f.chunks.reduce((m, c) => m + c.lines.length, 0), 0);
}

// Pair each run of deleted lines with the run of added lines that follows.
function pairLines(lines: Line[]): { left?: Line; right?: Line }[] {
	const out: { left?: Line; right?: Line }[] = [];
	let dels: Line[] = [];
	let adds: Line[] = [];
	const flush = () => {
		for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ left: dels[i], right: adds[i] });
		dels = [];
		adds = [];
	};
	for (const l of lines) {
		if (l.kind === "del") dels.push(l);
		else if (l.kind === "add") adds.push(l);
		else {
			flush();
			out.push({ left: l, right: l });
		}
	}
	flush();
	return out;
}

export function buildRows(files: DiffFile[], collapsed: ReadonlySet<string>, split: boolean): DiffRow[] {
	const rows: DiffRow[] = [];
	files.forEach((file, index) => {
		const isCollapsed = collapsed.has(file.path);
		rows.push({ t: "file", key: `f${index}`, file, index, collapsed: isCollapsed });
		if (isCollapsed) return;
		file.chunks.forEach((c, ci) => {
			rows.push({ t: "hunk", key: `f${index}h${ci}`, text: c.header });
			if (split) pairLines(c.lines).forEach((p, li) => rows.push({ t: "split", key: `f${index}h${ci}s${li}`, ...p }));
			else c.lines.forEach((line, li) => rows.push({ t: "line", key: `f${index}h${ci}l${li}`, line }));
		});
	});
	return rows;
}

// Five cells: the green share is the part of the changes that are additions.
export function barCells(add: number, del: number): ("add" | "del" | "none")[] {
	const total = add + del;
	if (total === 0) return Array(5).fill("none");
	const green = Math.min(5, Math.max(add ? 1 : 0, Math.round((add / total) * 5)));
	return Array.from({ length: 5 }, (_, i) => (i < green ? "add" : "del"));
}
