import { createFileRoute } from "@tanstack/react-router";
import { PasskeysCard } from "@/components/passkeys-card";
import { PageHead, SignOutForm } from "@/components/settings-forms";

export const Route = createFileRoute("/_app/settings/security")({
	component: SecurityPage,
});

function SecurityPage() {
	return (
		<>
			<PageHead title="Session" text="Sign-in sessions of this UI." />
			<PasskeysCard />
			<SignOutForm />
		</>
	);
}
