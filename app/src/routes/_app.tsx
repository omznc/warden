import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CommandMenu } from "@/components/command-menu";
import { TopBar } from "@/components/topbar";
import { shellQuery } from "@/lib/queries";

export const Route = createFileRoute("/_app")({
	beforeLoad: async ({ context, location }) => {
		try {
			await context.queryClient.ensureQueryData(shellQuery());
		} catch {
			throw redirect({ to: "/login", search: { redirect: location.href } });
		}
	},
	component: AppLayout,
});

function AppLayout() {
	const { data } = useQuery(shellQuery());
	const count = data?.pendingCount ?? 0;
	return (
		<>
			<title>{count > 0 ? `(${count}) Warden` : "Warden"}</title>
			<TopBar />
			<main className="mx-auto max-w-[1200px] px-4 pb-10 pt-6 sm:px-6">
				<Outlet />
			</main>
			<CommandMenu />
		</>
	);
}
