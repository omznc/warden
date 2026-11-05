# Scout warden-ci

The scout `warden-ci` follows up the pull requests that warden opened. Its skill is `skills/warden-ci/SKILL.md`.
The runner side is `ci_prepare` and the functions near it in `bin/run-scout.sh`.
Tests: `test/ci.sh`.

## Which PR the scout reads

- The runner lists at most 30 open PRs. It keeps a PR when the head branch starts with `warden/` and the head is in the same repository.
- It reads the checks (`gh pr checks`) and the comments of the PR (review comments and issue comments).
- It keeps a comment only when the author association is `OWNER`, `MEMBER` or `COLLABORATOR` and the body has no `warden:fp=` marker. Our own comments never count.
- It takes at most 3 failed runs from the check links. For each run it keeps the last 200 lines and at most 20000 characters of `gh run view --log-failed`.
- The runner starts the agent for one PR in a run. If no PR has news, the run ends with the summary "Nothing to follow up." and exit code 0.
- The agent gets a copy as `prs.json` in its state directory (`put_file`). The runner keeps its own copy.

## Seen keys

`<project>/warden-ci.seen.json` remembers what the runner handled. It is in the closed project directory, so the agent cannot change it.

| Key | Meaning |
|---|---|
| `<head sha>` | a check failed on that head |
| `conflict:<head sha>` | the PR has a merge conflict on that head (`mergeable` is `CONFLICTING` or the merge state is `DIRTY`) |
| `stale:<number>:<updatedAt>` | an idle PR: no activity for more than 30 days. It fires once for each last-activity time. |
| `c:<number>` | the list of comment ids that the runner handled |

- A PR has news when a key is new or a comment id is new.
- `ci_mark_seen` runs at the end of a run for the PR of the run. A comment run does not mark the head sha. Only the keys of `ci_keys` go in.
- A block of an edit (`blocked-path`, `blocked-secret`, `blocked-conflict`) still marks the keys. The same head would give the same edit and cost one more run in each pass. A new head or a new comment starts the agent again.
- A fetch failure for the PR marks it as seen, so the run does not fail each time.
- A failure to save the merge state (`ci_merge_base`) does not mark it. The next pass tries again, and no agent runs.

## Actions

- `comment`: the number must equal the PR of the run. The marker key is `warden-ci-<number>`. The footer label is `triage`. See `docs/domains/items.md`.
- `pr-update`: only for `warden-ci`, and the number must equal the PR of the run.
- The agent edits files in the checkout. The checkout is detached at the head of the PR.
- `stage_changes` stages the edits and applies the blocked paths. `save_pr_update` scans the diff of the agent for secrets and for conflict markers.
- In pending mode the item is a `pr-update` (see `items.md`). The runner creates the local branch `warden/ci-update` and the bundle `<head>..warden/ci-update`.
- In auto mode the runner pushes with a plain `git push origin HEAD:refs/heads/<ref>`. A refused push is recorded as `pr-update-failed`.
- `submit-approved.sh` pushes a `pr-update` only when the remote branch still equals `base_sha`. See `submit.md`.

## Conflict flow

A conflict is a merge of the default branch into the PR branch. The runner does the merge, not the agent.

1. `ci_merge_base` runs `git merge --no-commit --no-ff origin/<default>`.
2. If the merge stops (a `MERGE_HEAD` exists), the runner saves three things before the agent runs:
   - `ci_base`: the commit id of the default branch.
   - `ci_auto`: the tree of the automatic merge, with the conflict markers (`git add -A`, `git write-tree`).
   - `$tmp/conflicted`: the paths with a conflict.
3. The runner resets the index (`git reset -q`). The files with markers stay in the work tree for the agent.
4. The agent removes the markers. It does not commit.
5. The runner compares the edits of the agent with `ci_auto`, not with `HEAD`. A change that only the base branch made is not an edit of the agent. The path blocks and the secret scan look at the edits of the agent only.
6. `commit_staged` makes the merge commit with `git commit-tree <tree> -p HEAD -p <ci_base>`. The two parents come from the runner. Nothing reads `.git/MERGE_HEAD` after step 3.
7. The item shows the resolution (`agent.diff`), not the changes of the base branch.

Rules:

- A merge has a commit even when the tree equals the head. The "no changes" check is skipped when `ci_auto` is set.
- The change is blocked (`blocked-conflict`) when the diff of the agent adds a line with a marker (7 or more of `<`, `>`, `=` or `|`), or when a conflicted path still has a marker.
- `reset_checkout` puts the checkout back at the head, and then at `ci_auto`, so a skipped finding leaves no edits for the next one.

## Idle PRs

A PR with no activity for more than 30 days gets the key `stale:<number>:<updatedAt>`. The agent then chooses whether to comment. The runner only starts the run.
