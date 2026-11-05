# Pending items and the approval gate

A finding of a scout becomes a pending item. A person approves the item in the UI. Then `submit-approved.sh` writes it to GitHub.
Read `submit.md` for the write. The code for this page is in `bin/run-scout.sh` and `app/src/server/store.ts`.

## Modes

- `dry`: no GitHub write and no item. The runner logs what it would do and records `dry-issue`, `dry-comment` or `dry-pr`.
- `issues`: issues and comments. A `pr` finding is dropped and recorded as `skipped-mode`.
- `prs`: issues, comments and draft PRs.
- The mode of a project is `settings.json` `.projects.<name>.mode`. A missing or bad value gives the environment variable `MODE`, then `dry`.
- The UI forces `auto_submit` to false when the mode is `dry`.

## Kinds and ids

- Kinds: `issue`, `comment`, `pr`, `pr-update`. An old item with no `kind` is a `pr`.
- A fingerprint is `<scout>-<stable-kebab-slug>`. It must match `^[a-z0-9][a-z0-9-]*$`. The runner skips a finding with a bad fingerprint or an empty title.
- The id of an `issue` or a `pr` item is the fingerprint. `fresh_id` adds a UTC stamp (`<fp>-<yyyymmddHHMMSS>`) when an item with that id exists. The old item keeps its directory.
- The id of a `comment` item is `<fp>-<UTC yyyymmddHHMM>`, with `-<n>` when two items share a minute.
- The id of a `pr-update` item is `<fp>-<first 7 characters of base_sha>`.
- The runner redacts email addresses in the title and the body (`[email removed]`).

## Files of an item

`<project>/pending/<id>/` holds `meta.json`, and for a PR also `bundle` and `patch.diff`.

- `meta.json` fields: `kind`, `fingerprint`, `project`, `scout`, `title`, `body`, `number`, `severity`, `created`, `status`, `url`, `model` (the model of the run that made the item, for example `opus`; an old item has none). A `pr` item also has `base_sha` and `related_issue`. A `pr-update` item has `number` (the PR) and `base_sha` (the head of the PR at run time).
- The runner writes `meta.json` last, by an atomic rename. A reader never sees a partial item.
- For `issue` and `comment`, `body` has no footer. The field `footer` holds the text that the submit step appends. The submit step does not append it when the body holds the marker already.
- Footer for a scout finding: a line `---`, a logo (only when `WARDEN_ASSET_URL` is set), the line `<scout> scout · <note>`, and the marker `<!-- warden:fp=<key> -->`. The note is `reviewed by a person before it was posted`, or `posted automatically` when the project has auto-submit on. The scouts `github-issues` and `warden-ci` use the label `triage` and the key `<scout>-<number>`. The runner also deletes Claude attribution lines from the body.
- The UI can edit `title` (one line, at most 300 characters) and `body` (at most 60000) of a pending item. It sets `edited_at`.
- `decided_at` and `reject_reason` (at most 500 characters): written by the UI.
- `submitted_at`, `stale_at`, `error`, `feedback_recorded`: written by the runner.

## Statuses

| Status | Meaning | Who sets it |
|---|---|---|
| `pending` | waits for a person | runner |
| `approved` | a person approved it | UI |
| `submitting` | the write to GitHub is in progress | `submit-approved.sh` |
| `submitted` | written, `url` is set | `submit-approved.sh` |
| `rejected` | a person rejected it | UI |
| `stale` | pending for more than `stale_days` | `submit-approved.sh` |
| `error` | the write failed, or it was cut short | `submit-approved.sh` |

- The UI approves a `pending` item. It also approves an `error` item (a retry). It rejects only a `pending` item.
- An item in `submitting` at the start of a pass was cut short. The script sets `error` ("Interrupted during submit. Check GitHub before you retry.") and does not retry. The write may have happened.
- A rejected item keeps its `meta.json`. The script removes its `bundle` and `patch.diff`.
- On the first pass after a rejection, the script writes `- <date> REJECTED <fingerprint> "<title>": <reason>` to the scratchpad of the scout. The harness tells the agent not to propose it again. Then `feedback_recorded` is true.
- Stale: `stale_days` in `settings.json` (default 30, 1 to 3650). The age counts from `created`, then from the UTC stamp in the id, then from the mtime of the item directory. The mtime of `meta.json` does not count, because an edit rewrites it. A stale item cannot be approved. The script removes its bundle and patch.
- `gh_state` (`open`, `closed`, `merged`), `gh_state_reason`, `gh_state_at`, `synced_at`: written by `sync-github.sh` for a `submitted` item, at most each 10 minutes. A comment item holds the state of its parent issue. The `status` does not change. A merged item, and an item closed for more than 7 days, are not read again. When a PR merges, the script deletes the local branch `warden/<fp>`.

## The 409 rule

