import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { removeProjectFn, setEnabledFn } from "@/server/fns";

function RemoveDialog({ name, open, onOpenChange }: { name: string; open: boolean; onOpenChange: (o: boolean) => void }) {
	const [typed, setTyped] = useState("");
	const client = useQueryClient();
	const navigate = useNavigate();
	const remove = useMutation({
		mutationFn: () => removeProjectFn({ data: { id: name, confirm: typed } }),
		onSuccess: async () => {
			await client.invalidateQueries();
			toast.success(`Removed ${name}`);
			navigate({ to: "/projects" });
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove the project"),
	});
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="data-[size=default]:sm:max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>Remove {name}?</AlertDialogTitle>
					<AlertDialogDescription>
						Warden stops all runs for this project. It keeps the saved state and the pending items on disk. Nothing changes on GitHub.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="space-y-1.5">
					<Label htmlFor="confirm-name">Type <span className="font-mono">{name}</span> to confirm</Label>
					<Input id="confirm-name" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<Button variant="destructive" className="bg-destructive text-background hover:bg-destructive/90" disabled={typed !== name || remove.isPending} onClick={() => remove.mutate()}>
						Remove project
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

// Disable keeps the project in the file. Remove takes it out of the file but keeps its state.
export function ProjectAdmin({ name, enabled }: { name: string; enabled: boolean }) {
	const client = useQueryClient();
	const [open, setOpen] = useState(false);
	const toggle = useMutation({
		mutationFn: (v: boolean) => setEnabledFn({ data: { id: name, enabled: v } }),
		onSuccess: async (_r, v) => {
			await client.invalidateQueries();
			toast.success(v ? "Project enabled" : "Project disabled");
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
	});
	return (
		<div className="divide-y overflow-hidden rounded-lg border bg-card">
			<div className="flex items-start justify-between gap-4 p-4">
				<div>
					<Label htmlFor="disable" className="text-sm font-semibold">Disable project</Label>
					<p className="text-muted-foreground">A disabled project gets no runs. Its findings and pending items stay.</p>
				</div>
				<Switch id="disable" checked={!enabled} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate(!v)} />
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3 p-4">
				<div>
					<h3 className="text-sm font-semibold">Remove project</h3>
					<p className="text-muted-foreground">Takes it out of the project list. The saved state and pending items stay on disk.</p>
				</div>
				<Button variant="outline" className="text-status-error" onClick={() => setOpen(true)}>Remove project</Button>
			</div>
			<RemoveDialog name={name} open={open} onOpenChange={setOpen} />
		</div>
	);
}
