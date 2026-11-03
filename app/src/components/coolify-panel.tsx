import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Pill } from "@/components/badges";
import { PasswordField, StateBadge } from "@/components/secret-editor";
import { Stale } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { COOLIFY_NAME_MAX, coolifyNameError, coolifyUrlError } from "@/lib/coolify";
import { coolifyQuery } from "@/lib/queries";
import { secretValueError } from "@/lib/secrets";
import type { CoolifyRow } from "@/lib/types";
import { removeCoolifyFn, saveCoolifyFn } from "@/server/fns";

function useCoolifySave(onDone: () => void, ok: string) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (v: { name: string; url: string; token?: string; password: string }) => saveCoolifyFn({ data: v }),
		onSuccess: async () => {
			await client.invalidateQueries({ queryKey: ["coolify"] });
			await client.invalidateQueries({ queryKey: ["secrets"] });
			toast.success(ok);
			onDone();
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the instance"),
	});
}

type FormValues = { name: string; url: string; token: string; password: string };

// The first problem of each field, or null. An empty field has no text problem: the Save button stays off.
function problems(v: FormValues, row?: CoolifyRow) {
	const urlChanged = !row || v.url.trim().replace(/\/$/, "") !== row.url;
	return {
		name: row || v.name === "" ? null : coolifyNameError(v.name),
		url: v.url === "" ? null : coolifyUrlError(v.url),
		token: v.token ? secretValueError(v.token) : null,
		urlChanged,
		blocked: !v.name || !v.url || !v.password || (urlChanged && v.token === ""),
	};
}

type TextProps = { id: string; label: string; value: string; onChange: (v: string) => void; help: ReactNode; error: string | null; type?: string; disabled?: boolean; mono?: boolean; maxLength?: number; placeholder?: string };

function TextField({ id, label, value, onChange, help, error, type = "text", disabled, mono, maxLength, placeholder }: TextProps) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Input id={id} type={type} value={value} disabled={disabled} maxLength={maxLength} placeholder={placeholder} autoComplete="off" spellCheck={false} className={mono ? "font-mono" : undefined} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={`${id}-help`} />
			<p id={`${id}-help`} className="text-xs text-muted-foreground">{help}</p>
			{error ? <p role="alert" className="text-xs text-status-error">{error}</p> : null}
		</div>
	);
}

const isBlocked = (p: ReturnType<typeof problems>): boolean => p.blocked || Boolean(p.name || p.url || p.token);

function tokenLabel(row: CoolifyRow | undefined, urlChanged: boolean): string {
	return row && !urlChanged ? "API token (leave empty to keep it)" : "API token";
}

function InstanceForm({ row, onDone }: { row?: CoolifyRow; onDone: () => void }) {
	const [v, setV] = useState<FormValues>({ name: row?.name ?? "", url: row?.url ?? "", token: "", password: "" });
	const set = (p: Partial<FormValues>) => setV((x) => ({ ...x, ...p }));
	const save = useCoolifySave(onDone, "Saved. The runner checks the token at its next loop. It can wait for a scout run to end.");
	const pr = problems(v, row);
	const blocked = isBlocked(pr);
	return (
		<form
			className="space-y-3 rounded-lg border bg-card p-4"
			onSubmit={(ev) => {
				ev.preventDefault();
				if (!blocked) save.mutate({ name: v.name, url: v.url, token: v.token || undefined, password: v.password });
			}}
		>
			<h2 className="text-sm font-semibold">{row ? `Edit ${row.name}` : "Add a Coolify instance"}</h2>
			<TextField id="cf-name" label="Name" value={v.name} onChange={(name) => set({ name })} disabled={Boolean(row)} maxLength={COOLIFY_NAME_MAX} placeholder="home" error={pr.name} help="Lowercase letters, numbers and hyphens. Projects link to apps with this name. You cannot change it later." />
			<TextField id="cf-url" label="URL" type="url" value={v.url} onChange={(url) => set({ url })} maxLength={200} mono placeholder="https://coolify.example.com" error={pr.url} help="https only. The base URL of the instance, with no path. The runner calls it with the GET method only." />
			<TextField
				id="cf-token"
				label={tokenLabel(row, pr.urlChanged)}
				type="password"
				value={v.token}
				onChange={(token) => set({ token })}
				mono
				error={pr.token}
				help={<>Create it in Coolify under Keys &amp; Tokens, API tokens. Give it <span className="font-mono">read</span> and <span className="font-mono">read:sensitive</span> (the logs need it) and nothing else. A new URL needs the token again.</>}
			/>
			<PasswordField id="cf-password" value={v.password} onChange={(password) => set({ password })} />
			<div className="flex gap-2">
				<Button type="submit" disabled={blocked || save.isPending}>
					{save.isPending ? <Spinner /> : null}
					Save
				</Button>
				<Button type="button" variant="outline" disabled={save.isPending} onClick={onDone}>Cancel</Button>
			</div>
		</form>
	);
}

