import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Time } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { linkId, splitApps } from "@/lib/coolify";
import { defaultKey, groupByOrg, type PosthogOption, posthogOptions } from "@/lib/connections";
import { connectionsQuery } from "@/lib/queries";
import { DEFAULT_AUTHORS, ISSUE_AUTHORS, NAME_RE, PRESETS, REPO_RE, SCOUTS } from "@/lib/scouts";
import type { Connections, ProjectConnection } from "@/lib/types";
import { createProjectFn, editProjectFn, refreshDiscovery } from "@/server/fns";

export type FormState = {
	name: string;
	repo: string;
	option: string;
	key: string;
	sentry: string;
	coolify: string[];
	scouts: string[];
	notes: string;
	testCommand: string;
	authors: string[];
};

const NONE = "none";

function savedOption(c: ProjectConnection | null, options: PosthogOption[]): string {
	if (!c?.posthog_project_id) return NONE;
	return options.find((o) => o.id === c.posthog_project_id && o.keys.includes(c.posthog_key_env ?? ""))?.value ?? NONE;
}

const EMPTY: ProjectConnection = { posthog_key_env: null, posthog_project_id: null, posthog_region: null, sentry: null, coolify: [], scouts: [], notes: "", test_command: "", issue_authors: DEFAULT_AUTHORS, enabled: true };

export function initialState(name: string, repo: string, saved: ProjectConnection | null, options: PosthogOption[]): FormState {
	const c = saved ?? EMPTY;
	return {
		name,
		repo,
		option: savedOption(saved, options),
		key: c.posthog_key_env ?? "",
		sentry: c.sentry ? `${c.sentry.org}/${c.sentry.project}` : NONE,
		coolify: c.coolify.map((l) => linkId(l.instance, l.app_uuid)),
		scouts: c.scouts,
		notes: c.notes,
		testCommand: c.test_command,
		authors: c.issue_authors,
	};
}

function toggle(list: string[], value: string, on: boolean): string[] {
	return on ? [...new Set([...list, value])] : list.filter((x) => x !== value);
}

function Field({ label, htmlFor, help, children }: { label: string; htmlFor?: string; help?: ReactNode; children: ReactNode }) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
			{help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
		</div>
	);
}

function Card({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="overflow-hidden rounded-lg border bg-card">
			<h2 className="border-b px-4 py-3 text-sm font-semibold">{title}</h2>
			<div className="space-y-4 px-4 py-4">{children}</div>
		</section>
	);
}

function PosthogField({ c, options, state, set }: { c: Connections; options: PosthogOption[]; state: FormState; set: (p: Partial<FormState>) => void }) {
	const chosen = options.find((o) => o.value === state.option);
	const items = [{ value: NONE, label: "No PostHog project" }, ...options.map((o) => ({ value: o.value, label: `${o.name} · via ${o.keys.join(", ")}` }))];
	const pick = (value: string) => {
		const o = options.find((x) => x.value === value);
		set({ option: value, key: o ? defaultKey(o, c.usedKeyEnvs) : "" });
	};
	return (
		<Field
			label="PostHog project"
			htmlFor="posthog"
			help={
				<>
					Only projects that a saved key covers show here. Missing one? <Link to="/settings/integrations/$id" params={{ id: "posthog-keys" }} search={{ add: true }}>Add a PostHog key</Link>
				</>
			}
		>
			<Select value={state.option} items={items} onValueChange={(v) => pick(String(v))}>
				<SelectTrigger id="posthog" className="h-9 w-full"><SelectValue /></SelectTrigger>
				<SelectContent>
					<SelectItem value={NONE}>No PostHog project</SelectItem>
					{groupByOrg(options).map(([org, list]) => (
						<SelectGroup key={org}>
							<SelectLabel>{org}</SelectLabel>
							{list.map((o) => (
								<SelectItem key={o.value} value={o.value}>
									{o.name} <span className="text-muted-foreground">via {o.keys.join(", ")}</span>
								</SelectItem>
							))}
						</SelectGroup>
					))}
				</SelectContent>
			</Select>
			{chosen && chosen.keys.length > 1 ? (
				<div className="flex items-center gap-2 pt-1">
					<span className="text-xs text-muted-foreground">Key</span>
					<Select value={state.key} onValueChange={(v) => set({ key: String(v) })}>
						<SelectTrigger aria-label="Key" className="h-8 w-[260px] font-mono text-xs"><SelectValue /></SelectTrigger>
						<SelectContent>{chosen.keys.map((k) => <SelectItem key={k} value={k} className="font-mono text-xs">{k}</SelectItem>)}</SelectContent>
					</Select>
				</div>
			) : null}
		</Field>
	);
}

