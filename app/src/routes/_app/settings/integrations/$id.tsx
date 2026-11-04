import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { CoolifyPanel } from "@/components/coolify-panel";
import { FixRunsCard } from "@/components/fix-runs-card";
import { HermesTest } from "@/components/hermes-test";
import { AddKey, SecretItem } from "@/components/secret-editor";
import { PageHead, UrlForm } from "@/components/settings-forms";
import { Stale } from "@/components/states";
import { Button } from "@/components/ui/button";
import { type Integration, integrationById } from "@/lib/integrations";
import { fixRunsQuery, integrationsQuery, secretsQuery } from "@/lib/queries";
import { isPosthogKey } from "@/lib/secrets";

export const Route = createFileRoute("/_app/settings/integrations/$id")({
	validateSearch: z.object({ add: z.boolean().optional().catch(undefined) }),
	loader: ({ context, params }) => {
		if (!integrationById(params.id)) throw notFound();
		return Promise.all([context.queryClient.ensureQueryData(secretsQuery()), context.queryClient.ensureQueryData(integrationsQuery()), params.id === "claude" ? context.queryClient.ensureQueryData(fixRunsQuery()) : null]);
	},
	component: IntegrationPage,
	notFoundComponent: () => (
		<>
			<PageHead title="Integration not found" text="Warden has no integration with this name." />
			<Link to="/settings/integrations" className="text-link underline">
				Back to the integrations
			</Link>
		</>
	),
});

const NOTES: Record<string, string> = {
	"posthog-events": "The host is optional. The default is https://eu.i.posthog.com.",
	claude: "Set one of these. A token you set here wins over the same name in .env.",
	coolify: "Warden checks each token against its instance after you save it. It warns when the token can write.",
	github: "Warden checks the token against every project repository after you save it.",
};

function HermesUrl() {
	const data = useQuery(integrationsQuery()).data;
	if (!data) return null;
	return (
		<UrlForm
			key={data.hermesUrl ?? ""}
			id="hermes-url"
			label="Webhook URL"
			settingKey="hermes_webhook_url"
			value={data.hermesUrl}
			source={data.hermesUrlSource}
			placeholder="https://hermes.example.com/webhooks/warden"
			help="Not a secret. A value set here wins over HERMES_WEBHOOK_URL in .env. Without a URL, notices go to the log only. The runner reads the URL, the agent does not."
		/>
	);
}

function Keys({ integration }: { integration: Integration }) {
	const { add } = Route.useSearch();
	const navigate = Route.useNavigate();
	const query = useQuery(secretsQuery());
	const [adding, setAdding] = useState(Boolean(add));
	const all = query.data;
	if (!all) return null;
	const posthog = integration.id === "posthog-keys";
	const rows = all.filter((r) => (posthog ? isPosthogKey(r.key) : integration.keys.includes(r.key)));
	const done = () => {
		setAdding(false);
		if (add) navigate({ search: {}, replace: true });
	};
	return (
		<>
			<Stale query={query} />
			{posthog && (adding ? <AddKey onDone={done} /> : <Button variant="outline" onClick={() => setAdding(true)}>Add a PostHog key</Button>)}
			{rows.length ? (
				<ul className="divide-y overflow-hidden rounded-lg border bg-card">
					{rows.map((r) => (
						<SecretItem key={r.key} row={r} />
					))}
				</ul>
			) : (
				<p className="rounded-lg border bg-card p-4 text-muted-foreground">No key yet. Add one, then name it in the connection of a project.</p>
			)}
		</>
	);
}

function IntegrationPage() {
	const { id } = Route.useParams();
	const integration = integrationById(id);
	if (!integration) return null;
	return (
		<>
			<PageHead title={integration.title} text={integration.text} />
			{integration.id === "hermes" ? <HermesUrl /> : null}
			{NOTES[integration.id] ? <p className="text-xs text-muted-foreground">{NOTES[integration.id]}</p> : null}
			{integration.id === "coolify" ? <CoolifyPanel /> : <Keys integration={integration} />}
			{integration.id === "hermes" ? <HermesTest /> : null}
			{integration.id === "claude" ? <FixRunsCard /> : null}
			<p className="text-xs text-muted-foreground">Warden never shows a saved secret. A change needs your Warden password.</p>
		</>
	);
}
