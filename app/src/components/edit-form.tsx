import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { ItemDetail } from "@/lib/types";
import { editItemFn } from "@/server/fns";

const BODY_MAX = 60_000;

export function Footer({ footer }: { footer: string | null | undefined }) {
	if (!footer) return null;
	return (
		<div className="border-t px-4 py-3">
			<p className="text-xs text-muted-foreground">Warden adds this when it posts:</p>
			<pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-[18px]">{footer}</pre>
		</div>
	);
}

// Title and body of a pending item. The diff and the footer stay read-only.
export function EditForm({ item, onDone }: { item: ItemDetail; onDone: () => void }) {
	const client = useQueryClient();
	const [title, setTitle] = useState(item.title);
	const [body, setBody] = useState(item.body);
	const save = useMutation({
		mutationFn: () => editItemFn({ data: { id: item.id, project: item.project, title, body } }),
		onSuccess: async () => {
			await client.invalidateQueries();
			toast.success("Saved. Warden posts the edited text.");
			onDone();
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the edit"),
	});
	const invalid = !title.trim() || !body.trim() || body.length > BODY_MAX;
	return (
		<form
			className="overflow-hidden rounded-lg border bg-card"
			onSubmit={(ev) => {
				ev.preventDefault();
				if (!invalid) save.mutate();
			}}
		>
			<h2 className="border-b px-4 py-3 text-sm font-semibold">Edit before approving</h2>
			<div className="space-y-4 px-4 py-3">
				<div className="space-y-1.5">
					<Label htmlFor="edit-title">Title</Label>
					<Input id="edit-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} required />
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="edit-body">Body (markdown)</Label>
					<Textarea id="edit-body" value={body} maxLength={BODY_MAX} rows={14} onChange={(e) => setBody(e.target.value)} required />
					<p className="tabular text-xs text-muted-foreground">{body.length} of {BODY_MAX} characters</p>
				</div>
			</div>
			<Footer footer={item.footer} />
			<div className="flex justify-end gap-2 border-t bg-muted px-4 py-2.5">
				<Button type="button" variant="outline" disabled={save.isPending} onClick={onDone}>Cancel</Button>
				<Button type="submit" disabled={invalid || save.isPending}>
					{save.isPending ? <Spinner /> : null}
					Save
				</Button>
			</div>
		</form>
	);
}
