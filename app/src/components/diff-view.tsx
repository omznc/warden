import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { barCells, buildRows, type DiffFile, type DiffRow, type Line, parsePatch, totalLines } from "@/lib/diff";
import { cn } from "@/lib/utils";

const VIRTUAL_ABOVE = 500;
const ROW = 20;

const KIND = {
	add: { row: "bg-diff-add text-foreground", gutter: "bg-diff-add-gutter text-diff-add-fg", sign: "+" },
	del: { row: "bg-diff-del text-foreground", gutter: "bg-diff-del-gutter text-diff-del-fg", sign: "−" },
	ctx: { row: "", gutter: "text-muted-foreground", sign: "" },
};

const GRID = "grid grid-cols-[40px_16px_minmax(0,1fr)] min-[640px]:grid-cols-[44px_44px_16px_minmax(0,1fr)]";

function Counts({ add, del }: { add: number; del: number }) {
	return (
		<span className="tabular font-mono text-xs">
			<span className="text-diff-add-fg">+{add}</span> <span className="text-diff-del-fg">−{del}</span>
		</span>
	);
}

function Bar({ add, del }: { add: number; del: number }) {
	return (
		<span aria-hidden className="inline-flex gap-px">
			{barCells(add, del).map((c, i) => (
				<span key={i} className={cn("size-2 rounded-[1px]", c === "add" ? "bg-diff-add-fg" : c === "del" ? "bg-diff-del-fg" : "bg-border")} />
			))}
		</span>
	);
}

