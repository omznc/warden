import { createFileRoute, Link } from "@tanstack/react-router";
import { ProjectForm } from "@/components/project-form";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { connectionsQuery } from "@/lib/queries";

export const Route = createFileRoute("/_app/projects/new")({
	loader: ({ context }) => context.queryClient.ensureQueryData(connectionsQuery()),
	component: NewProject,
});

function NewProject() {
	return (
		<div className="max-w-3xl space-y-4">
			<Breadcrumb>
				<BreadcrumbList className="text-xs">
					<BreadcrumbItem><BreadcrumbLink render={<Link to="/projects" />}>Projects</BreadcrumbLink></BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem><BreadcrumbPage>New project</BreadcrumbPage></BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
			<h1 className="text-xl font-semibold leading-7 max-[639px]:text-lg">Add a project</h1>
			<p className="text-muted-foreground">A new project starts in dry mode. Nothing goes to GitHub until you change the mode.</p>
			<ProjectForm mode="new" />
		</div>
	);
}
