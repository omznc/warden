# State files

The volume `state` is `/state` (`STATE_ROOT`). The runner and the UI both use it. Each file has one owner for writing.
For the item files, read `items.md`. For the inbox, read `secrets.md`.

## Layout

- `/state/projects.json`: the live list of projects. Writer: the UI (atomic). The runner copies `projects.json` of the repository (`PROJECTS_FILE`) into the state at the start, only if the state file does not exist (seed). Without a seed the list is empty.
- `/state/settings.json`: settings of the UI. Writer: the UI only. See below.
- `/state/runs.jsonl`: one line for each run. Writer: `run-scout.sh`. The runner keeps the last 1000 lines when the file passes 2000.
- `/state/health.json`: failures in a row for each scout. See `notifications.md`.
- `/state/last-run`: the epoch time of the last pass. `run-all.sh` writes it before the pass, so a crash cannot cause a burst of runs.
- `/state/last-sync`, `/state/last-weekly`: the epoch times of the last GitHub sync and the last weekly summary.
- `/state/cap-notified`: the UTC date of the last cost cap notice.
- `/state/ui-session.json`: the session generation. Writer: the UI. See `app/CLAUDE.md`.
- `/state/notify-test.json`: result of the test message. Writer: the runner.
- `/state/submit.lock`: lock of `submit-approved.sh`. Only one caller works at a time. Empty file. Writer: `submit-approved.sh`.
- `/state/checkout-<project>.lock`: lock of the shared checkout `/work/<project>`. `run-scout.sh` holds it for a whole run. `submit-approved.sh` holds it for the git work of one PR. Empty file, mode 600.
- `/state/running/<project>__<scout>.json`: exists while a run is active. Writer: `run-scout.sh`. `run-all.sh` deletes the old files at start (`clean_running`). Fields: `id`, `project`, `scout`, `started`, `mode`.
- `/state/requests/<project>__<scout>.json`: a run-now request. Writer: the UI. Field: `requested_at`. See "Requests".
- `/state/requests/notify-test.json`: a test message request.
- `/state/<project>/ledger.json`: fingerprint to issue number, and `pr:<fp>` to PR number.
- `/state/<project>/<scout>/`: the directory of the agent: `scratchpad.md` (notes between runs), and copies of the trusted input (`issues.json`, `prs.json`, `coolify.json`, `coolify-logs/`). The agent can write here. Do not trust a file in it.
- `/state/<project>/<scout>.seen.json`, `/state/<project>/coolify.seen.json`: what the runner handled. They are in the closed project directory, so the agent cannot change them.
- `/state/<project>/pending/<id>/`: the items.
- `/work/<project>`: the repository checkout. Only the runner makes it.

## runs.jsonl

Fields: `id` (`<yyyymmddTHHMMSSZ>-<project>-<scout>`), `started`, `ended`, `project`, `scout`, `mode`, `status`, `error`, `summary`, `turns`, `cost_usd`, `findings`.

- `status` is `ok`, `error` or `skipped`. A `skipped` run has no cost. Its `error` holds the reason, for example "daily cost cap reached".
- Each entry of `findings` has `fingerprint`, `action`, `severity`, `title`, `number`, `url`.
- Actions: `issue`, `comment`, `pr`, `pr-update`, `pending`, `pending-<kind>`, `dry-issue`, `dry-comment`, `dry-pr`, `dry-pr-update`, `skipped-dup`, `skipped-cap`, `skipped-mode`, `blocked-secret`, `blocked-path`, `blocked-conflict`, `pr-update-failed`.
- The UI reads the file. A line it cannot parse is not a run.

## settings.json

Writer: the UI (read, change, atomic write in `mergeSettings`). The runner reads it. The agent cannot write there.

- `daily_cost_cap_usd`: a number, or no key for no cap. When the cost of the runs of today (UTC) reaches it, each new run is `skipped` and `claude` does not start. The runner sends one notice each day.
- `stale_days` (default 30), `reject_days` (default 30).
- `hermes_webhook_url`, `warden_url`.
- `coolify`: `[{name, url}]`. See `coolify.md`.
- `projects.<name>.mode` (`dry`, `issues`, `prs`) and `projects.<name>.auto_submit`.

## projects.json fields

`name`, `repo`, `posthog_project_id`, `posthog_key_env`, `posthog_ui`, `notes`, `scouts`, `issue_authors`, `test_command`, `test_install`, `sentry` (`{org, project}`), `coolify` (`[{instance, app_uuid}]`, at most 10), `enabled` (default true; a pass skips a disabled project), `posthog_region` (`eu` or `us`, default `eu`).

`projects_json` in `lib.sh` checks each entry when it reads the file. It logs and skips an invalid entry:

- `name` matches `^[a-z0-9][a-z0-9-]*$`.
- `repo` matches `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`.
- `posthog_key_env` matches `POSTHOG_API_KEY_[A-Z0-9_]+`.
- Each scout is a directory in `skills/`.

## Requests

`handle_requests` in `lib.sh` runs between the runs of a pass and in each loop chunk.

- For `<project>__<scout>.json`, it checks the pair against `projects.json`, deletes the file and runs the pair.
- A pair that is running keeps its request. A bad request is deleted without a run.
- The UI start function (`startRun` in `store.ts`) refuses a disabled project. It writes nothing for a pair that runs or has a request.

## Cost cap

`run-scout.sh` adds the `cost_usd` of the runs that started today (UTC) from `runs.jsonl`. It checks the cap before the project check. The UI cost chart shows the last 14 days.
