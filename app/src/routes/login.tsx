import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { env } from "@/server/env";
import { safeRedirect } from "@/lib/redirect";
import { guardedCheck, LockedError } from "@/server/limiter";
import { checkLogin, createSession, sessionCookie } from "@/server/session";

const FAIL_DELAY_MS = 1000;

async function login(request: Request): Promise<Response> {
	const form = await request.formData();
	const to = safeRedirect(form.get("redirect"));
	const e = env();
	const refuse = (error: string) => new Response(null, { status: 303, headers: { Location: `/login?error=${error}&redirect=${encodeURIComponent(to)}` } });
	try {
		const ok = await guardedCheck(() => checkLogin(String(form.get("user") ?? ""), String(form.get("password") ?? ""), e), FAIL_DELAY_MS);
		if (!ok) return refuse("1");
	} catch (err) {
		if (err instanceof LockedError) return refuse(`locked${err.minutes}`);
		throw err;
	}
	const headers = new Headers({ Location: to });
	headers.append("Set-Cookie", sessionCookie(createSession(e), request));
	return new Response(null, { status: 303, headers });
}

export const Route = createFileRoute("/login")({
	validateSearch: z.object({ redirect: z.string().optional(), error: z.coerce.string().optional() }),
	server: { handlers: { POST: ({ request }) => login(request) } },
	head: () => ({ meta: [{ title: "Sign in - Warden" }] }),
	component: LoginPage,
});

function LoginPage() {
	const { redirect, error } = Route.useSearch();
	const lock = /^locked(\d{1,3})$/.exec(error ?? "");
	return (
		<main className="mx-auto flex min-h-screen max-w-sm items-center px-4">
			<form method="post" action="/login" className="w-full space-y-4 rounded-xl border bg-card p-6">
				<div>
					<h1 className="mb-3">
						<Logo className="h-7" />
					</h1>
					<p className="text-muted-foreground">Your session ended or you are new here.</p>
				</div>
				<input type="hidden" name="redirect" value={safeRedirect(redirect)} />
				<div className="space-y-1.5">
					<Label htmlFor="user">User</Label>
					<Input id="user" name="user" autoComplete="username" defaultValue="" required />
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="password">Password</Label>
					<Input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
				</div>
				{error ? (
					<p role="alert" className="text-status-error">
						{lock ? `Too many failed attempts. Try again in ${lock[1]} min.` : "Wrong user name or password."}
					</p>
				) : null}
				<Button type="submit" className="h-9 w-full">
					Sign in
				</Button>
			</form>
		</main>
	);
}
