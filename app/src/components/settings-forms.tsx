import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Pill } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordField } from "@/components/secret-editor";
import { Spinner } from "@/components/ui/spinner";
import { urlError } from "@/lib/settings";
import type { SecretSource } from "@/lib/types";
import { saveCap, saveRejectDays, saveStale, saveUrlFn, signOutEverywhereFn } from "@/server/fns";

export function PageHead({ title, text }: { title: string; text?: string }) {
	return (
		<div className="space-y-1">
			<h1 className="text-xl font-semibold leading-7 max-[639px]:text-lg">{title}</h1>
			{text ? <p className="text-muted-foreground">{text}</p> : null}
		</div>
	);
}

function FormCard({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
	return (
		<form
			className="space-y-3 rounded-lg border bg-card p-4"
			onSubmit={(ev) => {
				ev.preventDefault();
				onSubmit();
			}}
		>
			{children}
		</form>
	);
}

function SaveButton({ disabled, pending, children = "Save" }: { disabled: boolean; pending: boolean; children?: ReactNode }) {
	return (
		<Button type="submit" disabled={disabled || pending}>
			{pending ? <Spinner /> : null}
			{children}
		</Button>
	);
}

const SOURCE_TEXT: Record<SecretSource, string> = { ui: "Set in Warden", env: "From .env", unset: "Not set" };

export function UrlForm(props: { id: string; label: string; help: string; settingKey: "hermes_webhook_url" | "warden_url"; value: string | null; source: SecretSource; placeholder: string }) {
	const client = useQueryClient();
	const [text, setText] = useState(props.value ?? "");
	const [password, setPassword] = useState("");
	const error = urlError(text);
	const save = useMutation({
		mutationFn: () => saveUrlFn({ data: { key: props.settingKey, value: text, password } }),
		onSuccess: async () => {
			setPassword("");
			await client.invalidateQueries({ queryKey: ["integrations"] });
			toast.success(text.trim() === "" ? `${props.label} removed` : `${props.label} saved`);
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the setting"),
	});
	return (
		<FormCard onSubmit={() => error === null && password && save.mutate()}>
			<div className="space-y-1.5">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<Label htmlFor={props.id}>{props.label}</Label>
					<Pill tone={props.source === "unset" ? "neutral" : "info"}>{SOURCE_TEXT[props.source]}</Pill>
				</div>
				<Input id={props.id} type="url" inputMode="url" autoComplete="off" spellCheck={false} maxLength={500} className="font-mono" placeholder={props.placeholder} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={error !== null} />
				<p className="text-xs text-muted-foreground">{props.help}</p>
				{error ? <p role="alert" className="text-xs text-status-error">{error}</p> : null}
			</div>
			<PasswordField id={`${props.id}-password`} value={password} onChange={setPassword} />
			<SaveButton disabled={error !== null || !password} pending={save.isPending} />
		</FormCard>
	);
}

export function CapForm({ cap }: { cap: number | null }) {
	const client = useQueryClient();
	const [text, setText] = useState(cap === null ? "" : String(cap));
	const value = text.trim() === "" ? null : Number(text);
	const invalid = value !== null && !(Number.isFinite(value) && value > 0 && value <= 100_000);
	const save = useMutation({
		mutationFn: () => saveCap({ data: { cap: value } }),
		onSuccess: async (r) => {
			await client.invalidateQueries();
			toast.success(r.cap === null ? "Daily cost cap removed" : `Daily cost cap saved: $${r.cap}`);
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the cap"),
	});
	return (
		<FormCard onSubmit={() => !invalid && save.mutate()}>
			<div className="space-y-1.5">
				<Label htmlFor="cap">Daily cost cap (USD)</Label>
				<Input id="cap" type="number" inputMode="decimal" min={0.01} step="0.01" className="tabular w-40" placeholder="No cap" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={invalid} />
				<p className="text-xs text-muted-foreground">
					Warden skips runs for the rest of the day when the notional cost reaches the cap. The cost is what the tokens would cost at API prices. Leave the field empty for no cap.
				</p>
				{invalid ? <p role="alert" className="text-xs text-status-error">Enter an amount above 0, or leave the field empty.</p> : null}
			</div>
			<SaveButton disabled={invalid} pending={save.isPending} />
		</FormCard>
	);
}

type DaysProps = { id: string; label: string; help: string; days: number; min: number; kind: "stale" | "reject" };

export function DaysForm({ id, label, help, days, min, kind }: DaysProps) {
	const client = useQueryClient();
	const [text, setText] = useState(String(days));
	const value = Number(text);
	const invalid = !(text.trim() !== "" && Number.isInteger(value) && value >= min && value <= 3650);
	const save = useMutation({
		mutationFn: () => (kind === "stale" ? saveStale({ data: { days: value } }) : saveRejectDays({ data: { days: value } })),
		onSuccess: async (r) => {
			await client.invalidateQueries();
			toast.success(`${label}: ${r.days} days`);
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the setting"),
	});
	return (
		<FormCard onSubmit={() => !invalid && save.mutate()}>
			<div className="space-y-1.5">
				<Label htmlFor={id}>{label}</Label>
				<Input id={id} type="number" inputMode="numeric" min={min} max={3650} step={1} className="tabular w-40" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={invalid} />
				<p className="text-xs text-muted-foreground">{help}</p>
				{invalid ? <p role="alert" className="text-xs text-status-error">Enter a whole number of days from {min} to 3650.</p> : null}
			</div>
			<SaveButton disabled={invalid} pending={save.isPending} />
		</FormCard>
	);
}

export function SignOutForm() {
	const [password, setPassword] = useState("");
	const out = useMutation({
		mutationFn: () => signOutEverywhereFn({ data: { password } }),
		onSuccess: () => window.location.assign("/login"),
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not sign out"),
	});
	return (
		<FormCard onSubmit={() => password && out.mutate()}>
			<div className="space-y-1.5">
				<Label htmlFor="so-password">Sign out everywhere</Label>
				<p className="text-xs text-muted-foreground">Ends every session, this one too. Enter your Warden password to confirm.</p>
				<Input id="so-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
			</div>
			<Button type="submit" variant="outline" disabled={!password || out.isPending}>
				{out.isPending ? <Spinner /> : null}
				Sign out everywhere
			</Button>
		</FormCard>
	);
}
