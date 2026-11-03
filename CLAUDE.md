# CLAUDE.md

This file gives guidance to coding agents that work in this repository.
This file is the always-loaded half. The rest is split, so a task pays only for what it touches. See "Where the rest lives".

Warden runs headless Claude Code on a schedule. Each run uses one scout (a skill) on one project.
The agent reads PostHog data (read-only) and a repository checkout, and returns findings as JSON.
The scripts, not the agent, open GitHub issues, comments and draft pull requests. A person approves each item in the UI first, unless the project has "Auto-submit" on.

This repository is public. Write no personal name, host name, domain, project id or secret in a file, a commit or an issue.

## Commands

Build and run the stack (use `podman compose`, or `docker compose`):

```sh
podman build -f Containerfile -t warden .          # the runner image
podman compose up -d --build                       # runner, tester and ui
podman compose run --rm -e ONCE=1 runner bin/run-all.sh <project> <scout>   # one scout, one time
```

Shell tests run inside the image, because the image has `jq` 1.6 and the host has a newer one:

```sh
podman run --rm -v "$PWD":/src:Z -w /src warden bash test/gate.sh
podman run --rm -u 0 -v "$PWD":/src:Z -w /src warden bash test/agent-perm.sh   # needs root
podman run --rm -v "$PWD":/src:Z -w /src warden bash bin/test-notify.sh         # signature vector
bash test/tester-net.sh                                                         # on the host, needs podman
```

- CI runs these tests in the image: `gate`, `issues`, `requests`, `ci`, `inbox`, `tester`, `sync`, `ops`, `upstream-diff`, `hermes`, `coolify`. Run the one that matches your change.
- `test/probe.sh` needs a real Claude token. CI does not run it.
- Every test uses stub `gh`, `claude` and `curl`. No test uses the network, except `probe.sh`.
- Shellcheck (CI runs it on `bin/*.sh` and `test/*.sh`):

```sh
podman run --rm -v "$PWD":/src:Z -w /src docker.io/koalaman/shellcheck:stable bin/*.sh test/*.sh
```

The app (run in `app/`, with `bun`):

```sh
bun install
bun run typecheck      # tsc --noEmit
bun run test           # bun test src
bun run build          # vite build
bun run dev            # vite dev on port 8650
```

Run the UI on this computer against a temporary state:

```sh
cd app && STATE_ROOT=$(mktemp -d) INBOX_ROOT=$(mktemp -d) TESTS_ROOT=$(mktemp -d) \
  PROJECTS_FILE=../projects.example.json WARDEN_PASSWORD=dev bun run dev
```

Open `http://127.0.0.1:8650`. The user name is `admin`. Without `WARDEN_PASSWORD` every route except `/health` answers 503.

## Architecture

- `bin/`: the runner. Bash scripts. `run-all.sh` is the loop. `run-scout.sh` runs one scout. See `bin/CLAUDE.md`.
- `prompts/harness.md`: the system prompt of every scout run.
- `skills/`: the scouts. See `skills/CLAUDE.md`.
- `app/`: the web UI (TanStack Start, Bun). See `app/CLAUDE.md`.
- `test/`: Bash tests. `compose.yaml`, `Containerfile`, `app/Containerfile`: the deployment.

Two users in the runner image:

- `runner` (uid 1000) holds all secrets and writes to GitHub.
- `agent` (uid 1001) runs `claude` through `sudo` and `bin/agent-exec.sh` with `env -i`. It gets its model credential only. It shares the group `wardenwork` with the runner.

Three containers:

- `runner`: the loop. It mounts every volume (`tests-out` read-only). It reads the whole `.env`.
- `tester`: runs the tests of a PR with no network, no secrets and no state. It runs as uid 1001.
- `ui`: the web app on `127.0.0.1:8650`. It has no token.

Volumes: `state` (runner, ui), `work` (runner), `inbox` (runner, ui), `secrets` (runner only), `tests-in` (runner writes, tester reads), `tests-out` (tester writes, runner and ui read).

Data flow: a scout returns a finding. The runner saves `pending/<id>/meta.json`. A person approves it in the UI. Then `submit-approved.sh` writes the issue, the comment or the draft PR to GitHub.

## Where the rest lives

A subsystem with a long description lives in `docs/domains/`. Read the file you need before you change the code.

