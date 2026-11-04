import { type PublicKeyCredentialCreationOptionsJSON, startRegistration } from "@simplewebauthn/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PasswordField } from "@/components/secret-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { exactTime } from "@/lib/format";
import { getPasskeys, passkeyAddFn, passkeyDeleteFn, passkeyOptionsFn } from "@/server/fns";

const KEY = ["passkeys"];
const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Passkey action failed");

export function PasskeysCard() {
	const qc = useQueryClient();
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const list = useQuery({ queryKey: KEY, queryFn: () => getPasskeys() });
	const done = (message: string) => {
		toast.success(message);
		setPassword("");
		setName("");
		void qc.invalidateQueries({ queryKey: KEY });
	};
	const add = useMutation({
		mutationFn: async () => {
			const optionsJSON: PublicKeyCredentialCreationOptionsJSON = JSON.parse(await passkeyOptionsFn({ data: { password } }));
			const response = await startRegistration({ optionsJSON });
			await passkeyAddFn({ data: { password, name, response: response as unknown as { id: string } } });
		},
		onSuccess: () => done("Passkey added"),
		onError: (e) => fail(e instanceof Error && e.name === "NotAllowedError" ? new Error("The passkey prompt was cancelled.") : e),
	});
	const remove = useMutation({
		mutationFn: (id: string) => passkeyDeleteFn({ data: { password, id } }),
		onSuccess: () => done("Passkey deleted"),
		onError: fail,
	});
	const supported = typeof window !== "undefined" && window.isSecureContext && "PublicKeyCredential" in window;
	if (!list.data?.available) return null;
	return (
		<form
			className="space-y-3 rounded-lg border bg-card p-4"
			onSubmit={(ev) => {
				ev.preventDefault();
				if (password && supported) add.mutate();
			}}
		>
			<div className="space-y-1.5">
				<Label>Passkeys</Label>
				<p className="text-xs text-muted-foreground">A passkey is an extra way to sign in. The password still works. Enter your Warden password to add or delete a passkey.</p>
			</div>
			{list.data.passkeys.length === 0 ? <p className="text-muted-foreground">No passkey yet.</p> : null}
			<ul className="divide-y">
				{list.data.passkeys.map((p) => (
					<li key={p.id} className="flex items-center justify-between gap-3 py-2">
						<span>
							{p.name} <span className="text-xs text-muted-foreground">added {exactTime(p.created)}</span>
						</span>
						<Button type="button" variant="outline" disabled={!password || remove.isPending} onClick={() => remove.mutate(p.id)}>
							Delete
						</Button>
					</li>
				))}
			</ul>
			<div className="space-y-1.5">
				<Label htmlFor="pk-name">Name</Label>
				<Input id="pk-name" value={name} maxLength={60} placeholder="Laptop" onChange={(e) => setName(e.target.value)} />
			</div>
			<PasswordField id="pk-password" value={password} onChange={setPassword} />
			<Button type="submit" disabled={!password || !supported || add.isPending}>
				{add.isPending ? <Spinner /> : null}
				Add a passkey
			</Button>
			{supported ? null : <p className="text-xs text-muted-foreground">This browser or address cannot make a passkey. Use https.</p>}
		</form>
	);
}
