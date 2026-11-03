# Notifications

Warden sends notices to a Hermes webhook. Hermes forwards them to a chat.
Code: `bin/notify.sh`, `bin/weekly.sh`, `bin/test-notify.sh`, and `health_record`, `notify_test` and `hermes_url` in `bin/lib.sh`.
Tests: `test/hermes.sh`, `test/ops.sh`, and `bin/test-notify.sh`.

## Send

- `notify.sh "<text>"` posts `{"text": "<text>"}` to the Hermes URL.
- The URL is `hermes_webhook_url` in `settings.json`. It wins over `HERMES_WEBHOOK_URL` in `.env`. `url_ok` checks it: http or https, a plain host, at most 500 characters, no user info. A bad URL in the file is ignored.
- Without a URL, the script prints the text and exits 0.
- The secret is `HERMES_WEBHOOK_SECRET`. Without it the script fails.
- Signature: HMAC-SHA256 version 2 over `<timestamp>.<body>`, as a hex string. Headers: `X-Webhook-Timestamp` and `X-Webhook-Signature-V2`.
- `notify.sh --sign <secret> <timestamp> <body-file>` prints the signature. `bin/test-notify.sh` compares it with a fixed vector.
- Callers write `|| true`. A failed notice never fails a run.
- A notice has the project, the scout, a count, a title or a URL. It never has a body, an error text or a secret.

## Test message

1. The person clicks "Send test message" in Settings, Integrations, Hermes. The server function asks for the password.
2. The UI writes `requests/notify-test.json`. A second click while a fresh file exists changes nothing. A file older than the wait time is dead, and the next click writes a new one.
3. `handle_requests` deletes the file and calls `notify_test`.
4. `notify_test` runs `notify.sh "warden test message"` with `NOTIFY_STATUS_FILE`. It writes `notify-test.json`: `{ok, status, at}`.
5. `status` is the HTTP code, `none` (no URL), `nosecret` (no secret) or `000` (no answer). The runner never stores the answer body or an error text.

## When a notice goes out

| Event | Source | Text |
|---|---|---|
| New items wait | `run-scout.sh` | count, each title, a review link |
| Scout summary | `run-scout.sh` | the notes of auto-submit |
| Item submitted, failed, unclear or interrupted | `submit-approved.sh` | kind, title, URL |
| A write looked like a secret | `run-scout.sh`, `submit-approved.sh` | project and scout |
| Issue, PR or update closed or merged | `sync-github.sh` | kind, state, title, URL |
| A scout failed 2 times in a row | `health_record` | `<project>/<scout>` and exit code |
| A scout runs again after 2 or more failures | `health_record` | the count of failures |
| More than half of the runs in a pass failed | `pass_alarm` in `run-all.sh` | the two counts |
| The daily cost cap is reached | `run-scout.sh` | spent amount. One notice for each UTC day (`cap-notified`). |
| Weekly summary | `weekly.sh` | counts, cost, waiting links |

## health.json

`$STATE_ROOT/health.json` maps `<project>/<scout>` to `{fails, last_good, last_exit, last_at}`.

- Only the runner writes it (mode 600, with `flock` on `health.json.lock`).
- Exit code 0 is good. A skip (cost cap) and "Nothing to follow up" also exit 0.
- The notice goes out when `fails` reaches 2, not at 3 and later. A good run after 2 or more failures sends one "runs again" notice.
- The UI reads `fails` and `last_good` and treats a wrong value as missing.

## Weekly summary

- `run-all.sh` runs `weekly.sh` when `last-weekly` is 7 days old. It writes the stamp first, so a crash cannot cause a burst.
- Counts for the last 7 days: new, submitted, merged, closed, rejected and stale items. They come from `created`, `submitted_at`, `gh_state_at`, `decided_at` and `stale_at` in `meta.json`.
- Cost: the sum of `cost_usd` in `runs.jsonl`.
- Waiting items: one review link each, at most 20, then "and N more". Links need `warden_url` or `WARDEN_URL`.

## Warden URL

`warden_url` in `settings.json` (or `WARDEN_URL`) is the base URL for review links. Without it, notices have no link.