The runner and the UI both write `meta.json`. The UI uses `writeMetaChecked` in `store.ts`.
It reads the file again right before the rename. If `status` or `edited_at` changed, it throws `ConflictError` (HTTP 409, "This item changed. Reload the page.").
Do not write `meta.json` from the UI in another way.
The shell scripts use `setmeta`: `jq` to a `.tmp` file, then `mv`. `sync-github.sh` reads the file again for its write, so a decision of the UI is kept.

## Dedup

`pending_dup` in `run-scout.sh` blocks a new item with the same fingerprint when an item exists with one of these:

- `pending`, `approved`, `submitting` or `error`.
- `rejected` for less than `reject_days` days (`settings.json`, default 30, 0 to 3650). The age counts from the mtime of `meta.json`.
- `submitted` and `gh_state` is `open` or missing (issue, PR). After the issue or PR closes, the scout can propose again.
- `submitted` comment, while the issue has our marker comment and no newer comment from another person (`comment_dup`).
- A `stale` item does not block.
- For `pr-update`, the id (fingerprint and short sha) is the key.

More rules:

- The run context lists the open issues and PRs with the label `warden` and their fingerprints. A finding with the fingerprint of an open issue becomes a `comment` on that issue.
- `ledger.json` (per project) maps a fingerprint to an issue number, and `pr:<fp>` to a PR number.
- A PR is skipped when the branch `warden/<fp>` or an open PR with that head exists.
- Caps for each run: `MAX_NEW_ISSUES` issues (default 3) and one PR or PR update.
- `comment_dup` fails closed: with no answer from GitHub, it reports a duplicate. With no login for the token user, any author counts.

## Auto-submit

- The setting is `settings.json` `.projects.<name>.auto_submit`. The old key `auto_submit_prs` still works. The default is off.
- With it on, the runner writes at once and saves no item: `gh issue create`, `gh issue comment`, or a push and `gh pr create --draft`.
- The same secret scan and the same blocked paths apply. The same dedup applies, using GitHub as the source for comments.
- A `pr-update` in auto mode is a plain push to the PR branch. It never forces. See `warden-ci.md`.
- A `pr` or `pr-update` with a high finding in `review.json`, or with the verdict `error`, does not auto-submit. The runner saves it as a pending item for a person, and its footer says "reviewed by a person". The variable `auto_hold` in `run-scout.sh` does this.

## Independent review

- A run in mode `prs` gives the self-review rules (`prompts/fix-review.md`) to the agent. The run context also lists the open PRs of other authors and their files.
- A `pr` finding that changes a file of such a PR is not saved. The run records `skipped-open-pr`. The runner does not turn it into an issue, because the finding body describes a diff.
- Before the runner commits a `pr` or `pr-update`, it starts a second `claude` as a reviewer (`review_change` in `run-scout.sh`). A dry run has no review.
- The reviewer has the same isolation and model as the fix agent, no MCP server, and read tools only. See `sandbox.md`. Its prompt is `prompts/review-pass.md`, the PR title and body (untrusted), and nothing from the fix run.
- The reviewer returns `{"verdict": "ok"|"changes", "summary", "findings": [{"file", "line", "severity", "summary"}]}`. The runner keeps known fields, caps the list at 20 and the text lengths, and removes emails. A secret in the text, a bad answer, a non-zero exit or a timeout (`REVIEW_TIMEOUT`, default 900 seconds) gives `{"verdict": "error"}`. A review never fails the run.
- The runner hashes `git status` and `git diff HEAD` before and after the review. A change discards the item and records `blocked-review`. The check of `.git/config` and `.git/hooks` also applies.
- The result is `pending/<id>/review.json`, written before `meta.json`. The runner adds a section `## Independent review` to the body, before the footer. The UI shows the file on the review page.
- The cost of the review adds to `cost_usd` of the run, so the daily cost cap counts it.

## Blocks

- `blocked-secret`: `secret_hit` matched the title, the body or the diff. See `secrets.md`.
- `blocked-path`: the agent changed a path that can run code. The runner keeps two lists, `blocked_path` and `blocked_any`: `.git/`, `.github/`, `.circleci/`, `.husky/`, CI files, `.gitattributes`, `CODEOWNERS`, `Makefile`, `Dockerfile*`, `Containerfile*`, `package.json`, lockfiles, `bunfig.toml`, `.npmrc`. The harness tells the agent the same list.
- `blocked-conflict`: see `warden-ci.md`.
- `blocked-review`: the reviewer changed the checkout.
- `skipped-open-pr`: the change touches a file of an open PR of another author.

## Notices and events

- One notice for each run that makes items. It lists each item and a link `<WARDEN_URL>/review/<id>` when `WARDEN_URL` is set.
- PostHog events: `warden item created` and `warden item status changed`. See `integrations.md`.
