import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PasswordField } from "@/components/secret-editor";
import { Time } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { integrationsQuery } from "@/lib/queries";
import { notifyResultText, TEST_WAIT_MS } from "@/lib/settings";
import { notifyTestFn } from "@/server/fns";

// A request waits for the runner at most TEST_WAIT_MS. The clock ticks only while a request exists.
function useExpired(requestedAt: string | null | undefined): boolean {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!requestedAt) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 5000);
		return () => clearInterval(timer);
	}, [requestedAt]);
	return Boolean(requestedAt) && now - Date.parse(requestedAt as string) >= TEST_WAIT_MS;
}

// The runner sends the message and writes the result. The page shows only the status code, never an answer body.
export function HermesTest() {
	const client = useQueryClient();
	const [password, setPassword] = useState("");
	const { data } = useQuery(integrationsQuery());
	const send = useMutation({
		mutationFn: () => notifyTestFn({ data: { password } }),
		onSuccess: async () => {
			setPassword("");
			await client.invalidateQueries({ queryKey: ["integrations"] });
			toast.success("Test requested. The runner sends it at its next loop. It can wait for a scout run to end.");
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : "Could not request the test"),
	});
	const expired = useExpired(data?.test.requestedAt);
	const waiting = send.isPending || (Boolean(data?.test.requested) && !expired);
	const result = data?.test.result ?? null;
	return (
		<form
			className="space-y-3 rounded-lg border bg-card p-4"
			onSubmit={(ev) => {
				ev.preventDefault();
				if (password && !waiting) send.mutate();
			}}
		>
			<div className="space-y-1">
				<h2 className="text-sm font-semibold">Test message</h2>
				<p className="text-muted-foreground">Sends the text "warden test message" with the saved URL and secret. Save changes first. The runner sends it at its next loop. It can wait for a scout run to end.</p>
			</div>
			<PasswordField id="test-password" value={password} onChange={setPassword} />
			<SendButton waiting={waiting} disabled={!password} />
			<Outcome expired={expired && !send.isPending} result={waiting ? null : result} />
		</form>
	);
}

function SendButton({ waiting, disabled }: { waiting: boolean; disabled: boolean }) {
	return (
		<Button type="submit" variant="outline" disabled={waiting || disabled}>
			{waiting ? <Spinner /> : null}
			{waiting ? "Waiting for the runner" : "Send test message"}
		</Button>
	);
}

function Outcome({ expired, result }: { expired: boolean; result: { ok: boolean; status: string; at: string | null } | null }) {
	if (expired) return <p role="alert" className="text-xs text-status-error">The runner did not answer. Check that the runner runs.</p>;
	return result ? <ResultLine result={result} /> : null;
}

function ResultLine({ result }: { result: { ok: boolean; status: string; at: string | null } }) {
	const Icon = result.ok ? Check : TriangleAlert;
	return (
		<p role="status" className={result.ok ? "flex items-center gap-2 text-status-ok" : "flex items-center gap-2 text-status-error"}>
			<Icon aria-hidden className="size-3.5 shrink-0" />
			<span>
				{notifyResultText(result)} {result.at ? <Time iso={result.at} /> : null}
			</span>
		</p>
	);
}