function RemoveForm({ row, onDone }: { row: CoolifyRow; onDone: () => void }) {
	const client = useQueryClient();
	const [password, setPassword] = useState("");
	const remove = useMutation({
		mutationFn: () => removeCoolifyFn({ data: { name: row.name, password } }),
		onSuccess: async () => {
			await client.invalidateQueries();
			toast.success(`Removed ${row.name}`);
			onDone();
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove the instance"),
	});
	return (
		<form
			className="space-y-3 border-t bg-muted/40 px-4 py-3"
			onSubmit={(ev) => {
				ev.preventDefault();
				if (password) remove.mutate();
			}}
		>
			<p className="text-xs text-muted-foreground">Warden forgets the instance, its token and the links of projects to its apps.</p>
			<PasswordField id={`cf-rm-${row.name}`} value={password} onChange={setPassword} />
			<div className="flex gap-2">
				<Button type="submit" variant="destructive" className="bg-destructive text-background hover:bg-destructive/90" disabled={!password || remove.isPending}>
					{remove.isPending ? <Spinner /> : null}
					Remove
				</Button>
				<Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
			</div>
		</form>
	);
}

function InstanceItem({ row }: { row: CoolifyRow }) {
	const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
	if (mode === "edit") return <li className="p-3"><InstanceForm row={row} onDone={() => setMode("view")} /></li>;
	return (
		<li>
			<div className="grid items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto]">
				<div className="min-w-0">
					<p className="truncate font-mono text-xs font-medium">{row.name}</p>
					<p className="truncate font-mono text-xs text-muted-foreground">{row.url}</p>
				</div>
				<div className="min-w-0 space-y-1">
					<StateBadge row={row.token} />
					{row.apps !== null ? <p className="text-xs text-muted-foreground">{row.apps} {row.apps === 1 ? "app" : "apps"} found</p> : row.detail ? <p className="text-xs text-muted-foreground">{row.detail}</p> : null}
				</div>
				<div className="flex gap-2">
					<Button variant="outline" size="sm" onClick={() => setMode("edit")}>Edit</Button>
					<Button variant="outline" size="sm" className="text-status-error" onClick={() => setMode(mode === "remove" ? "view" : "remove")}>Remove</Button>
				</div>
			</div>
			{mode === "remove" ? <RemoveForm row={row} onDone={() => setMode("view")} /> : null}
		</li>
	);
}

export function CoolifyPanel() {
	const query = useQuery(coolifyQuery());
	const [adding, setAdding] = useState(false);
	const rows = query.data;
	if (!rows) return null;
	return (
		<>
			<Stale query={query} />
			{adding ? <InstanceForm onDone={() => setAdding(false)} /> : <Button variant="outline" onClick={() => setAdding(true)}>Add a Coolify instance</Button>}
			{rows.length ? (
				<ul className="divide-y overflow-hidden rounded-lg border bg-card">
					{rows.map((r) => (
						<InstanceItem key={r.name} row={r} />
					))}
				</ul>
			) : (
				<p className="rounded-lg border bg-card p-4 text-muted-foreground">No instance yet. Add one, then link its apps in the settings of a project.</p>
			)}
		</>
	);
}

export function CoolifyLine({ row }: { row: CoolifyRow }) {
	return (
		<li className="flex flex-wrap items-center gap-x-3 gap-y-1">
			<span className="min-w-0 break-all font-mono text-xs">{row.name}</span>
			<Pill tone="info">{row.apps === null ? "No app list" : `${row.apps} apps`}</Pill>
			<StateBadge row={row.token} />
		</li>
	);
}
