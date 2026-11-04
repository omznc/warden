import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { fixRunsQuery } from "@/lib/queries";
import { FIX_EFFORTS, FIX_MODELS } from "@/lib/settings";
import { saveFixRuns } from "@/server/fns";

type Value = { model: (typeof FIX_MODELS)[number]; effort: (typeof FIX_EFFORTS)[number]; scouts: string[] };

function Pick<T extends string>({ id, label, value, options, onChange }: { id: string; label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Select value={value} onValueChange={(v) => onChange(String(v) as T)}>
				<SelectTrigger id={id} className="h-9 w-40 font-mono text-xs">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((o) => (
						<SelectItem key={o} value={o} className="font-mono text-xs">
							{o}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function Form({ initial, available }: { initial: Value; available: string[] }) {
	const client = useQueryClient();
	const [value, setValue] = useState<Value>(initial);
	const save = useMutation({
		mutationFn: () => saveFixRuns({ data: value }),
		onSuccess: async () => {
			await client.invalidateQueries({ queryKey: ["fix-runs"] });
			toast.success("Fix runs saved");
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the setting"),
	});
	const toggle = (name: string, on: boolean) => setValue((v) => ({ ...v, scouts: on ? [...v.scouts, name] : v.scouts.filter((s) => s !== name) }));
	return (
		<form
			className="space-y-3 rounded-lg border bg-card p-4"
			onSubmit={(ev) => {
				ev.preventDefault();
				save.mutate();
			}}
		>
			<div className="space-y-1">
				<h2 className="font-semibold leading-6">Fix runs</h2>
				<p className="text-xs text-muted-foreground">A run uses this model when the project mode is prs and the scout is in the list. Other runs use CLAUDE_MODEL.</p>
			</div>
			<div className="flex flex-wrap gap-4">
				<Pick id="fix-model" label="Model" value={value.model} options={FIX_MODELS} onChange={(model) => setValue((v) => ({ ...v, model }))} />
				<Pick id="fix-effort" label="Effort" value={value.effort} options={FIX_EFFORTS} onChange={(effort) => setValue((v) => ({ ...v, effort }))} />
			</div>
			<fieldset className="space-y-2">
				<legend className="mb-1.5 text-sm font-medium">Scouts</legend>
				<div className="flex flex-wrap gap-x-5 gap-y-2">
					{available.map((name) => (
						<Label key={name} htmlFor={`fix-${name}`} className="flex items-center gap-2 font-mono text-xs">
							<Checkbox id={`fix-${name}`} checked={value.scouts.includes(name)} onCheckedChange={(v) => toggle(name, v === true)} />
							{name}
						</Label>
					))}
				</div>
			</fieldset>
			<Button type="submit" disabled={save.isPending}>
				{save.isPending ? <Spinner /> : null}
				Save
			</Button>
		</form>
	);
}

export function FixRunsCard() {
	const data = useQuery(fixRunsQuery()).data;
	if (!data) return null;
	const { available, ...initial } = data;
	return <Form key={JSON.stringify(initial)} initial={initial} available={available} />;
}
