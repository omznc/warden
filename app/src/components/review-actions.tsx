import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { approveLabel } from "@/components/badges";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { ItemDetail, ItemKind } from "@/lib/types";
import { decideItem } from "@/server/fns";

const NOUN: Record<ItemKind, string> = { pr: "pull request", "pr-update": "PR update", issue: "issue", comment: "comment" };
const SHORT: Record<ItemKind, string> = { pr: "PR", "pr-update": "PR update", issue: "issue", comment: "comment" };

export function useDecide(item: ItemDetail) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (v: { action: "approve" | "reject"; reason?: string }) => decideItem({ data: { id: item.id, project: item.project, ...v } }),
		onSuccess: async (_r, v) => {
			await client.invalidateQueries();
			toast.success(v.action === "approve" ? "Approved. The runner submits it within about a minute." : "Rejected. Nothing was sent.");
		},
		onError: (e) => toast.error(`Could not save the decision: ${e instanceof Error ? e.message : String(e)}`),
	});
}

function RejectDialog({ item, open, onOpenChange, onReject }: { item: ItemDetail; open: boolean; onOpenChange: (o: boolean) => void; onReject: (reason: string) => void }) {
	const [reason, setReason] = useState("");
	const cancel = useRef<HTMLButtonElement>(null);
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent initialFocus={cancel} className="data-[size=default]:sm:max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>Reject this {NOUN[item.kind]}?</AlertDialogTitle>
					<AlertDialogDescription>
						Warden sends nothing to GitHub. The item stays in the list as rejected. Fingerprint <span className="font-mono">{item.fingerprint}</span>.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="space-y-1.5">
					<Label htmlFor="reason">Reason (optional, saved with the item)</Label>
					<Textarea id="reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="For example: the fix belongs in the data import, not the renderer" />
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel ref={cancel}>Cancel</AlertDialogCancel>
					<Button variant="destructive" className="bg-destructive text-background hover:bg-destructive/90" onClick={() => onReject(reason)}>
						Reject {SHORT[item.kind]}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

// Reject and approve. The buttons stay off while the request runs, so a double click sends one request.
export function ActionBar({ item, className, locked }: { item: ItemDetail; className?: string; locked?: boolean }) {
	const decide = useDecide(item);
	const [open, setOpen] = useState(false);
	const busy = decide.isPending || Boolean(locked);
	if (item.status !== "pending" && item.status !== "error") return null;
	const retry = item.status === "error";
	return (
		<div className={className}>
			{retry ? null : (
				<Button variant="outline" className="text-status-error" disabled={busy} onClick={() => setOpen(true)}>
					Reject
				</Button>
			)}
			<Button disabled={busy} onClick={() => decide.mutate({ action: "approve" })}>
				{decide.isPending ? <Spinner /> : null}
				{decide.isPending ? "Approving…" : retry ? "Try again" : approveLabel(item)}
			</Button>
			<RejectDialog
				item={item}
				open={open}
				onOpenChange={setOpen}
				onReject={(reason) => {
					setOpen(false);
					decide.mutate({ action: "reject", reason });
				}}
			/>
		</div>
	);
}
