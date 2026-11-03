import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CoolifyLine } from "@/components/coolify-panel";
import { Pill } from "@/components/badges";
import { SOURCE, StateBadge } from "@/components/secret-editor";
import { PageHead } from "@/components/settings-forms";
import { Stale } from "@/components/states";
import { INTEGRATIONS } from "@/lib/integrations";
import { coolifyQuery, integrationsQuery, secretsQuery } from "@/lib/queries";
import { isPosthogKey } from "@/lib/secrets";
import type { SecretRow } from "@/lib/types";

export const Route = createFileRoute("/_app/settings/integrations/")({
	loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(secretsQuery()), context.queryClient.ensureQueryData(integrationsQuery()), context.queryClient.ensureQueryData(coolifyQuery())]),
	component: OverviewPage,
});

function KeyLine({ row }: { row: SecretRow }) {
	return (
		<li className="flex flex-wrap items-center gap-x-3 gap-y-1">
			<span className="min-w-0 break-all font-mono text-xs">{row.key}</span>
			<Pill tone={row.source === "unset" ? "neutral" : "info"}>{SOURCE[row.source]}</Pill>
			<StateBadge row={row} />
		</li>
	);
}

function OverviewPage() {
	const secrets = useQuery(secretsQuery());
	const rows = secrets.data;
	if (!rows) return null;
	return (
		<>
			<Stale query={secrets} />
			<PageHead title="Integrations" text="The services that Warden talks to. Open one to set its URL or its secrets." />
			<ul className="space-y-3">
				{INTEGRATIONS.map((i) => {
					const mine = rows.filter((r) => (i.id === "posthog-keys" ? isPosthogKey(r.key) : i.keys.includes(r.key)));
					return (
						<li key={i.id} className="space-y-2 rounded-lg border bg-card p-4">
							<div className="flex items-baseline justify-between gap-3">
								<h2 className="text-sm font-semibold">{i.title}</h2>
								<Link to="/settings/integrations/$id" params={{ id: i.id }} className="text-xs">Open</Link>
							</div>
							<p className="text-muted-foreground">{i.text}</p>
							<ul className="space-y-1.5">
								{i.id === "coolify" ? <CoolifyLines /> : mine.length ? mine.map((r) => <KeyLine key={r.key} row={r} />) : <li className="text-xs text-muted-foreground">No key yet.</li>}
							</ul>
							{i.id === "hermes" ? <HermesUrlLine /> : null}
						</li>
					);
				})}
			</ul>
		</>
	);
}

function HermesUrlLine() {
	const data = useQuery(integrationsQuery()).data;
	if (!data) return null;
	return (
		<p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
			<span>Webhook URL</span>
			<Pill tone={data.hermesUrlSource === "unset" ? "neutral" : "info"}>{SOURCE[data.hermesUrlSource]}</Pill>
		</p>
	);
}

function CoolifyLines() {
	const rows = useQuery(coolifyQuery()).data;
	if (!rows) return null;
	return rows.length ? rows.map((r) => <CoolifyLine key={r.name} row={r} />) : <li className="text-xs text-muted-foreground">No instance yet.</li>;
}
