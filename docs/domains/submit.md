# Submit

`bin/submit-approved.sh` writes the approved items to GitHub. Only the runner has the GitHub token, so only the runner writes.
`run-all.sh` starts the script in four places: a background loop (each 15 seconds), each loop chunk (about each minute), and after each scout run in a pass.
Read `items.md` for the item statuses.

## Lock

The script takes a non-blocking lock (`flock -n`) on `$STATE_ROOT/submit.lock` at the start. A second caller exits at once with no work. Two callers then never send the same item.
The lock file is in the top of the state, where the agent cannot write.

## Background loop

In loop mode, `run-all.sh` starts `submit_loop`. It calls the script each 15 seconds for the whole life of the loop. An error does not stop it. The `EXIT` trap of `run-all.sh` kills it.
A scout run can last 30 minutes. The loop sends an approved item without a wait for the run. `ONCE=1` and the two-argument form start no loop.

## Scout run and checkout

`submit_pr` and `submit_pr_update` use `$WORK_ROOT/<project>`. `run-scout.sh` uses the same checkout while the agent runs.
A lock protects the checkout: `$STATE_ROOT/checkout-<project>.lock` (helper `checkout_lock` in `lib.sh`, mode 600, top of the state).
`run-scout.sh` takes it with a blocking `flock` before `agent_reclaim` and the checkout reset. It holds it to the end of the run, because the fd closes when the process ends.
For each `pr` and `pr-update` item, `submit-approved.sh` takes the lock with `flock -n`. When a run holds it, the item stays `approved` and a later round sends it. The script releases the lock after the git work of the item.
The lock fd is above fd 9, so it does not collide with the submit lock. `sudo` closes each fd above 2, so the agent does not hold the lock.
A lock ends with its process, so a killed run leaves no stale lock.
Issues and comments do not use the checkout. They go out at once.

## Order of work in one run

1. Take the lock. Load `overrides.env` (`load_overrides`).
2. Find each item in `submitting`. Set `error` and send a notice. Do not retry.
3. `mark_stale`: set `stale` on each `pending` item older than `stale_days`. The jq program checks `status` again, so a decision of the UI is kept.
4. For each `approved` item:
   - Set `submitting` before the write. A crash then cannot cause a second write.
   - Call `submit_one`.
   - Set `submitted` with `url` and `submitted_at`, or `error`.
   - Send a notice and a PostHog event.
5. For each `rejected` item: remove `bundle` and `patch.diff`, and write the feedback to the scratchpad (`record_feedback`).

## submit_one

- It checks that `project` and `fingerprint` match `^[a-z0-9][a-z0-9-]*$` and that `kind` is one of the four kinds.
- It takes `repo` from `projects.json`, never from the item. A project that is not valid in the file blocks the write.
- It scans `title`, `body` and `footer` again, and for a PR also `patch.diff`, with `secret_hit`. A hit prints `blocked-secret` and returns 2. The list of secrets can change after the item was saved.
- A `submit_pr` that finds a merge conflict with the default branch prints the reason and returns 3. The loop then sets `stale` (with `stale_at` and the reason in `error`), removes `bundle` and `patch.diff`, and sends no notice. A `stale` item does not block the fingerprint, so the next scout run can propose the change again.
- It calls `submit_issue`, `submit_comment`, `submit_pr` or `submit_pr_update`. Each prints the URL and nothing else on stdout. Git output goes to stderr (`gq`).

## Result checks

- `github_url_ok` requires `^https://github\.com/[^[:space:]]+$`. A write with exit code 0 and another output gets `error` ("The write returned no valid GitHub URL. Check GitHub before you retry.").
- `short_err` saves one line of at most 200 characters. It must not start with `+` (a trace) and must pass `secret_hit`. Else the error is "The write failed. Check GitHub before you retry." The saved error is never raw output.
- The label `warden` is created with `--force` before each issue and PR.

## Issue and comment

- `body_out` joins the body and the footer. It skips the footer when the body has the marker `<!-- warden:fp=... -->` already, or holds the footer text.
- An issue gets the label `warden`. The ledger gets `fingerprint -> issue number`.
- A comment goes to the number in `meta.json`. The URL is the issue URL.

## Pull request

- The checkout in `$WORK_ROOT/<project>` is cloned if it does not exist. The script fetches `origin` and detaches at the default branch.
- It fetches the bundle of the item into `refs/heads/warden/<fp>` with `--force`, then pushes that branch. The agent never pushes.
- The body is the item body plus `Refs #<n>` when `related_issue` is set. The PR is a draft with the label `warden`.
- The ledger gets `pr:<fp> -> PR number`.

## Pull request update (fast-forward only)

A `pr-update` adds a commit to an open `warden/` PR. It never rewrites history.

- `number` must be digits and `base_sha` must be 40 hex characters.
- The PR must be `OPEN` and its head branch must start with `warden/`.
- The script fetches that branch. The remote head must equal `base_sha`. If the branch moved, nothing is pushed.
- It fetches the bundle (`refs/heads/warden/ci-update`) into `refs/warden/submit-<n>` and checks that `base_sha` is an ancestor.
- It makes a plain push of that ref to the branch. Git refuses it when the push is not a fast-forward. Do not add `--force`.

## Bundles

- `run-scout.sh` makes `bundle` with `git bundle create origin/<default>..<branch>` and `patch.diff` with `git diff`. The bundle is the source of the push. The diff is for the UI and for the scan.
- `prep-test.sh` also reads the bundle for the test job. See `tester.md`.
- A rejected or stale item loses both files.

## Notices

`submitted`, `submit unclear`, `submit failed`, `submit interrupted` and `blocked a write that looked like a secret`. A notice has the kind, the title and the URL, never the body.
