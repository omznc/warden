# Reference

State files, the approval flow, permissions and checks. See the README for the overview.

## State

- `/state/<project>/<scout>/scratchpad.md`: the notes of a scout between runs.
- `/state/<project>/ledger.json`: the fingerprint of each finding and its issue or pull request number.
- `/work/<project>`: the repository checkout.

### State files

- `runs.jsonl`: one line for each run. Writer: `run-scout.sh`. Fields: `id` (`<yyyymmddTHHMMSSZ>-<project>-<scout>`), `started`, `ended`, `project`, `scout`, `mode`, `status`, `error`, `summary`, `turns`, `cost_usd`, `findings`.
  - `status` is `ok`, `error` or `skipped`. A `skipped` run has no cost. Its `error` holds the reason, for example "daily cost cap reached".
  - A finding `action` can be `skipped-mode`: a `pr` finding that the project mode `issues` dropped.
- `projects.json` (in `$STATE_ROOT`): the live list of projects. It has the same array schema as the file in the repository. Writer: the UI (atomic). The runner copies the file `projects.json` of the repository into the state at the start, only if the state file does not exist (seed).
  - Fields: `name`, `repo`, `posthog_project_id`, `posthog_key_env`, `posthog_ui`, `notes`, `scouts`, `issue_authors`, `test_command`, `test_install`, `sentry` (`{org, project}`), `enabled` (default true; a pass skips a disabled project), `posthog_region` (`eu` or `us`, default `eu`; it sets the API host, the MCP URL stays `mcp.posthog.com`).
  - The runner validates each entry on read: `name` matches `^[a-z0-9][a-z0-9-]*$`, `repo` matches `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$`, `posthog_key_env` is an allowed secret key, and each scout is a directory in `skills/`. It logs and skips an invalid entry.
