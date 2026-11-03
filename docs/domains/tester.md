# Tester

A project with `test_command` in `projects.json` gets a test job for each saved `pr` and `pr-update` item.
The job runs the tests of the agent's change with no network, no secrets and no state.
Code: `bin/prep-test.sh` (runner side), `bin/tester.sh` (tester side), `tests_gc` and `safe_rm` in `bin/lib.sh`.
Tests: `test/tester.sh`, and `test/tester-net.sh` on the host.

## Two volumes

- `tests-in`: the runner writes, the tester reads (read-only mount).
- `tests-out`: the tester writes. The runner and the UI read it (read-only mounts). The runner never writes into `tests-out`.
- The UI reads `$TESTS_ROOT/results/<project>/<id>.json` (`TESTS_ROOT=/tests-out`). `<id>` is the id of the pending item.
- The service `tester` in `compose.yaml`: `network_mode: none`, 2 GB of memory, 1 CPU, 512 processes, user 1001, read-only root, all capabilities dropped, `no-new-privileges`, a 1 GB tmpfs on `/tmp`.

## Steps

1. `prep-test.sh <project> <id> <checkout> <pending-dir>` runs after the runner saves the item. It exits 0 with no job when the project has no `test_command`.
2. It clones the checkout to `/tests-in/work/<project>/<id>/repo`, checks out `base_sha`, and fetches the bundle.
3. It refuses the job (result `skipped`) when the diff touches `package.json`, a lockfile (`bun.lock`, `bun.lockb`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`), `bunfig.toml`, `.npmrc` or `.github/`. The install step could run code from such a change.
4. It runs `test_install` with network, in an empty `HOME`, with `env -i` and a 10 minute limit. The default is `bun install --frozen-lockfile --ignore-scripts`. It runs on the base commit, before the change is applied. A failure gives the result `error` ("install failed").
5. It checks out the tip of the bundle and writes the queue file `/tests-in/queue/<project>__<id>.json`: `{project, id, command}`. A job that cannot run carries a `preset` result (`skipped` or `error`, a reason, an output tail).
6. The tester loop sleeps 10 seconds between checks. It writes a `queued` result for each queue file that has no result.
7. It takes the oldest queue file with no `done` marker. It copies the work directory to `/tmp`, runs `test_command` with `env -i` and a 10 minute limit, and writes the result.
8. It writes the marker `/tests-out/done/<project>__<id>`. The runner then removes the queue file and the work directory (`tests_gc`). A queue file that is newer than its marker is a new job with the same id, so it stays.

## Result file

`{"status", "reason", "command", "started", "ended", "exit_code", "output_tail"}`.

- `status`: `queued`, `running`, `pass`, `fail`, `error` or `skipped`.
- Exit code 0 is `pass`. 124 is `error` ("timed out after 600 s"). 125 is `error` (the copy failed). Another code is `fail`.
- `output_tail` holds the last 200 lines, at most 20000 characters. It is untrusted text. The UI keeps only known fields and cuts the output.
- A project with no `test_command` has no result.

## node_modules symlink

`node_modules` is large. The tester does not copy it. It copies the tree without `repo/node_modules` and makes a symlink to `/tests-in/work/<project>/<id>/repo/node_modules`.

- The target is in a read-only volume. A test cannot write inside `node_modules`, for example a cache there.
- A tool that needs `node_modules` to be a real directory in the project can fail.
- Write `test_command` so that it works with no network and with this limit. It must pass on the base commit.

## Safety rules

- The runner never follows a symlink under `tests-in`. `safe_rm` refuses a symlink in the path or in a parent below the root. `tests_gc` deletes a symlink queue file and a bad name.
- The tester ignores a queue file that is a symlink or has a bad name. It fails a job whose work directory or `repo` is a symlink.
- Names must match `^[a-z0-9][a-z0-9-]*$`.
- The tester uses `umask 022`, because the UI reads `tests-out` as another user.
