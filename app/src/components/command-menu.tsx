import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { scoutName } from "@/lib/format";
import { overviewQuery, reviewQuery } from "@/lib/queries";
import { startRunFn } from "@/server/fns";

// Go-to menu for projects and waiting items. It also starts a run.
export function CommandMenu() {
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	const client = useQueryClient();
	const overview = useQuery({ ...overviewQuery(), enabled: open });
	const pending = useQuery({ ...reviewQuery("pending"), enabled: open });

	useEffect(() => {
		const onKey = (ev: KeyboardEvent) => {
			if (ev.key.toLowerCase() === "k" && (ev.metaKey || ev.ctrlKey)) {
				ev.preventDefault();
				setOpen((o) => !o);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const go = (fn: () => void) => {
		setOpen(false);
		fn();
	};
	const run = async (project: string, scout: string) => {
		setOpen(false);
		try {
			await startRunFn({ data: { project, scout } });
			toast.success(`Run started: ${scoutName(scout)} on ${project}`);
			await client.invalidateQueries();
		} catch (e) {
			toast.error(`Could not start the run: ${e instanceof Error ? e.message : String(e)}`);
		}
	};
	return (
		<CommandDialog open={open} onOpenChange={setOpen} title="Command menu" description="Go to a project or a waiting item, or start a run.">
			<Command>
				<CommandInput placeholder="Go to a project or item, or start a run" />
				<CommandList>
					<CommandEmpty>Nothing matches.</CommandEmpty>
					{pending.data?.length ? (
						<CommandGroup heading="Waiting for you">
							{pending.data.map((i) => (
								<CommandItem key={`${i.project}/${i.id}`} value={`item ${i.title} ${i.project}`} onSelect={() => go(() => navigate({ to: "/review/$id", params: { id: i.id }, search: { project: i.project } }))}>
									{i.title}
									<span className="ml-auto text-xs text-muted-foreground">{i.project}</span>
								</CommandItem>
							))}
						</CommandGroup>
					) : null}
					<CommandGroup heading="Projects">
						{overview.data?.projects.map((p) => (
							<CommandItem key={p.name} value={`project ${p.name}`} onSelect={() => go(() => navigate({ to: "/projects/$id/settings", params: { id: p.name } }))}>
								{p.name}
								<span className="ml-auto text-xs text-muted-foreground">{p.repo}</span>
							</CommandItem>
						))}
					</CommandGroup>
					<CommandGroup heading="Start a run">
						{overview.data?.projects.flatMap((p) =>
							p.cells.map((c) => (
								<CommandItem key={`${p.name}/${c.scout}`} value={`run ${scoutName(c.scout)} ${p.name}`} onSelect={() => run(p.name, c.scout)}>
									Run {scoutName(c.scout)} on {p.name}
								</CommandItem>
							)),
						)}
					</CommandGroup>
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