- `settings.json` also has `daily_cost_cap_usd` (a number; null or absent means no cap). When the cost of today's runs (UTC) reaches the cap, each new run is recorded as `skipped` and claude does not start. The runner sends one notification each day.
- `health.json`: for each `<project>/<scout>`: `fails` (runs in a row that failed), `last_good`, `last_exit`, `last_at`. Writer: the runner only (mode 600). A run with exit code 0 is good, also a skip (cost cap) and "Nothing to follow up". One notice goes out at 2 failures in a row, one when the scout runs well again, and one for a pass in which more than half of the runs failed. A notice has the project, the scout and the exit code only.
- `last-weekly`: the time of the last weekly summary. `weekly.sh` sends one notice each 7 days: the counts of new, submitted, merged, closed, rejected and stale items, the cost from `runs.jsonl`, and a review link for each item that waits. The runner writes the times `created`, `submitted_at`, `stale_at`, and the UI writes `decided_at`, in `meta.json` for these counts.
- PostHog events: set `WARDEN_POSTHOG_TOKEN` (a project token, `phc_...`) and optionally `WARDEN_POSTHOG_HOST` (default `https://eu.i.posthog.com`) in `.env` or in Settings, Integrations. Without the token nothing is sent. Events: `warden scout run` (project, scout, status, exit_code, cost_usd, duration_s, items_created), `warden item created` and `warden item status changed` (project, scout, item_id, kind, old_status, new_status). The properties hold ids, statuses and numbers only. The distinct id is `warden-<hostname>`, with no person profile. A failed send never fails a run. The runner reads the token. The agent does not get it. The UI writes the status changes approved and rejected, so the runner reports `rejected` only when it processes the feedback.
- Secrets inbox (volume `inbox`, `/inbox` in the runner and the UI). The volume `secrets` is mounted in the runner only (`/secrets`).
  - `/inbox/<KEY>.json`: writer: the UI. Content: `{"value": "...", "written_at": "..."}` or `{"clear": true, "written_at": "..."}`.
  - The runner reads the files in each loop chunk. It deletes each file after the read.
  - Allowed keys: `GH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `POSTHOG_API_KEY_[A-Z0-9_]+`, `SENTRY_TOKEN`, `WARDEN_POSTHOG_TOKEN`, `WARDEN_POSTHOG_HOST`, `HERMES_WEBHOOK_SECRET`. The runner refuses all other keys.
- Integrations: the page Settings > Integrations sets every integration. The URLs are not secrets. The UI writes `hermes_webhook_url` and `warden_url` in `settings.json` (http or https, at most 500 characters, no user info). They win over `HERMES_WEBHOOK_URL` and `WARDEN_URL` in `.env`. A bad URL in the file is ignored. `settings.json` is in the top directory of the state, which the agent cannot write. The button "Send test message" writes `requests/notify-test.json`. The runner calls `bin/notify.sh "warden test message"` and writes `notify-test.json` with `ok`, `status` (HTTP code, `none`, `nosecret` or `000`) and `at`. It never stores the answer body or an error text. The settings `reject_days` and `stale_days` are on the page Limits.
  - A value must be one line of 8 to 500 characters with no space.
  - Check: `GH_TOKEN` is tried with `gh repo view` for each project repository. A `POSTHOG_API_KEY_X` is tried with a GET of the PostHog project of each project that uses it. The other keys get a format check only.
  - A valid value goes to `/secrets/overrides.env` (mode 600). `run-scout.sh` and `submit-approved.sh` load this file before they scan for secrets.
  - `/inbox/status.json`: writer: the runner. Content: `{"<KEY>": {"source": "env"|"ui"|"unset", "state": "ok"|"invalid"|"error"|null, "detail": string|null, "updated_at": "..."}}`. It never holds a value.
- `/inbox/discovery.json`: writer: the runner (atomic), every 15 minutes and at once when `/inbox/discover.request` exists (the runner deletes that file). Content: `{"updated_at", "github": {"ok", "login", "detail"}, "posthog": [{"key_env", "source": "env"|"ui", "ok", "detail", "region", "projects": [{"id", "name", "org_id", "org_name"}]}], "sentry": {"ok", "detail", "projects": [{"org", "slug", "name", "platform"}]} | null}`. It never holds a key value.
- `/inbox/project-status.json`: writer: the runner. Content: `{"<name>": {"hash", "repo_ok", "posthog_ok", "sentry_ok" (null without Sentry), "detail", "checked_at"}}`. The runner checks a project again when it has no entry or when the hash of its config changed.
- Tests. Two volumes. `tests-in`: the runner writes, the tester reads (read-only). `tests-out`: the tester writes, the runner and the UI read (read-only). The UI sets `TESTS_ROOT=/tests-out` and reads `$TESTS_ROOT/results/<project>/<id>.json`.
  - The runner prepares `/tests-in/work/<project>/<id>/` and the queue file `/tests-in/queue/<project>__<id>.json`. The runner never writes into `tests-out`.
  - The tester copies the work directory to its own tmpfs, runs the command, writes the result, and then writes the marker `/tests-out/done/<project>__<id>`. The runner removes the queue file and the work directory when the marker exists. The runner never follows a symlink.
  - A result with the status `queued` appears when the tester sees the queue file. A job that the runner could not prepare (`skipped`, `error`) carries a `preset` in the queue file, and the tester writes the result.
  - The tester writes `/tests-out/results/<project>/<id>.json`: `{"status": "queued"|"running"|"pass"|"fail"|"error"|"skipped", "reason", "command", "started", "ended", "exit_code", "output_tail"}`. `output_tail` has the last 200 lines, at most 20000 characters. Treat it as untrusted text.
  - `<id>` is the id of the pending item. A project without `test_command` gets no result.
- `running/<project>__<scout>.json`: exists while a run is active. Writer: `run-scout.sh`, which removes it on exit. `run-all.sh` deletes stale files at start. Fields: `id`, `project`, `scout`, `started`, `mode`.
- `requests/<project>__<scout>.json`: a run-now request. Writer: the UI. Field: `requested_at`. `run-all.sh` checks the pair against `projects.json`, deletes the file, and runs the pair. A pair that is running keeps its request. A bad request is deleted without a run.
- `settings.json`: writer: the UI. `.projects.<name>.mode` (`dry`, `issues` or `prs`) overrides the environment variable `MODE` for that project. A missing or invalid value gives `MODE`, then `dry`. `.projects.<name>.auto_submit` is the auto-submit toggle.
- `<project>/pending/<id>/meta.json`: an item that waits for approval. Writers: `run-scout.sh` (create), the UI (`status`, optional `reject_reason`), `submit-approved.sh` (`status`, `url`, `error`). The id is the fingerprint for an issue and a PR. For a comment it is `<fingerprint>-<UTC yyyymmddHHMM>`. For a `pr-update` it is `<fingerprint>-<first 7 characters of base_sha>`.
  - Kinds: `issue`, `comment`, `pr`, `pr-update`.
  - For `issue` and `comment`, `body` has no footer. The field `footer` holds the exact text that the runner appends at submit time (in `submit-approved.sh` and in the auto path). The runner does not append it again if the body already holds the marker `<!-- warden:fp=... -->`. An older item has no `footer` field.
  - The UI can change `title` and `body` of a pending item. It sets `edited_at`.
  - `pr-update`: `number` is the PR number, `base_sha` is the head sha of the PR at run time. The item has `bundle` and `patch.diff`. The submit step pushes only when the remote branch head still equals `base_sha`. It never forces.
  - `gh_state` (`open`, `closed` or `merged`), `gh_state_reason` (for example `not_planned`), `gh_state_at`, `synced_at`: written by `sync-github.sh` for a `submitted` item, at most each 10 minutes. A comment item holds the state of its parent issue. The field `status` does not change.
  - `status: submitting`: the write to GitHub is in progress. A pass finds an item in `submitting` only after a crash. It sets `error` ("Interrupted during submit. Check GitHub before you retry.") and does not retry.
  - `feedback_recorded: true`: the runner wrote the rejection into the scratchpad of the scout (`- <date> REJECTED <fingerprint> "<title>": <reason>`).

## Dashboard and PR approval

The `ui` service is a web app (TanStack Start). The source is in `app/`. It listens on port 8650.
It reads `/state` and `projects.json`. It shows the overview, the review queue, the findings, the runs and the project settings.

- Set `WARDEN_PASSWORD` in `.env`. Without it, the UI answers 503 on all routes except `/health`.
- The user name is `WARDEN_USER` (default `admin`). The login form is at `/login`.
- The session cookie lasts 30 days. `WARDEN_SESSION_SECRET` is the signing key. If it is not set, the key comes from `WARDEN_PASSWORD`.
- The UI shows the default mode from `MODE`, and the next pass from `INTERVAL_HOURS`.
- A mutation needs an `Origin` header with the same host as the `Host` header. The proxy must forward `Host` and `X-Forwarded-Proto`.
- "Run now" writes `/state/requests/<project>__<scout>.json`. The runner starts the scout.

Run the UI on this computer:

```sh
cd app && bun install && STATE_ROOT=/path/to/state PROJECTS_FILE=../projects.example.json WARDEN_PASSWORD=<password> bun run dev
```

Nothing leaves warden without approval, unless the project has "Auto-submit" on.
Issues, comments and PRs all wait on the page "Review" of the UI.
The script saves each item as `/state/<project>/pending/<id>/meta.json`. It does not write to GitHub.
The item has the final text, so the text that you approve is the text that GitHub gets.
A PR item also holds a bundle and a diff. The script does not push.
The id is the fingerprint for an issue and a PR. For a comment it is `<fingerprint>-<UTC yyyymmddHHMM>`.
The script sends one notification for each run that has new items.

`bin/submit-approved.sh` runs every minute in the loop. It scans the item for secrets again.
Then it creates the issue, adds the comment, or pushes and opens the draft PR, for each approved item.
The item gets the status `submitted` with a URL, or `error`. A rejected item keeps its `meta.json`.
Only the runner has the GitHub token.

The toggle "Auto-submit" of a project writes `auto_submit` in `/state/settings.json`.
The old key `auto_submit_prs` still works. The default is off.
With the toggle on, issues, comments and PRs go to GitHub at once.
A new item is not saved when an item with the same fingerprint waits (`pending`, `approved`, `submitting`, `error`).
A rejected item blocks its fingerprint for `reject_days` days (`settings.json`, default 30). The age counts from the change time of `meta.json`.
A pending item older than `stale_days` (`settings.json`, default 30, editable on the Settings page) gets the status `stale`. `submit-approved.sh` sets it and removes the bundle and the patch. The age counts from the `created` field of `meta.json`, then from the UTC stamp in the item id, then from the mtime of the item directory. A stale item cannot be approved and does not block a new item. Its `meta.json` stays.
A submitted issue or PR blocks while `gh_state` is `open` or missing. After it closes, the scout can propose again.
A submitted comment blocks while the issue has our marker comment and no newer comment from another person.
The auto-submit mode checks the same rule on GitHub before it posts a comment.

## Agent user and permissions

The agent (claude) runs as the user `agent` (uid 1001), not as the runner. The runner starts it with
`sudo -u agent /app/bin/agent-exec.sh`. The sudoers file allows this command and one more: `/app/bin/agent-unlock.sh <dir>`.
The second script makes the agent's files group-writable, so the runner can remove a directory with mode 700 that the agent made. It accepts only a real path under `/state/<project>/<scout>` or `/work/<project>`. Root owns `agent-exec.sh`, `/app` and `/app/skills`.
The model credentials go to the agent by `sudo --preserve-env`, never on the command line.

- `/secrets`, `/inbox`: mode 0700, owner runner. `/state` and `/work` are 0710 with the group `wardenwork`: the agent can pass through, not list.
- A checkout that is not in use is 0700. The checkout of a run and the state directory of the scout get the group `wardenwork` with mode 2770. `.git` is not writable for the group.
- The MCP config and the settings file are in `/run/warden/<run>/` (mode 0750, files 0640, group `wardenwork`).
- `tests-in` is world-readable, because the tester (also uid 1001) reads it. It holds only PR sources.
- `test/probe.sh` checks this with the real claude.

## Sentry (not tested)

The code for this part is not tested against a real Sentry.
Add `"sentry": {"org": "<org>", "project": "<project>"}` to a project in `projects.json`, and set `SENTRY_TOKEN`.
`run-scout.sh` then adds the server `https://mcp.sentry.dev/mcp/<org>/<project>` to the MCP config of the run
(header `Authorization: Sentry-Bearer <token>`) and allows `mcp__sentry__*`. There is no Sentry scout yet.

