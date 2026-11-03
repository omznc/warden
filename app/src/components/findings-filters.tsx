import { SlidersHorizontal, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { scoutName } from "@/lib/format";
import type { GhState } from "@/lib/gh";
import type { FindingsFilter, ProjectRow } from "@/lib/types";

export const ACTIONS = [
	{ value: "default", label: "All except skipped" },
	{ value: "all", label: "All" },
	{ value: "issue", label: "Issues created" },
	{ value: "comment", label: "Comments added" },
	{ value: "pr", label: "PRs opened" },
	{ value: "pending", label: "Pending approval" },
	{ value: "dry", label: "Dry run" },
	{ value: "skipped", label: "Skipped" },
	{ value: "blocked", label: "Blocked" },
];

const GH_OPTIONS = [
	{ value: "any", label: "Any" },
	{ value: "open", label: "Open" },
	{ value: "merged", label: "Merged" },
	{ value: "closed", label: "Closed" },
];

export type Patch = (p: Partial<FindingsFilter>) => void;

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
	return (
		<Select value={value} items={options} onValueChange={(v) => onChange(String(v))}>
			<SelectTrigger aria-label={label} className="h-8 min-w-[130px] bg-card">
				<span className="text-muted-foreground">{label}</span>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((o) => (
					<SelectItem key={o.value} value={o.value}>
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function Selects({ f, projects, patch }: { f: FindingsFilter; projects: ProjectRow[]; patch: Patch }) {
	const scouts = [...new Set(projects.flatMap((p) => p.cells.map((c) => c.scout)))];
	return (
		<>
			<FilterSelect label="Project" value={f.project ?? "all"} options={[{ value: "all", label: "All" }, ...projects.map((p) => ({ value: p.name, label: p.name }))]} onChange={(v) => patch({ project: v === "all" ? undefined : v })} />
			<FilterSelect label="Scout" value={f.scout ?? "all"} options={[{ value: "all", label: "All" }, ...scouts.map((s) => ({ value: s, label: scoutName(s) }))]} onChange={(v) => patch({ scout: v === "all" ? undefined : v })} />
			<FilterSelect label="Action" value={f.action ?? "default"} options={ACTIONS} onChange={(v) => patch({ action: v === "default" ? undefined : v })} />
			<FilterSelect label="GitHub" value={f.gh ?? "any"} options={GH_OPTIONS} onChange={(v) => patch({ gh: v === "any" ? undefined : (v as GhState) })} />
		</>
	);
}

function Severity({ f, patch }: { f: FindingsFilter; patch: Patch }) {
	const value = f.severity?.split(",").filter(Boolean) ?? [];
	return (
		<ToggleGroup multiple value={value} onValueChange={(v) => patch({ severity: v.length ? v.join(",") : undefined })} variant="outline" aria-label="Severity" spacing={0}>
			{["high", "medium", "low"].map((s) => (
				<ToggleGroupItem key={s} value={s} className="h-8 capitalize">
					{s}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

function Search_({ value, onChange }: { value: string; onChange: (v: string) => void }) {
	const [text, setText] = useState(value);
	useEffect(() => setText(value), [value]);
	useEffect(() => {
		if (text === value) return;
		const t = setTimeout(() => onChange(text), 250);
		return () => clearTimeout(t);
	}, [text]); // eslint-disable-line react-hooks/exhaustive-deps
	return (
		<div className="relative min-w-[200px] flex-1 sm:max-w-[280px] sm:flex-none">
			<Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
			<Input type="search" aria-label="Search title or fingerprint" placeholder="Search title or fingerprint" value={text} onChange={(e) => setText(e.target.value)} className="h-8 bg-card pl-8" />
		</div>
	);
}

export function activeChips(f: FindingsFilter): { key: keyof FindingsFilter; label: string }[] {
	const out: { key: keyof FindingsFilter; label: string }[] = [];
	if (f.project) out.push({ key: "project", label: `Project: ${f.project}` });
	if (f.scout) out.push({ key: "scout", label: `Scout: ${scoutName(f.scout)}` });
	if (f.severity) out.push({ key: "severity", label: `Severity: ${f.severity.replace(/,/g, ", ")}` });
	if (f.action) out.push({ key: "action", label: `Action: ${ACTIONS.find((a) => a.value === f.action)?.label ?? f.action}` });
	if (f.gh) out.push({ key: "gh", label: `GitHub: ${GH_OPTIONS.find((o) => o.value === f.gh)?.label}` });
	if (f.q) out.push({ key: "q", label: `Search: ${f.q}` });
	return out;
}

export function FilterBar({ f, projects, patch, narrow }: { f: FindingsFilter; projects: ProjectRow[]; patch: Patch; narrow: boolean }) {
	const chips = activeChips(f);
	const clear = () => patch({ project: undefined, scout: undefined, severity: undefined, action: undefined, gh: undefined, q: undefined });
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				{narrow ? (
					<>
						<Search_ value={f.q ?? ""} onChange={(q) => patch({ q: q || undefined })} />
						<Popover>
							<PopoverTrigger render={<Button variant="outline" className="h-9" />}>
								<SlidersHorizontal aria-hidden />
								Filters{chips.filter((c) => c.key !== "q").length ? ` · ${chips.filter((c) => c.key !== "q").length}` : ""}
							</PopoverTrigger>
							<PopoverContent align="end" className="w-64 space-y-2">
								<Selects f={f} projects={projects} patch={patch} />
								<Severity f={f} patch={patch} />
							</PopoverContent>
						</Popover>
					</>
				) : (
					<>
						<Selects f={f} projects={projects} patch={patch} />
						<Severity f={f} patch={patch} />
						<div className="ml-auto">
							<Search_ value={f.q ?? ""} onChange={(q) => patch({ q: q || undefined })} />
						</div>
					</>
				)}
			</div>
			{chips.length ? (
				<div className="flex flex-wrap items-center gap-2">
					{chips.map((c) => (
						<Badge key={c.key} variant="outline" className="h-6 gap-1 rounded-md bg-muted pr-1 text-xs font-medium">
							{c.label}
							<button type="button" aria-label={`Remove filter ${c.label}`} onClick={() => patch({ [c.key]: undefined })} className="grid size-4 place-items-center rounded-sm hover:bg-background">
								<X aria-hidden className="size-3" />
							</button>
						</Badge>
					))}
					<Button variant="ghost" size="sm" onClick={clear}>
						Clear all
					</Button>
				</div>
			) : null}
		</div>
	);
}
