# app/ - the web UI

The UI is a TanStack Start app (React 19, Vite, Nitro with the Bun preset, Tailwind, shadcn style components on Base UI). It runs in the container `ui` on port 8650.
It reads and writes the volume `state`, the volume `inbox` and reads `tests-out`. It never has a token and never calls GitHub.
Commands are in the root `CLAUDE.md`. Use `bun`, not `npm`.

## Layout

- `src/server/`: code that runs on the server only. Each file has one job:
  - `fns.ts`: all server functions (`createServerFn`) with Zod validators. The routes call only these.
  - `store.ts`: projects, runs, settings, items, the 409 rule, run requests.
  - `views.ts`: the read models for the pages (overview, findings, runs, project).
  - `secrets.ts`, `integrations.ts`, `coolify.ts`, `coolify-settings.ts`, `connections.ts`: the settings pages and the project forms.
  - `session.ts`, `limiter.ts`, `guard.ts`, `middleware.ts`, `start.ts` (in `src/`): login, password check, request guard.
  - `env.ts`, `paths.ts`, `fsio.ts`: environment, safe paths, atomic JSON files.
  - `server.test.ts`: the test file. It runs with `bun test src`.
- `src/lib/`: pure helpers and types for both sides (`types.ts`, `secrets.ts`, `settings.ts`, `coolify.ts`, `queries.ts`). `queries.ts` holds the React Query options and the poll times.
- `src/routes/`: file routes. `_app.tsx` is the layout. It redirects to `/login` when the shell query fails. `login.tsx` and `logout.ts` are outside it.
- `src/components/`: page parts. `src/components/ui/` is the base kit. Prefer it over a new widget.
- `src/routeTree.gen.ts` is generated. Do not edit it.
- Settings pages: `src/routes/_app/settings/` (`index.tsx` General, `limits.tsx`, `security.tsx`, `integrations/`). The nav groups are in `components/settings-nav.tsx` (`SETTINGS_GROUPS`). The integration list is `lib/integrations.ts`. A new integration needs an entry there and a page.

## Security rules

- `src/start.ts` registers `requestGuard` (every request) and `authMiddleware` (every server function). A server function is a public endpoint, so it needs a session. Do not bypass the middleware.
- `requestGuard`: `/health` answers 200. With no `WARDEN_PASSWORD` every other route answers 503. A POST needs an `Origin` or `Referer` host equal to `Host`. It sets a CSP with a nonce, `nosniff`, `same-origin` referrer and `no-store`.
- The session is a signed cookie (`warden_session`, 30 days, HttpOnly, SameSite Lax, Secure on https). Lax keeps the session when a person follows a link from a notice. This is safe because each non-GET request needs a same Origin (`guard.ts`).
- The key is `WARDEN_SESSION_SECRET`. When it is not set, the UI makes a random key one time and keeps it in `/state/ui-session-key.json` (mode 0600), so a restart does not end the sessions.
- Passkeys (WebAuthn, `@simplewebauthn/server` and `@simplewebauthn/browser`) are a second way to sign in. The code is in `passkeys.ts`. The credentials are in `/state/ui-passkeys.json` (mode 0600).
- The RP ID and the expected origin come from `WARDEN_URL` (`env().wardenUrl`) only. Never use `Host` or `x-forwarded-*`. Without `WARDEN_URL`, only `http://localhost:<port>` is valid. If neither is valid, the passkey API answers 503 and the UI hides the controls.
- Challenges are in memory, single use, and live 5 minutes.
- To add or delete a passkey, a person needs a session and the password (`checkPassword`). The server functions in `fns.ts` do this.
- Only two routes work without a session: `/passkey-options` and `/passkey-verify`. Both are POST, so the Origin check applies. The verify route uses `guardedCheck` (the same limiter as the password) and sets the same cookie with `createSession`. "Sign out everywhere" also ends passkey sessions.
- The CSP needs no change for WebAuthn: `connect-src 'self'` covers the two fetch calls.
- "Sign out everywhere" raises the generation in `/state/ui-session.json`. Every older cookie stops working.
- Ask for the password again (`checkPassword` in `limiter.ts`) for these changes: a secret, the Hermes URL or the Warden URL, the test message, a Coolify instance, and "sign out everywhere". Five failures in 10 minutes lock all checks for 10 minutes. A failure waits one second.
- Error texts of these functions are fixed. They never hold the password or the value.
- A secret value is in one request only. It goes to `/inbox/<KEY>.json` (mode 600). The UI never reads a value back. It reads `status.json`.
- Build a path only with `stateDir(root, ...names)`. It refuses a name that does not match `^[a-z0-9][a-z0-9-]*$`.
- Files in the state are untrusted input for the UI too. The runner and the tester wrote them. Keep only known fields, cap the length, and render text as text. Markdown goes through `rehype-sanitize`.
- Do not write to GitHub from the UI. Do not read `/secrets`. The container does not mount it.

## The store and the 409 rule

- Write `settings.json` with `mergeSettings`. It reads the file at write time and changes only the keys you touch. Never write a stale copy.
- Write `meta.json` of an item with `writeMetaChecked`. It throws `ConflictError` (HTTP 409) when `status` or `edited_at` changed since the read. The runner writes the same file. See `docs/domains/items.md`.
- Write every JSON file with `writeJsonAtomic` (temp file, then rename).
- The UI only moves an item to `approved` or `rejected`, and it edits `title` and `body` of a `pending` item. The runner does the rest.
- A stale item, or an old pending item that the runner has not marked yet, cannot be approved (`assertNotStale`).

## How the UI talks to the runner

The UI and the runner never call each other. They share files.

| UI action | File | Runner side |
|---|---|---|
| Approve or reject | `/state/<project>/pending/<id>/meta.json` | `submit-approved.sh` |
| Run now | `/state/requests/<project>__<scout>.json` | `handle_requests` |
| Test message | `/state/requests/notify-test.json` | `handle_requests`, `notify_test` |
| Save a secret | `/inbox/<KEY>.json` | `inbox.sh` |
| Refresh discovery | `/inbox/discover.request` | `discover.sh` |
| Project, settings | `/state/projects.json`, `/state/settings.json` | `projects_json`, `settings_url` and similar |

The UI reads `runs.jsonl`, `health.json`, `running/`, `last-run`, `/inbox/status.json`, `/inbox/discovery.json`, `/inbox/project-status.json` and `/tests-out/results/`.
The UI polls with React Query (30 seconds, 5 seconds for an item that is approved or whose tests run).

When you add a field that the runner reads, change the shell code and `docs/domains/state.md` in the same commit. A project created in the UI must pass `project_valid_jq` in `lib.sh`.

## Tests and checks

Run `bun run typecheck`, `bun run test` and `bun run build` in `app/`. CI runs the same three.
The tests use a temp state directory and pass the delay of the password check as an argument, so they stay fast.
