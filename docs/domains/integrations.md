# Integrations

The page Settings, Integrations lists them. The list is `app/src/lib/integrations.ts`. Coolify and Hermes have their own pages: `coolify.md`, `notifications.md`.
For key handling, read `secrets.md`.

## GitHub

- Secret: `GH_TOKEN`. It must read and write issues and pull requests on every project repository.
- The runner calls `gh auth setup-git` for fetch and push. The agent has no `GH_TOKEN`, so it cannot use `gh`.
- The label `warden` marks the issues and PRs of warden. The runner creates it with `--force`.
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` and the committer variables set the commit identity. The default is `warden` and `warden@localhost`.
- Issue filters for `github-issues` come from `issue_authors` of the project (default `OWNER`, `MEMBER`, `COLLABORATOR`).

## Claude

- Secrets: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), or `ANTHROPIC_AUTH_TOKEN` with `ANTHROPIC_BASE_URL` and an empty `ANTHROPIC_API_KEY` (for example OpenRouter), or `ANTHROPIC_API_KEY`.
- `CLAUDE_MODEL` (default `sonnet`) and `MAX_TURNS` (default 60) go to the agent command.
- The cost of a run comes from `total_cost_usd` in the JSON output of `claude`. The daily cap uses it. See `state.md`.

## PostHog data

- One personal API key for each PostHog account or project, with the "MCP Server" preset. The key name is `POSTHOG_API_KEY_<NAME>`.
- A project names its key in `posthog_key_env` and its PostHog project in `posthog_project_id`. `posthog_region` is `eu` (default) or `us`. It sets the API host for checks (`<region>.posthog.com`). The MCP URL is `https://mcp.posthog.com/mcp` (`POSTHOG_MCP_URL` can change it).
- The MCP config of a run is `/run/warden/<run>/mcp.json`. It has the key as a bearer header, `x-posthog-read-only: true` and `x-posthog-project-id`. The agent cannot read the file.
- A project with `posthog_project_id` set to `TODO` fails the run.
- `discover.sh` writes `/inbox/discovery.json`: what the keys can reach (GitHub login, PostHog projects, Sentry projects, Coolify apps). The runner writes it each 15 minutes, and at once when `/inbox/discover.request` exists. The UI project form reads it.
- `discover.sh` also writes `/inbox/project-status.json`: for each project `{hash, repo_ok, posthog_ok, sentry_ok, detail, checked_at}`. The runner checks a project again when it has no entry, when the hash of its config changed, or when the last check failed and is older than 15 minutes.

## Sentry (not tested)

The code is not tested against a real Sentry.

- Add `"sentry": {"org": "<org>", "project": "<project>"}` to a project and set `SENTRY_TOKEN`.
- `run-scout.sh` adds the server `https://mcp.sentry.dev/mcp/<org>/<project>` to the MCP config (header `Authorization: Sentry-Bearer <token>`) and allows `mcp__sentry__*`.
- No scout uses Sentry data yet.

## PostHog events about warden

- Set `WARDEN_POSTHOG_TOKEN` (a project token, `phc_...`) and optionally `WARDEN_POSTHOG_HOST` (default `https://eu.i.posthog.com`). Without the token nothing is sent.
- Events:
  - `warden scout run`: `project`, `scout`, `status`, `exit_code`, `cost_usd`, `duration_s`, `items_created`.
  - `warden item created`: `project`, `scout`, `item_id`, `kind`.
  - `warden item status changed`: `project`, `scout`, `item_id`, `kind`, `old_status`, `new_status`.
- Properties hold ids, statuses and numbers only. No title, body, URL or error text.
- The distinct id is `warden-<hostname>`. There is no person profile.
- `ph_capture` never fails a run. The token goes through the environment of `jq`, and the body goes through stdin.
- The runner sends the events. The UI writes the statuses `approved` and `rejected`, so the runner reports `rejected` when it records the feedback.
- The agent does not get the token.