function SentryField({ c, state, set }: { c: Connections; state: FormState; set: (p: Partial<FormState>) => void }) {
	const list = c.discovery?.sentry?.projects ?? [];
	const items = [{ value: NONE, label: "No Sentry project" }, ...list.map((p) => ({ value: `${p.org}/${p.slug}`, label: `${p.org} / ${p.slug}` }))];
	if (!c.sentryTokenSet || !c.discovery?.sentry) {
		return (
			<Field label="Sentry project (optional)">
				<p className="text-muted-foreground">
					Add a Sentry token to connect Sentry. <Link to="/settings/integrations/$id" params={{ id: "sentry" }}>Open Sentry settings</Link>
				</p>
			</Field>
		);
	}
	return (
		<Field label="Sentry project (optional)" htmlFor="sentry">
			<Select value={state.sentry} items={items} onValueChange={(v) => set({ sentry: String(v) })}>
				<SelectTrigger id="sentry" className="h-9 w-full"><SelectValue /></SelectTrigger>
				<SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
			</Select>
		</Field>
	);
}

function CoolifyApp({ id, name, status, repo, checked, onToggle, onUseRepo }: { id: string; name: string; status: string; repo: string | null; checked: boolean; onToggle: (on: boolean) => void; onUseRepo?: () => void }) {
	return (
		<li className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2">
			<Label htmlFor={`cf-${id}`} className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
				<Checkbox id={`cf-${id}`} className="mt-0.5" checked={checked} onCheckedChange={(v) => onToggle(v === true)} />
				<span className="min-w-0">
					<span className="block break-words font-medium leading-5">{name}</span>
					<span className="block break-all font-mono text-xs font-normal leading-5 text-muted-foreground">{status || "unknown"} · {repo ?? "no Git repository"}</span>
				</span>
			</Label>
			{onUseRepo ? <Button type="button" variant="outline" size="sm" onClick={onUseRepo}>Use this repository</Button> : null}
		</li>
	);
}

function CoolifyField({ c, state, set }: { c: Connections; state: FormState; set: (p: Partial<FormState>) => void }) {
	const found = c.discovery?.coolify ?? [];
	if (!found.length) {
		return (
			<p className="text-muted-foreground">
				Add a Coolify instance to link apps. <Link to="/settings/integrations/$id" params={{ id: "coolify" }}>Open Coolify settings</Link>
			</p>
		);
	}
	const { match, other } = splitApps(found, state.repo);
	const listed = new Set([...match, ...other].map((a) => linkId(a.instance, a.uuid)));
	const gone = state.coolify.filter((id) => !listed.has(id));
	const row = (a: (typeof match)[number], useRepo: boolean) => {
		const id = linkId(a.instance, a.uuid);
		return <CoolifyApp key={id} id={id} name={`${a.name} (${a.instance})`} status={a.status} repo={a.repo} checked={state.coolify.includes(id)} onToggle={(on) => set({ coolify: toggle(state.coolify, id, on) })} onUseRepo={useRepo && a.repo ? () => set({ repo: a.repo ?? "" }) : undefined} />;
	};
	return (
		<div className="space-y-3">
			{found.filter((i) => !i.ok).map((i) => <p key={i.name} className="text-xs text-muted-foreground">{i.name}: {i.detail ?? "no app list"}</p>)}
			{match.length ? <div className="space-y-1.5"><p className="text-xs text-muted-foreground">Apps that deploy {state.repo}</p><ul className="divide-y rounded-md border">{match.map((a) => row(a, false))}</ul></div> : null}
			{other.length ? <div className="space-y-1.5"><p className="text-xs text-muted-foreground">{match.length ? "Other apps" : "Apps"}. Use the repository of an app to start a project from it.</p><ul className="max-h-72 divide-y overflow-y-auto rounded-md border">{other.map((a) => row(a, true))}</ul></div> : null}
			{gone.length ? <p className="text-xs text-muted-foreground">Saved links that Coolify does not list now: {gone.join(", ")}. They stay until you remove the instance.</p> : null}
		</div>
	);
}

