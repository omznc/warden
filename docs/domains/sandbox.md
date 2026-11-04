# Agent sandbox

The agent is the Claude process that a scout starts. It reads untrusted text, so the runner gives it the smallest set of rights.
The code is in `bin/lib.sh`, `bin/agent-exec.sh`, `bin/agent-unlock.sh` and the `Containerfile`.

## The two users

- The runner runs as the user `runner` (uid 1000). The agent runs as the user `agent` (uid 1001).
- Both users are in the group `wardenwork`. The group gives the agent access to one checkout and one state directory, and nothing more.
- Root owns `/app`. Nobody can change the scripts at run time.
- The runner starts the agent with `sudo -n -u agent --preserve-env=<names> /app/bin/agent-exec.sh <claude args>`.
- The sudoers file (`/etc/sudoers.d/warden`) allows two commands for the runner:
  - `/app/bin/agent-exec.sh`, with `SETENV`.
  - `/app/bin/agent-unlock.sh *`, with `env_reset`.
- Do not add a command to the sudoers file. Do not widen the arguments.

## agent-exec.sh

- It sets `umask 007`, so the files of the agent are private to the user and the group.
- It starts `claude` with `env -i`. The environment holds `HOME=/home/agent`, `PATH`, `LANG` and `TERM`.
- It adds only these variables, when they are set: `STATE_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`.
- `sudo --preserve-env` carries the values by name. No secret is in an argument list, which every process can read in `/proc`.
- The agent never gets `GH_TOKEN`, a PostHog key, the webhook secret or a Coolify token.
- `agent_build` in `lib.sh` builds the command. Without isolation (`WARDEN_NO_AGENT_USER=1`, or no `/app/bin/agent-exec.sh`), it uses `env -i` with the same list and no `sudo`. The tests with a stub `claude` use this path.

## agent-unlock.sh

The agent can make a directory with mode 700. The runner is not the owner, so `rm -rf` would fail on it.
The runner calls `agent-unlock.sh <dir>` as the user `agent`. The script gives the group write access to the files of the agent.

- The argument must be a real directory, not a symlink, and `realpath` must equal the argument.
- The path must match `/state/<project>/<scout>` or `/work/<project>`, with optional sub-paths.
- It changes only files that the user `agent` owns (`find -P -user`). It skips symlinks.
- It changes the directories first, one at a time, because `find` must enter a directory before it reads it.
- It skips `<dir>/.git`. The agent cannot write there. Git makes new directories in `.git` with mode 750 for the runner group, so the agent cannot enter them and `find` would fail the run.

## Modes and groups

| Path | Mode and owner |
|---|---|
| `/secrets`, `/inbox` | 0700, runner |
| `/state`, `/work`, `/run/warden` | 0710, runner:wardenwork. The agent can pass through, not list. |
| `/state/<project>` | 0710 wardenwork. Each scout directory inside is 0700 until its run. |
| Checkout of a run, state directory of the scout | 2770, group wardenwork |
| `.git` of the checkout | not group-writable. The checkout has the sticky bit. |
| Checkout that is not in use | 0700 |
| `/run/warden/<run>/` (MCP config, settings) | 0750 directory, 0640 files, group wardenwork |
| `/tests-in` | world-readable, because the tester (uid 1001) reads it. It holds only PR sources. |
| `/home/runner`, `/home/agent` | 0700 |

## Helpers in lib.sh

- `umask 027` at the top. A shell from `docker exec` has umask 0000. The UI runs as the same uid as the runner, so it still reads the files. The tester and `prep-test.sh` set `umask 022`.
- `gitc`: git for a checkout that the agent could change. It turns off hooks and `fsmonitor`, and it accepts any directory owner (`safe.directory=*`). Use `gitc` for every git call on a checkout.
- `agent_prepare <project> <state> <checkout>`: close `/state/<project>`, then grant the agent the scout directory and the checkout (without `.git`).
- `agent_grant`, `agent_share`, `lock_checkout`: change the group and the modes. The runner changes only the files that it owns.
- `agent_reclaim <state> <checkout>`: open the directories again and run the unlock. Call it before the runner changes or removes anything in them.
- `put_file <src> <dest>`: copy a file into a path that the agent can write. It removes the destination first, because the agent can leave a symlink or a directory there.
- `ensure_file <file>`: make a regular file. It replaces a symlink or another entry.
- These helpers are safe only while the agent does not run. `run-scout.sh` holds `checkout-<project>.lock` for the whole run. A different script (`submit-approved.sh`) writes in a scout directory or the checkout only while it holds that lock.
- `strip_world_write`: remove the world-write bit below a directory.
- `harden_dirs [--quick]`: set the modes of `/secrets`, `/inbox`, `/state` and `/work`, and close each idle checkout. `run-all.sh` runs the full walk once and the quick form in each loop.
- `agent_sandbox_dir`: make `/run/warden/<run>/`. `run-scout.sh` removes it at the end of the run.

## What the agent may do

- Allowed tools: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `mcp__posthog__*`, and `Bash` for `git status`, `git diff`, `git log`, `git show` and `ls` only. A project with Sentry adds `mcp__sentry__*`.
- Denied: `git push`, `gh`, `curl`, `wget`, `WebFetch`, `WebSearch`, and the git flags `--no-index`, `--output`, `--ext-diff` and `--textconv`.
- The permission mode is `acceptEdits`. `--max-turns` is `MAX_TURNS` (default 60). The model is `CLAUDE_MODEL` (default `sonnet`).
- `agent_settings` writes the settings file with Read and Edit denies for: `/proc`, `/run/warden`, `/secrets`, `/inbox`, `/tests-in`, `/tests-out`, `/tests`, `/app/bin`, the sandbox directory, `/home/runner`, and the Claude config of the agent and the runner. It also denies Edit on `.git` and `.github` of the checkout. A path that starts with `//` is an absolute path.
- The PostHog MCP server gets the header `x-posthog-read-only: true`.

## Checks after the run

- `run-scout.sh` hashes `.git/config` and `.git/hooks` before and after the run. A change removes the checkout and fails the run.
- The runner reads the output of the agent as text. It takes the JSON from the first `{` to the last `}`.
- The runner decides from its own data. The copies that the agent gets (`issues.json`, `prs.json`, the Coolify data) are not read back.

## Tests

- `test/agent-perm.sh` makes real files of both users. It needs root: `podman run --rm -u 0 -v "$PWD":/src:Z -w /src warden bash test/agent-perm.sh`.
- `test/probe.sh` runs the real `claude` through `sudo`. It needs a real token, so CI does not run it.