## Cost cap

Set `daily_cost_cap_usd` in `settings.json`. When the cost of today's runs (UTC) reaches the cap, a run is recorded as `skipped` and claude does not start.
The runner sends one notification each day.

## Test jobs for pull requests

A project with `test_command` in `projects.json` gets a test job for each saved `pr` and `pr-update` item.
The runner clones the checkout at `base_sha`, runs `test_install` (default `bun install --frozen-lockfile --ignore-scripts`, with network, 10 minutes), and applies the change.
It refuses the job (result `skipped`) when the diff touches `package.json`, a lockfile, `bunfig.toml`, `.npmrc` or `.github/`.
The `tester` service runs `test_command` (10 minutes) with no network, no secrets, 2 GB of memory and one CPU. It sees only the volume `tests`.
Set `test_command` to a command that passes on the base commit with no network.

## CI follow-up (scout `warden-ci`)

The script lists the open pull requests whose branch starts with `warden/`. It reads the failed checks, the tail of the failed log, and the comments of the owner, members and collaborators.
It starts claude only when a PR has a new failed check or a new allowed comment (`<project>/warden-ci.seen.json` in the state folder remembers what was handled; the agent cannot change it).
The agent returns a `comment`, or a `pr-update` (a commit on the branch of the PR).
`submit-approved.sh` pushes a `pr-update` only when the remote branch still has `base_sha`. It never forces.

## Checks

Run `bin/test-notify.sh` to test the webhook signature.

Run the shell tests inside the image, because the image has an older `jq` than the host:

```sh
podman run --rm -v "$PWD":/src:Z -w /src warden bash test/gate.sh
podman run --rm -v "$PWD":/src:Z -w /src warden bash test/issues.sh
```

Run `bun run typecheck` and `bun test src` in `app/` for the UI checks.

More shell tests (run them in the image the same way): `test/inbox.sh` (live projects file, secrets inbox, discovery, project check), `test/ci.sh` (warden-ci), `test/tester.sh` (test jobs), `test/sync.sh` (GitHub state sync).
`test/agent-perm.sh` needs root: `podman run --rm -u 0 -v "$PWD":/src:Z -w /src warden bash test/agent-perm.sh`.
`test/tester-net.sh` runs on the host. It starts the tester in a container with `--network none`.
`bin/test-notify.sh` checks the webhook signer against a fixed vector.