function ScoutsField({ state, set }: { state: FormState; set: (p: Partial<FormState>) => void }) {
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-xs text-muted-foreground">Presets</span>
				{PRESETS.map((p) => (
					<Button key={p.label} type="button" variant="outline" size="sm" onClick={() => set({ scouts: p.scouts })}>{p.label}</Button>
				))}
			</div>
			<ul className="divide-y rounded-md border">
				{SCOUTS.map((s) => (
					<li key={s.name}>
						<Label htmlFor={`scout-${s.name}`} className="flex cursor-pointer items-start gap-2.5 px-3 py-2">
							<Checkbox id={`scout-${s.name}`} className="mt-0.5" checked={state.scouts.includes(s.name)} onCheckedChange={(v) => set({ scouts: toggle(state.scouts, s.name, v === true) })} />
							<span>
								<span className="block font-medium leading-5">{s.label}</span>
								<span className="block font-normal leading-5 text-muted-foreground">{s.description}</span>
							</span>
						</Label>
					</li>
				))}
			</ul>
		</div>
	);
}

function Refresh({ c }: { c: Connections }) {
	const client = useQueryClient();
	const m = useMutation({
		mutationFn: () => refreshDiscovery(),
		onSuccess: async () => {
			toast.success("Asked the runner to refresh. The runner answers at its next loop. It can wait for a scout run to end.");
			await client.invalidateQueries({ queryKey: ["connections"] });
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not ask for a refresh"),
	});
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
			<span>{c.discovery?.updated_at ? <>Connections checked <Time iso={c.discovery.updated_at} /></> : "No connection data yet."}</span>
			<Button type="button" variant="outline" size="sm" disabled={m.isPending} onClick={() => m.mutate()}>
				{m.isPending ? <Spinner /> : <RefreshCw aria-hidden />}
				Refresh connections
			</Button>
		</div>
	);
}

export function formProblem(s: FormState, isNew: boolean, names: string[]): string | null {
	if (isNew && !NAME_RE.test(s.name)) return "Use a to z, 0 to 9 and hyphens in the name.";
	if (isNew && names.includes(s.name)) return "A project with this name exists.";
	if (!REPO_RE.test(s.repo)) return "Enter the repository as owner/name.";
	if (!s.scouts.length) return "Choose at least one scout.";
	if (!s.authors.length) return "Choose at least one issue author type.";
	return null;
}

function payload(s: FormState, options: PosthogOption[]) {
	const o = options.find((x) => x.value === s.option);
	const [org, project] = s.sentry === NONE ? [] : s.sentry.split("/");
	return {
		name: s.name,
		repo: s.repo.trim(),
		posthogKeyEnv: o ? s.key : null,
		posthogProjectId: o?.id ?? null,
		sentry: org && project ? { org, project } : null,
		coolify: s.coolify.map((id) => ({ instance: id.split("/")[0] ?? "", appUuid: id.split("/")[1] ?? "" })),
		scouts: s.scouts,
		notes: s.notes,
		testCommand: s.testCommand,
		issueAuthors: s.authors,
	};
}

type Props = { mode: "new" | "edit"; name?: string; repo?: string; connection?: ProjectConnection };

export function ProjectForm({ mode, name = "", repo = "", connection }: Props) {
	const { data: c } = useQuery(connectionsQuery());
	if (!c) return null;
	return <FormBody c={c} mode={mode} name={name} repo={repo} connection={connection ?? null} />;
}

