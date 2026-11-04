import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication } from "@simplewebauthn/browser";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { safeRedirect } from "@/lib/redirect";

const post = (url: string, body?: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

// Returns "unavailable" when the server has no passkey setup, so the button stays hidden.
async function ceremony(redirect: string, autofill: boolean): Promise<"unavailable" | "ok" | "failed" | "cancelled"> {
	const res = await post("/passkey-options");
	if (!res.ok) return "unavailable";
	try {
		const assertion = await startAuthentication({ optionsJSON: await res.json(), useBrowserAutofill: autofill });
		const verify = await post("/passkey-verify", assertion);
		if (!verify.ok) return "failed";
		window.location.assign(safeRedirect(redirect));
		return "ok";
	} catch (e) {
		// A new ceremony aborts the old one, and the user can dismiss the prompt. Neither is an error.
		return e instanceof Error && ["AbortError", "NotAllowedError"].includes(e.name) ? "cancelled" : "failed";
	}
}

export function PasskeyLogin({ redirect }: { redirect: string | undefined }) {
	const [available, setAvailable] = useState(false);
	const [failed, setFailed] = useState(false);

	const run = useCallback(
		async (autofill: boolean) => {
			const result = await ceremony(redirect ?? "/", autofill);
			if (result === "unavailable") return;
			setAvailable(true);
			setFailed(result === "failed");
		},
		[redirect],
	);

	useEffect(() => {
		if (!window.isSecureContext || !browserSupportsWebAuthn()) return;
		// Conditional mediation shows the passkeys in the user field. Without it, only probe for the button.
		void browserSupportsWebAuthnAutofill().then(async (autofill) => {
			if (autofill) return run(true);
			setAvailable((await post("/passkey-options")).ok);
		});
	}, [run]);

	if (!available) return null;
	return (
		<div className="space-y-2">
			<Button type="button" variant="outline" className="h-9 w-full" onClick={() => void run(false)}>
				Sign in with a passkey
			</Button>
			{failed ? (
				<p role="alert" className="text-status-error">
					Passkey sign-in failed.
				</p>
			) : null}
		</div>
	);
}
