# Secrets

A secret is a token, a key or a password. Only the runner holds secrets that matter (GitHub, PostHog, webhook, Coolify). The agent gets its model credential only.
Code: `bin/inbox.sh`, the secret section of `bin/lib.sh`, `app/src/server/secrets.ts`, `app/src/lib/secrets.ts`.
Tests: `test/inbox.sh`.

## Sources

A key comes from the environment of the runner (`.env`) or from the UI. A key that the UI set wins: `load_overrides` exports the keys of `overrides.env` after the start.
The UI shows the source: `env`, `ui` or `unset`.

## The inbox flow

1. The person enters a value in Settings. The server function asks for the Warden password first (`checkPassword`).
2. The UI writes `/inbox/<KEY>.json` (mode 600): `{"value": "...", "written_at": "..."}` or `{"clear": true, "written_at": "..."}`. It can clear only a key whose source is `ui`.
3. The runner reads the inbox in each loop chunk (`inbox.sh`). It deletes each file after the read.
4. `inbox.sh` refuses a key that `secret_key_ok` does not allow.
5. A value must be one line of 8 to 500 characters with no space. A Coolify token must also have no quote, backslash or control character.
6. `check_value` tests the value:
   - `GH_TOKEN`: `gh repo view` for each project repository.
   - `POSTHOG_API_KEY_*`: a GET of the PostHog project of each project that uses the key. HTTP failure code 22 is `invalid`. Another failure is `error`.
   - `WARDEN_POSTHOG_TOKEN` must start with `phc_`. `WARDEN_POSTHOG_HOST` must look like `https://host`.
   - `COOLIFY_TOKEN_*`: a probe of the instance. See `coolify.md`.
   - The other keys get no live check.
7. A value with state `ok` or `warn` goes to `/secrets/overrides.env` (mode 600, atomic write).
8. The runner writes `/inbox/status.json`: `{"<KEY>": {"source", "state", "detail", "updated_at"}}`. It never holds a value. The UI reads it.

The server function and its errors never hold the value or the password. Keep it so.

## Allowed keys

`secret_key_ok` in `lib.sh` is the one list on the runner side. `isSecretKey` in `app/src/lib/secrets.ts` is the list on the UI side. Change both together.

- Fixed: `GH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `SENTRY_TOKEN`, `WARDEN_POSTHOG_TOKEN`, `WARDEN_POSTHOG_HOST`, `HERMES_WEBHOOK_SECRET`.
- Pattern: `POSTHOG_API_KEY_[A-Z0-9_]+` and `COOLIFY_TOKEN_[A-Z0-9_]+`.
- `load_overrides` reads the file line by line and applies the list again. It never uses `source`.

## Scan patterns

`secret_names` lists the variables whose values count as secrets (the fixed keys, `WARDEN_PASSWORD`, each `POSTHOG_API_KEY_*` and `COOLIFY_TOKEN_*`).
The patterns (ERE, in `lib.sh`) are the same for `scrub_secrets` and `secret_hit`:

- `secret_kv_re`: a name with `secret`, `password`, `passwd`, `token`, `key`, `passphrase`, `credential` or `authorization`, then `=` or `:`, then a value.
- `secret_pass_re`: the name `pass`, then `=` or `:`.
- `secret_token_re`: known token shapes (GitHub, PostHog `phx_`, Anthropic, OpenRouter, Stripe, Slack, AWS, npm, GitLab, a numeric pipe token, a JWT).
- `secret_bearer_re`, `secret_urlpass_re`, `secret_cookie_re`, and the PEM private key markers.
- A false positive is better than a leak.
- `secret_hit <file>...` succeeds when a file holds a value of a secret variable or a match. It turns off `set -x` while it runs.
- `scrub_secrets` filters stdin to stdout and replaces matches with `[removed]`. Use it on text from a service log before the agent reads it. The Coolify logs use it.

## Where the scan runs

- Before the runner saves an item: title, body, and the diff of a PR.
- Again in `submit-approved.sh`, before each write.
- On the agent diff of a `warden-ci` update.

A hit blocks the write, records `blocked-secret`, and sends a notice with the project and the scout only.

## Rules

- Put a key in a curl config on stdin, never in an argument list. See `ph_get` and `coolify_get`.
- Do not print a value in a log, a status file or a notice.
- A traced shell must not print a secret. The helpers turn off `set -x` for their body.
- Remind the owner to rotate a secret that appeared in a log.