function useSaveProject(isNew: boolean, state: FormState, options: PosthogOption[]) {
	const navigate = useNavigate();
	const client = useQueryClient();
	return useMutation({
		mutationFn: () => (isNew ? createProjectFn : editProjectFn)({ data: payload(state, options) }),
		onSuccess: async (r) => {
			await client.invalidateQueries();
			toast.success(isNew ? "Project added in dry mode" : "Connection saved");
			navigate({ to: "/projects/$id/settings", params: { id: r.name } });
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the project"),
	});
}

function FormActions({ isNew, name, problem, pending }: { isNew: boolean; name: string; problem: string | null; pending: boolean }) {
	return (
		<div className="flex flex-wrap items-center justify-end gap-3">
			{problem && (name || !isNew) ? <p className="mr-auto text-xs text-muted-foreground">{problem}</p> : null}
			<Button type="button" variant="outline" render={isNew ? <Link to="/projects" /> : <Link to="/projects/$id/settings" params={{ id: name }} />}>Cancel</Button>
			<Button type="submit" disabled={Boolean(problem) || pending}>
				{pending ? <Spinner /> : null}
				{isNew ? "Add project" : "Save connection"}
			</Button>
		</div>
	);
}

function FormBody({ c, mode, name, repo, connection }: { c: Connections; mode: "new" | "edit"; name: string; repo: string; connection: ProjectConnection | null }) {
	const options = posthogOptions(c.discovery, { id: connection?.posthog_project_id ?? null, key: connection?.posthog_key_env ?? null });
	const [state, setState] = useState(() => initialState(name, repo, connection, options));
	const set = (p: Partial<FormState>) => setState((s) => ({ ...s, ...p }));
	const isNew = mode === "new";
	const problem = formProblem(state, isNew, c.names);
	const save = useSaveProject(isNew, state, options);
	return (
		<form
			className="space-y-4"
			onSubmit={(ev) => {
				ev.preventDefault();
				if (!problem) save.mutate();
			}}
		>
			<Refresh c={c} />
			<Card title="Project">
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Name" htmlFor="p-name" help="Lowercase letters, numbers and hyphens. You cannot change it later.">
						<Input id="p-name" value={state.name} disabled={!isNew} autoComplete="off" onChange={(e) => set({ name: e.target.value })} />
					</Field>
					<Field label="GitHub repository" htmlFor="p-repo" help="Written as owner/name.">
						<Input id="p-repo" value={state.repo} placeholder="acme/web" autoComplete="off" onChange={(e) => set({ repo: e.target.value })} />
					</Field>
				</div>
				<PosthogField c={c} options={options} state={state} set={set} />
				<SentryField c={c} state={state} set={set} />
			</Card>
			<Card title="Coolify apps (optional)">
				<CoolifyField c={c} state={state} set={set} />
			</Card>
			<Card title="Scouts">
				<ScoutsField state={state} set={set} />
			</Card>
			<Card title="Details">
				<Field label="Notes (optional)" htmlFor="p-notes" help="The scouts read these notes. Describe the product in a few lines.">
					<Textarea id="p-notes" rows={4} value={state.notes} maxLength={2000} onChange={(e) => set({ notes: e.target.value })} />
				</Field>
				<Field label="Test command (optional)" htmlFor="p-test" help="Runs with no network in the tester. Leave empty for none.">
					<Input id="p-test" className="font-mono text-xs" value={state.testCommand} maxLength={500} autoComplete="off" spellCheck={false} onChange={(e) => set({ testCommand: e.target.value })} />
				</Field>
				<fieldset className="space-y-1.5">
					<legend className="text-sm font-medium">Issue authors</legend>
					<p className="text-xs text-muted-foreground">Scouts read GitHub issues from these author types.</p>
					<div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
						{ISSUE_AUTHORS.map((a) => (
							<Label key={a} htmlFor={`a-${a}`} className="flex items-center gap-2 font-mono text-xs">
								<Checkbox id={`a-${a}`} checked={state.authors.includes(a)} onCheckedChange={(v) => set({ authors: toggle(state.authors, a, v === true) })} />
								{a}
							</Label>
						))}
					</div>
				</fieldset>
			</Card>
			<FormActions isNew={isNew} name={state.name} problem={problem} pending={save.isPending} />
		</form>
	);
}