function LineView({ line, wrap }: { line: Line; wrap: boolean }) {
	const k = KIND[line.kind];
	return (
		<div className={cn(GRID, "font-mono text-xs leading-5", k.row)}>
			<span className={cn("hidden select-none px-1 text-right min-[640px]:block", k.gutter)}>{line.old ?? ""}</span>
			<span className={cn("select-none px-1 text-right", k.gutter)}>
				<span className="min-[640px]:hidden">{line.next ?? line.old ?? ""}</span>
				<span className="hidden min-[640px]:inline">{line.next ?? ""}</span>
			</span>
			<span aria-label={line.kind === "add" ? "added" : line.kind === "del" ? "removed" : undefined} className={cn("select-none text-center", k.gutter)}>{k.sign}</span>
			<code className={cn("px-2", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>{line.text}</code>
		</div>
	);
}

function Half({ line, wrap }: { line?: Line; wrap: boolean }) {
	if (!line) return <div className="bg-muted/40" />;
	const k = KIND[line.kind];
	return (
		<div className={cn("grid grid-cols-[44px_16px_minmax(0,1fr)] font-mono text-xs leading-5", k.row)}>
			<span className={cn("select-none px-1 text-right", k.gutter)}>{line.kind === "del" ? line.old : line.next}</span>
			<span aria-label={line.kind === "add" ? "added" : line.kind === "del" ? "removed" : undefined} className={cn("select-none text-center", k.gutter)}>{k.sign}</span>
			<code className={cn("px-2", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>{line.text}</code>
		</div>
	);
}

type Handlers = { onToggle: (path: string) => void; onViewed: (path: string, v: boolean) => void; viewed: ReadonlySet<string>; wrap: boolean; active: number };

function FileHeader({ row, h, sticky }: { row: Extract<DiffRow, { t: "file" }>; h: Handlers; sticky: boolean }) {
	const { file } = row;
	return (
		<div id={`file-${row.index}`} className={cn("flex h-10 items-center gap-2 border-b bg-muted px-3", sticky && "sticky top-0 z-10", h.active === row.index && "bg-accent")}>
			<button type="button" aria-expanded={!row.collapsed} aria-label={`${row.collapsed ? "Expand" : "Collapse"} ${file.path}`} onClick={() => h.onToggle(file.path)} className="grid size-6 place-items-center rounded-sm hover:bg-background">
				{row.collapsed ? <ChevronRight aria-hidden className="size-4" /> : <ChevronDown aria-hidden className="size-4" />}
			</button>
			<span dir="rtl" className="min-w-0 flex-1 truncate text-left font-mono text-xs font-medium"><bdi>{file.path}</bdi></span>
			<Counts add={file.add} del={file.del} />
			<label className="flex items-center gap-1.5 text-xs text-muted-foreground">
				<Checkbox checked={h.viewed.has(file.path)} onCheckedChange={(v) => h.onViewed(file.path, v === true)} aria-label={`Mark ${file.path} as viewed`} />
				Viewed
			</label>
		</div>
	);
}

function RowView({ row, h, sticky }: { row: DiffRow; h: Handlers; sticky: boolean }): ReactNode {
	if (row.t === "file") return <FileHeader row={row} h={h} sticky={sticky} />;
	if (row.t === "hunk") return <div className="truncate bg-diff-hunk px-3 font-mono text-xs leading-5 text-muted-foreground">{row.text}</div>;
	if (row.t === "line") return <LineView line={row.line} wrap={h.wrap} />;
	return (
		<div className="grid grid-cols-2 divide-x">
			<Half line={row.left} wrap={h.wrap} />
			<Half line={row.right} wrap={h.wrap} />
		</div>
	);
}

function VirtualRows({ rows, h, scrollTo }: { rows: DiffRow[]; h: Handlers; scrollTo: number | null }) {
	const ref = useRef<HTMLDivElement>(null);
	const v = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current, estimateSize: () => ROW, overscan: 30 });
	useEffect(() => {
		if (scrollTo === null) return;
		const at = rows.findIndex((r) => r.t === "file" && r.index === scrollTo);
		if (at >= 0) v.scrollToIndex(at, { align: "start" });
	}, [scrollTo]); // eslint-disable-line react-hooks/exhaustive-deps
	return (
		<div ref={ref} className="max-h-[75vh] overflow-auto" data-virtual>
			<div className="relative" style={{ height: v.getTotalSize() }}>
				{v.getVirtualItems().map((item) => (
					<div key={rows[item.index].key} data-index={item.index} ref={v.measureElement} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${item.start}px)` }}>
						<RowView row={rows[item.index]} h={h} sticky={false} />
					</div>
				))}
			</div>
		</div>
	);
}

export function DiffView({ patch, file, onFile, collapseKey }: { patch: string; file?: string; onFile: (path: string) => void; collapseKey?: string }) {
	const files = useMemo(() => parsePatch(patch), [patch]);
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [viewed, setViewed] = useState<Set<string>>(new Set());
	const [split, setSplit] = useState(false);
	const [wrap, setWrap] = useState(true);
	const [scrollTo, setScrollTo] = useState<number | null>(null);
	const active = Math.max(0, files.findIndex((f) => f.path === file));
	const rows = useMemo(() => buildRows(files, collapsed, split), [files, collapsed, split]);
	const virtual = totalLines(files) > VIRTUAL_ABOVE;
	const add = files.reduce((n, f) => n + f.add, 0);
	const del = files.reduce((n, f) => n + f.del, 0);

	const go = (i: number) => {
		const f = files[Math.min(files.length - 1, Math.max(0, i))];
		if (!f) return;
		onFile(f.path);
		setScrollTo(files.indexOf(f));
		if (!virtual) document.getElementById(`file-${files.indexOf(f)}`)?.scrollIntoView({ block: "start" });
	};
	const toggle = (path: string) => setCollapsed((s) => (s.has(path) ? new Set([...s].filter((p) => p !== path)) : new Set(s).add(path)));
	const mark = (path: string, v: boolean) => setViewed((s) => (v ? new Set(s).add(path) : new Set([...s].filter((p) => p !== path))));

	// j and k move between files. x collapses the open file.
	useEffect(() => {
		const onKey = (ev: KeyboardEvent) => {
			const t = ev.target as HTMLElement;
			if (ev.metaKey || ev.ctrlKey || ev.altKey || t.closest("input, textarea, select, [contenteditable], [role=dialog], [role=alertdialog]")) return;
			if (ev.key === "j") go(active + 1);
			else if (ev.key === "k") go(active - 1);
			else if (ev.key === "x" && files[active]) toggle(files[active].path);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});
	useEffect(() => setCollapsed(new Set()), [collapseKey]);

	if (files.length === 0) return <p className="rounded-lg border bg-card p-4 text-muted-foreground">No diff is stored for this item.</p>;
	const h: Handlers = { onToggle: toggle, onViewed: mark, viewed, wrap, active };
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-3">
				<p className="font-semibold">
					{files.length} {files.length === 1 ? "file" : "files"} changed <Counts add={add} del={del} />
				</p>
				<div className="ml-auto flex flex-wrap items-center gap-3">
					<div className="flex items-center gap-2">
						<Switch id="wrap" checked={wrap} onCheckedChange={setWrap} />
						<Label htmlFor="wrap" className="text-xs">Wrap long lines</Label>
					</div>
					<ToggleGroup value={[split ? "split" : "unified"]} onValueChange={(v) => v[0] && setSplit(v[0] === "split")} variant="outline" size="sm" aria-label="Diff layout">
						<ToggleGroupItem value="unified">Unified</ToggleGroupItem>
						<ToggleGroupItem value="split" className="hidden min-[900px]:flex">Split</ToggleGroupItem>
					</ToggleGroup>
					<Button variant="outline" size="sm" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(files.map((f) => f.path)))}>
						{collapsed.size ? "Expand all" : "Collapse all"}
					</Button>
				</div>
			</div>
			<FileList files={files} active={active} onPick={go} />
			<div className="overflow-hidden rounded-lg border bg-card">
				{virtual ? (
					<VirtualRows rows={rows} h={h} scrollTo={scrollTo} />
				) : (
					<div className="overflow-x-auto">
						{rows.map((r) => (
							<RowView key={r.key} row={r} h={h} sticky />
						))}
					</div>
				)}
			</div>
			<p className="text-xs text-muted-foreground">
				Keys: j and k change file, x collapses a file.{virtual ? " This diff is long, so the page draws only the rows in view." : ""}
			</p>
		</div>
	);
}

function FileList({ files, active, onPick }: { files: DiffFile[]; active: number; onPick: (i: number) => void }) {
	return (
		<ScrollArea className="max-h-60 rounded-lg border bg-card">
			<ul className="max-h-60">
				{files.map((f, i) => (
					<li key={f.path}>
						<button type="button" onClick={() => onPick(i)} aria-current={i === active} className={cn("flex h-[34px] w-full items-center gap-3 px-3 text-left hover:bg-muted/50", i === active && "bg-muted")}>
							<span dir="rtl" className="min-w-0 flex-1 truncate text-left font-mono text-xs"><bdi>{f.path}</bdi></span>
							<Counts add={f.add} del={f.del} />
							<Bar add={f.add} del={f.del} />
						</button>
					</li>
				))}
			</ul>
		</ScrollArea>
	);
}