| Read this | Before you touch |
|---|---|
| `docs/domains/sandbox.md` | the agent user, `env -i`, sudoers, `agent-exec.sh`, `agent-unlock.sh`, modes, permission denies, `put_file`, `harden_dirs` |
| `docs/domains/items.md` | pending items, statuses, fingerprints, dedup, modes, auto-submit, stale and rejected items |
| `docs/domains/submit.md` | `submit-approved.sh`, the GitHub write, bundles, `pr-update` |
| `docs/domains/warden-ci.md` | the scout `warden-ci`, seen keys, the conflict merge, idle PRs |
| `docs/domains/tester.md` | `prep-test.sh`, `tester.sh`, the test volumes, `test_command` |
| `docs/domains/secrets.md` | the inbox, `overrides.env`, allowed keys, `secret_hit`, `scrub_secrets` |
| `docs/domains/notifications.md` | `notify.sh`, Hermes, `health.json`, the weekly summary, the test message |
| `docs/domains/integrations.md` | GitHub, Claude, PostHog keys, Sentry, PostHog events, discovery |
| `docs/domains/coolify.md` | `bin/coolify.sh`, the scout `coolify`, Coolify settings and tokens |
| `docs/domains/state.md` | any file in `/state`, `projects.json`, `settings.json`, `runs.jsonl`, requests, the cost cap |
| `docs/domains/deployment.md` | `compose.yaml`, the `Containerfile`, volumes, a proxy, upgrades |

## Rules that survive the split

These rules are load-bearing everywhere. The reason for each is in the file beside it.

- The agent never gets a secret. It starts with `env -i` and a fixed list of model variables. Do not add a variable to that list. (reason: `docs/domains/sandbox.md`)
- Nothing reaches GitHub without approval, unless the project has auto-submit on. Only the runner writes to GitHub. (reason: `docs/domains/items.md`)
- The agent output is untrusted. The runner decides from its own data and keeps the trusted copy of each input. (reason: `bin/CLAUDE.md`)
- A scan for secrets runs before the runner saves an item and again before each GitHub write. A hit blocks the write. (reason: `docs/domains/secrets.md`)
- Never force-push. A `pr-update` goes out only when the remote branch still equals `base_sha`. (reason: `docs/domains/submit.md`)
- Use `gitc` for git on a checkout. Check each name against `^[a-z0-9][a-z0-9-]*$` before it goes into a path. (reason: `bin/CLAUDE.md`)
- A secret value never goes into an argument list, a log, a status file or a notice. (reason: `docs/domains/secrets.md`)
- The UI writes `meta.json` only through `writeMetaChecked`, and `settings.json` only through `mergeSettings`. (reason: `app/CLAUDE.md`)
- A change of a secret, a URL or a Coolify instance in the UI needs the password. (reason: `app/CLAUDE.md`)
- The files `skills/signals-scout-*` are verbatim copies from PostHog. Do not edit them. (reason: `skills/CLAUDE.md`)
- A file that the runner trusts must be where the agent cannot write. Files in `/state/<project>/<scout>/` belong to the agent. (reason: `docs/domains/state.md`)
- The tester has no network, no secrets and no state. (reason: `docs/domains/tester.md`)
- Write all prose in ASD-STE100 Simplified Technical English: short sentences, active voice, no contractions. Keep the tests, the docs and the comments in the same style.

## Gotchas

- The `jq` in the image is 1.6. A `jq` feature from a newer version can pass on the host and fail in CI. Test in the image.
- A shell from `docker exec` has umask 0000. `lib.sh` sets `umask 027`, `prep-test.sh` and `tester.sh` set 022. Do not remove them.
- `claude` and `gh` read stdin. Inside a `while read` loop, add `</dev/null`.
- `app/src/routeTree.gen.ts` is generated. Do not edit it by hand.
- The UI must read the files that the runner writes (umask 027). Keep the two containers on the same uid.
- The Sentry code and the Coolify API facts are checked against fixed answers, not a live service. See `docs/domains/integrations.md` and `docs/domains/coolify.md`.
- `README.md` is the overview for people. Keep the details in `docs/domains/`.
- Do not commit `.env`, `projects.json` or `compose.override.yaml`. They are local.

## Agent skills

### Issue tracker

Issues live in the GitHub Issues of this repository, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.
