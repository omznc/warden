import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageHead, UrlForm } from "@/components/settings-forms";
import { integrationsQuery } from "@/lib/queries";

export const Route = createFileRoute("/_app/settings/")({
	loader: ({ context }) => context.queryClient.ensureQueryData(integrationsQuery()),
	component: GeneralPage,
});

function GeneralPage() {
	const data = useQuery(integrationsQuery()).data;
	if (!data) return null;
	return (
		<>
			<PageHead title="General" text="Settings for the whole of Warden. Settings for one project are on the page of the project." />
			<UrlForm
				key={data.wardenUrl ?? ""}
				id="warden-url"
				label="Warden URL"
				settingKey="warden_url"
				value={data.wardenUrl}
				source={data.wardenUrlSource}
				placeholder="https://warden.example.com"
				help="The address of this UI. Notices use it for the review links. A value set here wins over WARDEN_URL in .env. Leave the field empty to use .env. Without a value, notices have no review link."
			/>
		</>
	);
}
