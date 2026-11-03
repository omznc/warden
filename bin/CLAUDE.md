# bin/ - the runner

These Bash scripts are the runner. They run as the user `runner` in the container `warden-runner`, except `tester.sh`, which runs in the container `warden-tester`.
The agent (Claude) never runs these scripts. The scripts start the agent and read its output as untrusted text.
Read `docs/domains/sandbox.md` before you change any trust boundary.

## Scripts

| File | Job |
|---|---|
| `lib.sh` | Shared helpers. Source it. It holds the sandbox, safe git, the secret scan, projects, URLs and the test helpers. |
| `run-all.sh` | The loop and the scheduler. `ONCE=1` or two arguments run one pass. |
| `run-scout.sh` | One scout on one project. Makes findings into items or writes to GitHub. |
| `submit-approved.sh` | Writes approved items to GitHub. See `docs/domains/submit.md`. |
| `sync-github.sh` | Reads the GitHub state of submitted items. |
| `inbox.sh` | Reads the secrets inbox. See `docs/domains/secrets.md`. |
| `discover.sh` | Writes `discovery.json` and `project-status.json` in the inbox. |
| `coolify.sh` | Helpers for the `coolify` scout and the inbox check. Source it after `lib.sh`. See `docs/domains/coolify.md`. |
| `notify.sh`, `weekly.sh`, `test-notify.sh` | Notices. See `docs/domains/notifications.md`. |
| `prep-test.sh`, `tester.sh` | Test jobs. See `docs/domains/tester.md`. |
| `agent-exec.sh`, `agent-unlock.sh` | Run by `sudo` as the user `agent`. Root owns them. |
| `upstream-diff.sh` | Compares the PostHog scouts with upstream. Run it on a development computer. See `skills/CLAUDE.md`. |

## Order of work

`run-all.sh` loop, each chunk (about 60 seconds):

1. `harden_dirs --quick`
2. `inbox.sh`
3. `discover.sh`
4. `submit-approved.sh`
5. `tests_gc`
6. `sync-github.sh` (at most each 10 minutes, stamp `last-sync`)
7. `handle_requests` (run-now requests and the test message)
8. `weekly.sh` (at most each 7 days, stamp `last-weekly`)
9. A pass, when `INTERVAL_HOURS` has passed (stamp `last-run`).

A pass runs each enabled project and scout in turn. After each run it calls `submit-approved.sh` and `handle_requests`. At the end it calls `pass_alarm`.

`run-scout.sh` order:

1. Load `overrides.env`. Find the mode. Check the daily cost cap.
2. Check the project, the PostHog key and the skill.
3. Give the directories back to the runner (`agent_reclaim`). Reset the checkout to the default branch.
4. Read the open issues, PRs and branches of warden (the dedup lists).
5. Prepare the input of the scout (`github-issues`, `warden-ci`, `coolify`).
6. Write the MCP config, the settings and the system prompt (`prompts/harness.md`, the run context, the skill).
7. `agent_prepare`, then run the agent. Compare the hash of `.git/config` and `.git/hooks`.
8. Read the JSON. Handle each finding: scan, dedup, then item or write.
9. Mark the seen files. Send notices.
10. The `EXIT` trap writes the run record and the event, removes the temp files, closes the checkout and calls `health_record`.

## Rules

- Use `#!/usr/bin/env bash`, tabs, and `shellcheck` clean code. CI runs `shellcheck` on `bin/*.sh` and `test/*.sh`. A `disable` needs a reason on the line above.
- Check each name (project, scout, fingerprint, id) against `^[a-z0-9][a-z0-9-]*$` before you use them in a path or a command.
- The runner trusts only: its own files, the allowlisted inbox, `projects.json` after `projects_json` checks it, and `settings.json` after a type check. Files in `/state/<project>/<scout>/` belong to the agent. Never trust them.
- The agent gets copies. Keep the trusted copy in `$tmp` and compare with it (see `issues.json` in `run-scout.sh`).
- Put the files that the runner must trust where the agent cannot write: the top of `/state` or `/state/<project>` (the seen files, `ledger.json`).
- Run git on a checkout through `gitc`. Run `gh` only in the runner, never in the agent.
- Never put a secret in an argument list. Use stdin or the environment of a subshell. See `ph_get`, `coolify_get`, `ph_capture`.
- Write a file by a temp file and `mv`. Write `meta.json` last when you make an item.
- Add `</dev/null` to `claude` and `gh` inside a `while read` loop. They read stdin and eat the rest of the list.
- A notice and an event must not fail a run. End them with `|| true`.
- `WARDEN_NO_AGENT_USER=1` turns off the user split for tests with a stub `claude`. Never set it in a deployment.
- A change to what the agent can read, write or run needs a change in `docs/domains/sandbox.md` and a run of `test/agent-perm.sh`.
- A change to a state file needs a change in `docs/domains/state.md`, and in `app/src/server/` if the UI reads or writes it.

## Test

Run the shell test that matches your change in the image. See the root `CLAUDE.md` for the commands and the list.
