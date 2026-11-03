import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pill } from "@/components/badges";
import { Time } from "@/components/time";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { isSecretKey, POSTHOG_PREFIX, secretValueError } from "@/lib/secrets";
import type { SecretRow } from "@/lib/types";
import { saveSecretFn } from "@/server/fns";

export const SOURCE: Record<SecretRow["source"], string> = { env: "From .env", ui: "Set in Warden", unset: "Not set" };

export function StateBadge({ row }: { row: SecretRow }) {
	if (row.pending) return <Pill tone="info">Checking…</Pill>;
	if (row.source === "unset") return <span className="text-muted-foreground">-</span>;
	if (row.state === "ok" || row.state === "warn") {
		return (
			<span className="inline-flex flex-wrap items-center gap-x-2">
				<Pill tone={row.state === "ok" ? "ok" : "pending"}>{row.state === "ok" ? "Works" : "Works, check the token"}</Pill>
				{row.detail ? <span className="text-xs text-muted-foreground">{row.detail}</span> : null}
			</span>
		);
	}
	if (row.state === "invalid" || row.state === "error") {
		return (
			<span className="inline-flex flex-wrap items-center gap-x-2">
				<Pill tone="error">Does not work</Pill>
				{row.detail ? <span className="text-xs text-muted-foreground">{row.detail}</span> : null}
			</span>
		);
	}
	return <span className="text-xs text-muted-foreground">Not checked yet</span>;
}

function useSecretSave(onDone: () => void, ok: string) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (v: { key: string; value?: string; clear?: boolean; password: string }) => saveSecretFn({ data: v }),
		onSuccess: async () => {
			await client.invalidateQueries({ queryKey: ["secrets"] });
			toast.success(ok);
			onDone();
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
	});
}

export function PasswordField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>Your Warden password</Label>
			<Input id={id} type="password" autoComplete="current-password" value={value} onChange={(e) => onChange(e.target.value)} />
		</div>
	);
}

function ValueForm({ keyName, onDone, ok }: { keyName: string; onDone: () => void; ok: string }) {
	const [value, setValue] = useState("");
	const [password, setPassword] = useState("");
	const save = useSecretSave(onDone, ok);
	const problem = value ? secretValueError(value) : null;
	return (
		<form
			className="space-y-3 border-t bg-muted/40 px-4 py-3"
			onSubmit={(ev) => {
				ev.preventDefault();
				if (value && !problem && password) save.mutate({ key: keyName, value, password });
			}}
		>
			<div className="space-y-1.5">
				<Label htmlFor={`v-${keyName}`}>New value</Label>
				<Input id={`v-${keyName}`} type="password" autoComplete="off" spellCheck={false} className="font-mono" value={value} onChange={(e) => setValue(e.target.value)} />
				{problem ? <p role="alert" className="text-xs text-status-error">{problem}</p> : null}
			</div>
			<PasswordField id={`p-${keyName}`} value={password} onChange={setPassword} />
			<div className="flex gap-2">
				<Button type="submit" disabled={!value || Boolean(problem) || !password || save.isPending}>
					{save.isPending ? <Spinner /> : null}
					Save
				</Button>
				<Button type="button" variant="outline" disabled={save.isPending} onClick={onDone}>Cancel</Button>
			</div>
		</form>
	);
}

function ClearDialog({ keyName, open, onOpenChange }: { keyName: string; open: boolean; onOpenChange: (o: boolean) => void }) {
	const [password, setPassword] = useState("");
	const save = useSecretSave(() => onOpenChange(false), "Cleared. Warden uses the value from .env, if any.");
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="data-[size=default]:sm:max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>Clear <span className="font-mono">{keyName}</span>?</AlertDialogTitle>
					<AlertDialogDescription>Warden forgets the value you set here. Scouts that need it stop until you set it again.</AlertDialogDescription>
				</AlertDialogHeader>
				<PasswordField id={`cp-${keyName}`} value={password} onChange={setPassword} />
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<Button variant="destructive" className="bg-destructive text-background hover:bg-destructive/90" disabled={!password || save.isPending} onClick={() => save.mutate({ key: keyName, clear: true, password })}>
						Clear key
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function SecretItem({ row }: { row: SecretRow }) {
	const [replace, setReplace] = useState(false);
	const [clear, setClear] = useState(false);
	return (
		<li>
			<div className="grid items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1.4fr)_auto]">
				<div className="min-w-0">
					<p className="truncate font-mono text-xs font-medium">{row.key}</p>
					<p className="text-xs text-muted-foreground">{row.updatedAt ? <>Updated <Time iso={row.updatedAt} /></> : "Never updated here"}</p>
				</div>
				<Pill tone={row.source === "unset" ? "neutral" : "info"}>{SOURCE[row.source]}</Pill>
				<div className="min-w-0"><StateBadge row={row} /></div>
				<div className="flex gap-2">
					<Button variant="outline" size="sm" onClick={() => setReplace((v) => !v)}>{row.source === "unset" ? "Set" : "Replace"}</Button>
					{row.source === "ui" ? <Button variant="outline" size="sm" className="text-status-error" onClick={() => setClear(true)}>Clear</Button> : null}
				</div>
			</div>
			{replace ? <ValueForm keyName={row.key} ok="Saved. The runner checks it at its next loop. It can wait for a scout run to end." onDone={() => setReplace(false)} /> : null}
			<ClearDialog keyName={row.key} open={clear} onOpenChange={setClear} />
		</li>
	);
}

function KeyNameField({ name, bad, onChange }: { name: string; bad: boolean; onChange: (v: string) => void }) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor="new-name">Key name</Label>
			<div className="flex items-center gap-1 font-mono text-xs">
				<span className="text-muted-foreground">{POSTHOG_PREFIX}</span>
				<Input id="new-name" className="max-w-[200px] font-mono" placeholder="WORK" autoComplete="off" value={name} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-invalid={bad} />
			</div>
			<p className="text-xs text-muted-foreground">Use A to Z, 0 to 9 and underscores for the name.</p>
			{bad ? <p role="alert" className="text-xs text-status-error">This name is not valid.</p> : null}
		</div>
	);
}

export function AddKey({ onDone }: { onDone: () => void }) {
	const [name, setName] = useState("");
	const [value, setValue] = useState("");
	const [password, setPassword] = useState("");
	const key = `${POSTHOG_PREFIX}${name}`;
	const bad = name !== "" && !isSecretKey(key);
	const problem = value ? secretValueError(value) : null;
	const save = useSecretSave(onDone, "Saved. The runner checks it at its next loop. It can wait for a scout run to end.");
	return (
		<form
			className="space-y-3 rounded-lg border bg-card p-4"
			onSubmit={(ev) => {
				ev.preventDefault();
				if (name && !bad && value && !problem && password) save.mutate({ key, value, password });
			}}
		>
			<h2 className="text-sm font-semibold">Add a PostHog key</h2>
			<KeyNameField name={name} bad={bad} onChange={setName} />
			<div className="space-y-1.5">
				<Label htmlFor="new-value">Personal API key</Label>
				<Input id="new-value" type="password" autoComplete="off" spellCheck={false} className="font-mono" value={value} onChange={(e) => setValue(e.target.value)} />
				{problem ? <p role="alert" className="text-xs text-status-error">{problem}</p> : null}
			</div>
			<PasswordField id="new-password" value={password} onChange={setPassword} />
			<div className="flex gap-2">
				<Button type="submit" disabled={!name || bad || !value || Boolean(problem) || !password || save.isPending}>
					{save.isPending ? <Spinner /> : null}
					Save
				</Button>
				<Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
			</div>
		</form>
	);
}
