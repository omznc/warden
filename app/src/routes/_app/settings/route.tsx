import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/settings-layout";
import { SettingsNav } from "@/components/settings-nav";

export const Route = createFileRoute("/_app/settings")({
	component: SettingsRoot,
});

function SettingsRoot() {
	const { pathname } = useLocation();
	return (
		<SettingsLayout nav={<SettingsNav pathname={pathname} />}>
			<Outlet />
		</SettingsLayout>
	);
}
