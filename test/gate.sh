#!/usr/bin/env bash
# Integration test of the PR approval gate. Uses a stub gh and a stub claude. No network.
set -euo pipefail
export WARDEN_NO_AGENT_USER=1

root=$(cd "$(dirname "$0")/.." && pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
scout=signals-scout-error-tracking
fails=0
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
check() { # description command...
	local d=$1
	shift
	if "$@" >/dev/null 2>&1; then ok "$d"; else bad "$d"; fi
}

mkdir -p "$t/bin" "$t/state" "$t/work"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_CONFIG_GLOBAL=$t/gitconfig GIT_CONFIG_SYSTEM=/dev/null

# Bare origin with one commit on main.
git init -q --bare -b main "$t/origin.git"
git clone -q "$t/origin.git" "$t/seed" 2>/dev/null
echo seed >"$t/seed/README"
git -C "$t/seed" add README
git -C "$t/seed" commit -q -m seed
git -C "$t/seed" push -q origin HEAD:main

cat >"$t/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$GH_LOG"
case "$1 $2" in
"repo clone") git clone -q "$ORIGIN" "${4:-$(basename "$3")}" ;;
"repo view") echo main ;;
"issue list" | "pr list")
	# A -q filter on stub output gives an empty value, a --json call gives an empty list.
	if [[ " $* " == *"headRefName,files"* && -n ${OPEN_PRS:-} ]]; then cat "$OPEN_PRS"; exit 0; fi
	[[ " $* " == *" -q "* ]] || echo '[]'
	;;
api*)
	case " $* " in
	*" user "*) echo me ;;
	*issues/*/comments*) cat "${COMMENTS_JSON:-/dev/null}" 2>/dev/null || true ;;
	*) echo '[]' ;;
	esac
	;;
"pr create") echo https://github.com/example/repo/pull/7 ;;
"issue create" | "issue comment")
	[[ -z ${META_WATCH:-} || $2 != create ]] || jq -r .status "$META_WATCH" >"$BODY_COPY.status-during"
	prev=
	for a in "$@"; do
		[[ $prev != --body-file ]] || cp "$a" "$BODY_COPY.$2"
		prev=$a
	done
	[[ $2 != create ]] || echo https://github.com/example/repo/issues/3
	;;
esac
exit 0
EOF
cat >"$t/bin/claude" <<'EOF'
#!/usr/bin/env bash
here=$(dirname "$0")
env | grep -c -E '^(GH_TOKEN|GITHUB_TOKEN|POSTHOG_API_KEY_DEMO|HERMES_WEBHOOK_SECRET)=' >"$here/envcount" || true
# The review call carries the title of review-pass.md in its system prompt. Keep what each call got.
kind=fix
[[ "$*" != *"Independent review of a change"* ]] || kind=review
prev=
for a in "$@"; do
	[[ $prev != --append-system-prompt ]] || printf '%s' "$a" >"$here/sys.$kind"
	[[ $prev != --allowedTools ]] || printf '%s' "$a" >"$here/allowed.$kind"
	prev=$a
done
if [[ $kind == review ]]; then
	echo review >>"$here/review.log"
	r='{"verdict":"ok","summary":"Fine.","findings":[]}'
	case $(cat "$here/rmode" 2>/dev/null) in
	high) r='{"verdict":"changes","summary":"Bad.","findings":[{"file":"a.ts","line":3,"severity":"high","summary":"Leaks data."}]}' ;;
	bad) r='this is not json' ;;
	edit) echo tamper >>README ;;
	esac
	jq -nc --arg r "$r" '{is_error: false, result: $r, num_turns: 1, total_cost_usd: 0.02}'
	exit 0
fi
fp=$(cat "$here/fp")
mode=$(cat "$here/mode")
leak=
case $mode in
workflow) mkdir -p .github/workflows && echo x >.github/workflows/x.yml ;;
hook) echo 'echo pwned' >.git/hooks/pre-commit ;;
secret) leak="token $(cat "$here/leak")" ;;
file) mkdir -p "$(dirname "$(cat "$here/file")")" && echo x >"$(cat "$here/file")" ;;
esac
echo "change $fp" >"change-$fp.txt"
if [[ $mode == twopr ]]; then
	findings=$(jq -nc --arg a "$fp" --arg b "$(cat "$here/fp2")" '{summary: "stub", findings: [
	  {fingerprint: $a, action: "pr", severity: "low", title: "First", body: "One."},
	  {fingerprint: $b, action: "pr", severity: "low", title: "Second", body: "Two."}]}')
	jq -nc --arg r "$findings" '{is_error: false, result: $r, num_turns: 2, total_cost_usd: 0.01}'
	exit 0
fi
findings=$(jq -nc --arg fp "$fp" --arg leak "$leak" '{summary: "stub", findings: [
  {fingerprint: $fp, action: "pr", severity: "high", title: "Guard null", body: "Body of the PR.\n\n## Review\n\nFixer verdict: all fine.\n\n## Notes\n\nKeep me.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n"},
  {fingerprint: "slow-lcp", action: "issue", severity: "low", title: "Slow LCP", body: ("Body of the issue. " + $leak)},
  {fingerprint: "slow-lcp-note", action: "comment", number: 9, severity: "low", title: "More on LCP", body: "Body of the comment."}]}')
jq -nc --arg r "$findings" '{is_error: false, result: $r, num_turns: 2, total_cost_usd: 0.01}'
EOF
chmod +x "$t/bin/gh" "$t/bin/claude"

cat >"$t/projects.json" <<'EOF'
[{"name": "demo", "repo": "example/repo", "posthog_project_id": "1", "posthog_key_env": "POSTHOG_API_KEY_DEMO",
  "posthog_ui": "https://eu.posthog.com/project/1", "notes": "n", "scouts": ["signals-scout-error-tracking"]}]
EOF

export BODY_COPY=$t/body.copy WARDEN_URL=https://warden.example
export PATH=$t/bin:$PATH ORIGIN=$t/origin.git GH_LOG=$t/gh.log CLAUDE_ENV_COUNT=$t/bin/envcount
export PROJECTS_FILE=$t/projects.json STATE_ROOT=$t/state WORK_ROOT=$t/work
export POSTHOG_API_KEY_DEMO=phk-demo-value-1 HERMES_WEBHOOK_SECRET=hermes-demo-secret GH_TOKEN=fake-gh-token HERMES_WEBHOOK_URL='' MODE=prs
: >"$GH_LOG"
unset GITHUB_TOKEN

pend=$STATE_ROOT/demo/pending
runs=$STATE_ROOT/runs.jsonl
branch_in_origin() { git -C "$t/origin.git" rev-parse -q --verify "refs/heads/warden/$1" >/dev/null; }
pr_creates() { grep -c '^pr create' "$GH_LOG" || true; }
creates() { grep -c '^issue create' "$GH_LOG" || true; }
comments() { grep -c '^issue comment' "$GH_LOG" || true; }
scout_run() { # fingerprint [mode]; the stub claude reads both from files because the agent env is clean
	printf '%s' "$1" >"$t/bin/fp"
	printf '%s' "${2:-normal}" >"$t/bin/mode"
	printf '%s' "$GH_TOKEN" >"$t/bin/leak"
	"$root/bin/run-scout.sh" demo "$scout"
}
last_action() { tail -n 1 "$runs" | jq -r --arg fp "$1" '.findings[] | select(.fingerprint == $fp) | .action'; }

echo "== Case A: gate on"
scout_run error-tracking-null-guard >"$t/a.out" 2>&1 || { cat "$t/a.out"; bad "run-scout exit"; }
fp=error-tracking-null-guard
check "pending bundle exists" test -f "$pend/$fp/bundle"
check "pending patch.diff exists" test -s "$pend/$fp/patch.diff"
check "meta status pending" test "$(jq -r .status "$pend/$fp/meta.json")" = pending
check "the PR body has no Claude attribution" bash -c "! jq -r .body '$pend/$fp/meta.json' | grep -q 'Generated with'"
check "the PR body has the footer label" bash -c "jq -r .body '$pend/$fp/meta.json' | grep -q '^<sub>Warden · signals-scout-error-tracking scout · reviewed by a person'"
check "no pr create before approval" test "$(pr_creates)" = 0
check "no branch in origin before approval" bash -c "! git -C '$t/origin.git' rev-parse -q --verify refs/heads/warden/$fp"
check "no issue create before approval" test "$(creates)" = 0
check "no issue comment before approval" test "$(comments)" = 0
check "issue is pending" test "$(jq -r '.kind + ":" + .status' "$pend/slow-lcp/meta.json")" = issue:pending
check "comment is pending with its number" bash -c "cat '$pend'/slow-lcp-note-*/meta.json | jq -e '.kind == \"comment\" and .number == 9 and .status == \"pending\"'"
check "the approval notice links each item to its review page" bash -c "grep -q '^- PR: Guard null https://warden.example/review/$fp\$' '$t/a.out' && grep -q '^- Issue: Slow LCP https://warden.example/review/slow-lcp\$' '$t/a.out' && grep -Eq '^- Comment: More on LCP https://warden.example/review/slow-lcp-note-[0-9]{12}\$' '$t/a.out'"
check "last run records action pending" test "$(last_action $fp)" = pending
check "last run records pending-issue" test "$(last_action slow-lcp)" = pending-issue
check "last run records pending-comment" test "$(last_action slow-lcp-note)" = pending-comment
check "GH_TOKEN not in claude env" test "$(cat "$CLAUDE_ENV_COUNT")" = 0
check "a prs run gets the self-review rules in the system prompt" grep -q '^# Review your change before the final message' "$t/bin/sys.fix"
check "the reviewer had no fix-review text" bash -c "! grep -q 'Review your change before the final message' '$t/bin/sys.review'"
check "the reviewer has no write tool" bash -c "! grep -qE 'Edit|Write|mcp' '$t/bin/allowed.review'"
check "review.json is next to meta.json" test "$(jq -r .verdict "$pend/$fp/review.json")" = ok
check "the PR body has the review section before the footer" bash -c "jq -r .body '$pend/$fp/meta.json' | awk '/^## Independent review/ {r = NR} /^<sub>Warden/ {f = NR} END {exit !(r && f && r < f)}'"
check "the reviewer cost is in the run record" test "$(tail -n 1 "$runs" | jq -r .cost_usd)" = 0.03

echo "== Approve and submit"
for m in "$pend"/*/meta.json; do
	jq '.status = "approved"' "$m" >"$m.tmp" && mv "$m.tmp" "$m"
done
META_WATCH=$pend/slow-lcp/meta.json "$root/bin/submit-approved.sh" >"$t/s.out" 2>&1 || true; cat "$t/s.out"
check "exactly one issue create after approval" test "$(creates)" = 1
check "exactly one issue comment after approval" test "$(comments)" = 1
check "comment is on issue 9" grep -q '^issue comment 9 ' "$GH_LOG"
check "issue body has the marker" grep -q '<!-- warden:fp=slow-lcp -->' "$BODY_COPY.create"
check "comment body has the footer" grep -q '^<sub>Warden · signals-scout-error-tracking scout · ' "$BODY_COPY.comment"
check "branch pushed to origin" branch_in_origin "$fp"
check "branch has the commit" bash -c "git -C '$t/origin.git' log -1 --format=%s refs/heads/warden/$fp | grep -q 'Guard null'"
check "pr create is a draft" grep -q '^pr create.* --draft' "$GH_LOG"
check "pr create has no reviewer" bash -c "! grep '^pr create' '$GH_LOG' | grep -q -- --reviewer"
check "meta status submitted" test "$(jq -r .status "$pend/$fp/meta.json")" = submitted
check "the submitted notice has the GitHub url" grep -q 'draft PR submitted: Guard null https://github.com/example/repo/pull/7$' "$t/s.out"
check "the issue is marked submitting while gh runs" test "$(cat "$BODY_COPY.status-during" 2>/dev/null)" = submitting
check "meta has the url" test "$(jq -r .url "$pend/$fp/meta.json")" = https://github.com/example/repo/pull/7
check "ledger has pr entry" test "$(jq -r --arg k "pr:$fp" '.[$k]' "$STATE_ROOT/demo/ledger.json")" = 7

echo "== Case B: same fingerprint again"
before=$(pr_creates)
scout_run $fp >"$t/b.out" 2>&1 || { cat "$t/b.out"; bad "run-scout exit B"; }
check "no second pr create" test "$(pr_creates)" = "$before"
check "only a new comment is pending (the first one was submitted)" test "$(find "$pend" -mindepth 1 -maxdepth 1 | wc -l)" = 4
check "no second issue create" test "$(creates)" = 1

echo "== Case C: auto_submit"
echo '{"projects": {"demo": {"auto_submit": true}}}' >"$STATE_ROOT/settings.json"
fp2=auto-fingerprint
c_before=$(comments)
scout_run $fp2 >"$t/c.out" 2>&1 || { cat "$t/c.out"; bad "run-scout exit C"; }
check "branch pushed directly" branch_in_origin "$fp2"
check "pr create called" test "$(pr_creates)" = "$((before + 1))"
check "no pending dir for auto fingerprint" test ! -e "$pend/$fp2"
check "comment posted at once" test "$(comments)" = "$((c_before + 1))"
check "the comment of another scout has the marker" grep -q '<!-- warden:fp=slow-lcp-note -->' "$BODY_COPY.comment"
check "the auto notice has the GitHub url of the issue and of the PR" bash -c "grep -q 'New issue: Slow LCP (https://github.com/example/repo/issues/3)' '$t/c.out' && grep -q 'New draft PR: Guard null (https://github.com/example/repo/pull/7)' '$t/c.out'"
echo "== Case C2: old key auto_submit_prs"
echo '{"projects": {"demo": {"auto_submit_prs": true}}}' >"$STATE_ROOT/settings.json"
fp2b=auto-old-key
scout_run $fp2b >"$t/c2.out" 2>&1 || { cat "$t/c2.out"; bad "run-scout exit C2"; }
check "old key pushes directly" branch_in_origin "$fp2b"
check "old key leaves no pending dir" test ! -e "$pend/$fp2b"
rm "$STATE_ROOT/settings.json"

echo "== Case D: rejected"
fp3=rejected-one
scout_run $fp3 >"$t/d.out" 2>&1 || { cat "$t/d.out"; bad "run-scout exit D"; }
jq '.status = "rejected"' "$pend/$fp3/meta.json" >"$pend/$fp3/m.tmp" && mv "$pend/$fp3/m.tmp" "$pend/$fp3/meta.json"
"$root/bin/submit-approved.sh" >"$t/s2.out" 2>&1 || true
check "bundle removed" test ! -e "$pend/$fp3/bundle"
check "patch.diff removed" test ! -e "$pend/$fp3/patch.diff"
check "meta.json kept" test -f "$pend/$fp3/meta.json"

echo "== Case E: the agent edits a workflow file"
fp4=workflow-edit
scout_run $fp4 workflow >"$t/e.out" 2>&1 || { cat "$t/e.out"; bad "run-scout exit E"; }
check "no pending dir for workflow edit" test ! -e "$pend/$fp4"
check "no branch for workflow edit" bash -c "! git -C '$t/origin.git' rev-parse -q --verify refs/heads/warden/$fp4"
check "last run records blocked-path" test "$(last_action $fp4)" = blocked-path

echo "== Case F: the agent writes a git hook"
fp5=hook-edit
if scout_run $fp5 hook >"$t/f.out" 2>&1; then bad "run-scout must fail on a hook change"; else ok "run-scout aborts on a hook change"; fi
check "run records an error" test "$(tail -n 1 "$runs" | jq -r .status)" = error
check "no pending dir for hook edit" test ! -e "$pend/$fp5"
check "checkout removed" test ! -e "$WORK_ROOT/demo"

echo "== Case G: a finding holds a secret value"
fp6=secret-leak
issues_before=$(grep -c '^issue create' "$GH_LOG" || true)
scout_run $fp6 secret >"$t/g.out" 2>&1 || { cat "$t/g.out"; bad "run-scout exit G"; }
check "no issue created with the secret" test "$(grep -c '^issue create' "$GH_LOG" || true)" = "$issues_before"
check "run records blocked-secret" bash -c "tail -n 1 '$runs' | jq -e '[.findings[].action] | index(\"blocked-secret\")'"
check "secret value not in the run record" bash -c "! grep -q -- \"\$GH_TOKEN\" '$runs'"


echo "== Case H: rejection feedback"
fpr=rejected-two
scout_run $fpr >"$t/h.out" 2>&1 || { cat "$t/h.out"; bad "run-scout exit H"; }
jq '.status = "rejected" | .reject_reason = "not wanted"' "$pend/$fpr/meta.json" >"$pend/$fpr/m.tmp" && mv "$pend/$fpr/m.tmp" "$pend/$fpr/meta.json"
"$root/bin/submit-approved.sh" >/dev/null 2>&1 || true
"$root/bin/submit-approved.sh" >/dev/null 2>&1 || true
pad=$STATE_ROOT/demo/$scout/scratchpad.md
check "scratchpad has the REJECTED line" grep -qE "^- [0-9-]{10} REJECTED $fpr \"Guard null\": not wanted\$" "$pad"
check "the line is written one time" test "$(grep -c "REJECTED $fpr " "$pad")" = 1
check "feedback_recorded is set" test "$(jq -r .feedback_recorded "$pend/$fpr/meta.json")" = true

echo "== Case I: a pr finding in mode issues"
MODE=issues scout_run skipmode-one >"$t/i.out" 2>&1 || { cat "$t/i.out"; bad "run-scout exit I"; }
check "run records skipped-mode" test "$(last_action skipmode-one)" = skipped-mode
check "an issues run has no self-review rules" bash -c "! grep -q 'Review your change before the final message' '$t/bin/sys.fix'"
MODE=dry scout_run dry-one >"$t/i2.out" 2>&1 || { cat "$t/i2.out"; bad "run-scout exit I2"; }
check "a dry run has no self-review rules" bash -c "! grep -q 'Review your change before the final message' '$t/bin/sys.fix'"

echo "== Case J: the footer is not appended twice"
mkdir -p "$pend/old-issue" "$pend/new-issue"
jq -n '{kind: "issue", fingerprint: "old-issue", project: "demo", scout: "s", title: "Old", body: "Text\n<!-- warden:fp=old-issue -->\n", number: null, status: "pending"}' >"$pend/old-issue/meta.json"
jq -n '{kind: "issue", fingerprint: "new-issue", project: "demo", scout: "s", title: "New", body: "Text", footer: "\n\n---\n<sub>Warden · s scout · note</sub>\n<!-- warden:fp=new-issue -->", number: null, status: "pending"}' >"$pend/new-issue/meta.json"
for i in old-issue new-issue; do
	jq '.status = "approved"' "$pend/$i/meta.json" >"$pend/$i/m.tmp" && mv "$pend/$i/m.tmp" "$pend/$i/meta.json"
	"$root/bin/submit-approved.sh" >/dev/null 2>&1 || true
	check "$i is submitted" test "$(jq -r .status "$pend/$i/meta.json")" = submitted
	check "$i body has the marker one time" test "$(grep -c "warden:fp=$i" "$BODY_COPY.create")" = 1
done
check "the new item body has the footer text" grep -q '^<sub>Warden · s scout · ' "$BODY_COPY.create"

echo "== Case L: a skipped finding leaves no commit for the next one"
git -C "$t/seed" push -q origin HEAD:refs/heads/warden/dup-one
printf '%s' dup-two >"$t/bin/fp2"
scout_run dup-one twopr >"$t/l.out" 2>&1 || { cat "$t/l.out"; bad "run-scout exit L"; }
check "the first finding is skipped as a duplicate" test "$(last_action dup-one)" = skipped-dup
check "the second finding does not carry the first change" test ! -e "$pend/dup-two/patch.diff"
check "the checkout is at the base after the run" test -z "$(git -C "$WORK_ROOT/demo" status --porcelain)"
check "the skipped change left no commit" bash -c "test \"\$(git -C '$WORK_ROOT/demo' rev-list --count origin/main..HEAD)\" = 0"

echo "== Case M: blocked paths at any depth"
n=0
for f in package.json packages/a/package.json sub/Makefile a/b/Dockerfile.dev CODEOWNERS docs/.github/x.yml yarn.lock x/bun.lockb .npmrc app/bunfig.toml .gitattributes; do
	n=$((n + 1))
	printf '%s' "$f" >"$t/bin/file"
	scout_run "blocked-$n" file >"$t/m.out" 2>&1 || { cat "$t/m.out"; bad "run-scout exit M"; }
	check "$f is blocked" test "$(last_action "blocked-$n")" = blocked-path
done
printf '%s' src/ok.ts >"$t/bin/file"
scout_run allowed-one file >"$t/m.out" 2>&1 || bad "run-scout exit M2"
check "an ordinary path is saved" test -f "$pend/allowed-one/meta.json"

echo "== Case N: git output and a traced run never reach the url or a notice"
mkdir -p "$t/gitstub"
cat >"$t/gitstub/git" <<'EOS'
#!/usr/bin/env bash
for a in "$@"; do
	[[ $a != push ]] || { echo "remote: Create a pull request for 'x' on GitHub by visiting:" >&2; echo "remote:   https://github.com/example/repo/pull/new/x" >&2; }
done
exec /usr/bin/git "$@"
EOS
chmod +x "$t/gitstub/git"
jq '.status = "approved"' "$pend/allowed-one/meta.json" >"$pend/allowed-one/m.tmp" && mv "$pend/allowed-one/m.tmp" "$pend/allowed-one/meta.json"
PATH=$t/gitstub:$PATH bash -x "$root/bin/submit-approved.sh" >"$t/n.out" 2>"$t/n.err" || true
check "the url is only the gh pr create url" test "$(jq -r .url "$pend/allowed-one/meta.json")" = https://github.com/example/repo/pull/7
check "no git output in the notice" bash -c "! grep -q 'remote:' '$t/n.out'"
check "a traced run does not print the token" bash -c "! grep -qF -- \"\$GH_TOKEN\" '$t/n.err' && ! grep -qF -- \"\$HERMES_WEBHOOK_SECRET\" '$t/n.err'"
check "the trace holds no token in meta.json" bash -c "! grep -qF -- \"\$GH_TOKEN\" '$pend/allowed-one/meta.json'"

echo "== Case O: crash safety of the submit"
mkdir -p "$pend/cut-one" "$pend/ledger-one"
jq -n '{kind: "issue", fingerprint: "cut-one", project: "demo", scout: "s", title: "Cut", body: "x", number: null, status: "submitting"}' >"$pend/cut-one/meta.json"
creates_before=$(creates)
"$root/bin/submit-approved.sh" >/dev/null 2>&1 || true
check "an item in submitting becomes an error" test "$(jq -r '.status + ":" + .error' "$pend/cut-one/meta.json")" = "error:Interrupted during submit. Check GitHub before you retry."
check "it is not written again" test "$(creates)" = "$creates_before"
jq -n '{kind: "issue", fingerprint: "ledger-one", project: "demo", scout: "s", title: "Ledger", body: "x", number: null, status: "approved"}' >"$pend/ledger-one/meta.json"
mkdir -p "$STATE_ROOT/demo/ledger.json.tmp"
"$root/bin/submit-approved.sh" >/dev/null 2>&1 || true
rmdir "$STATE_ROOT/demo/ledger.json.tmp"
check "a ledger failure does not turn a written issue into an error" test "$(jq -r '.status + ":" + .url' "$pend/ledger-one/meta.json")" = "submitted:https://github.com/example/repo/issues/3"

echo "== Case P: the independent review"
review_mode() { printf '%s' "$1" >"$t/bin/rmode"; }
echo '{"projects": {"demo": {"auto_submit": true}}}' >"$STATE_ROOT/settings.json"
review_mode high
prs_before=$(pr_creates)
scout_run review-high >"$t/p.out" 2>&1 || { cat "$t/p.out"; bad "run-scout exit P"; }
check "a high finding holds the PR in auto-submit" test "$(jq -r .status "$pend/review-high/meta.json")" = pending
check "no pr create for the held PR" test "$(pr_creates)" = "$prs_before"
check "no branch for the held PR" bash -c "! git -C '$t/origin.git' rev-parse -q --verify refs/heads/warden/review-high"
check "the reviewer does not get the fixer's Review section" bash -c "! grep -q 'Fixer verdict' '$t/bin/sys.review' && grep -q 'Keep me.' '$t/bin/sys.review'"
check "review.json holds the high finding" test "$(jq -r '.findings[0].severity' "$pend/review-high/review.json")" = high
check "the PR body has the review section" bash -c "jq -r .body '$pend/review-high/meta.json' | grep -q '^## Independent review' && jq -r .body '$pend/review-high/meta.json' | grep -q 'a.ts:3. (high): Leaks data.'"
check "the held PR footer does not say posted automatically" bash -c "! jq -r .body '$pend/review-high/meta.json' | grep -q 'posted automatically'"
review_mode ok
scout_run review-fine >"$t/p2.out" 2>&1 || { cat "$t/p2.out"; bad "run-scout exit P2"; }
check "a clean review lets auto-submit write the PR" test "$(pr_creates)" = "$((prs_before + 1))"
review_mode bad
scout_run review-bad >"$t/p3.out" 2>&1 || { cat "$t/p3.out"; bad "run-scout exit P3"; }
check "a bad reviewer answer does not fail the run" test "$(tail -n 1 "$runs" | jq -r .status)" = ok
check "a bad reviewer answer gives the verdict error" test "$(jq -r .verdict "$pend/review-bad/review.json")" = error
check "an error verdict holds the PR in auto-submit" test "$(jq -r .status "$pend/review-bad/meta.json")" = pending
review_mode edit
scout_run review-edit >"$t/p4.out" 2>&1 || { cat "$t/p4.out"; bad "run-scout exit P4"; }
check "a reviewer that edits a file discards the item" test ! -e "$pend/review-edit"
check "the run records blocked-review" test "$(last_action review-edit)" = blocked-review
check "the checkout is clean after the discard" test -z "$(git -C "$WORK_ROOT/demo" status --porcelain)"
review_mode ok
rm "$STATE_ROOT/settings.json"

echo "== Case Q: a file of the open PR of another author"
printf '[{"number": 12, "title": "Other work", "headRefName": "alice/fix", "files": [{"path": "src/shared.ts"}]}]' >"$t/openprs.json"
printf '%s' src/shared.ts >"$t/bin/file"
OPEN_PRS=$t/openprs.json scout_run clash-one file >"$t/q.out" 2>&1 || { cat "$t/q.out"; bad "run-scout exit Q"; }
check "the system prompt lists the open PR of the other author" grep -q '"number":12.*src/shared.ts' "$t/bin/sys.fix"
check "a change to such a file is not saved as a PR" test ! -e "$pend/clash-one"
check "the run records skipped-open-pr" test "$(last_action clash-one)" = skipped-open-pr
printf '%s' src/other.ts >"$t/bin/file"
OPEN_PRS=$t/openprs.json scout_run clash-two file >"$t/q2.out" 2>&1 || { cat "$t/q2.out"; bad "run-scout exit Q2"; }
check "a change to another file is saved" test -f "$pend/clash-two/meta.json"

echo "== Case R: the default branch moves after the run"
scout_run conflict-one >"$t/r.out" 2>&1 || { cat "$t/r.out"; bad "run-scout exit R"; }
echo "other text" >"$t/seed/change-conflict-one.txt"
git -C "$t/seed" add change-conflict-one.txt
git -C "$t/seed" commit -q -m "same file"
git -C "$t/seed" push -q origin HEAD:main
jq '.status = "approved"' "$pend/conflict-one/meta.json" >"$pend/conflict-one/m.tmp" && mv "$pend/conflict-one/m.tmp" "$pend/conflict-one/meta.json"
prs_before=$(pr_creates)
"$root/bin/submit-approved.sh" >"$t/r2.out" 2>&1 || true
check "a PR that conflicts with the default branch gets status error" test "$(jq -r .status "$pend/conflict-one/meta.json")" = error
check "the error says that the change conflicts" bash -c "jq -r .error '$pend/conflict-one/meta.json' | grep -q 'conflicts with main'"
check "no pr create for the conflicting PR" test "$(pr_creates)" = "$prs_before"

echo "== Case K: daily cost cap"
printf '%s\n' "{\"started\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"cost_usd\": 0.5, \"findings\": []}" >>"$runs"
echo '{"daily_cost_cap_usd": 0.4}' >"$STATE_ROOT/settings.json"
: >"$t/bin/fp"
"$root/bin/run-scout.sh" demo "$scout" >"$t/k.out" 2>&1 || { cat "$t/k.out"; bad "run-scout exit K"; }
check "run is recorded as skipped with the reason" test "$(tail -n 1 "$runs" | jq -r '.status + ":" + .error')" = "skipped:daily cost cap reached"
check "the notice is sent one time a day" test "$(cat "$STATE_ROOT/cap-notified")" = "$(date -u +%Y-%m-%d)"
echo '{"daily_cost_cap_usd": null}' >"$STATE_ROOT/settings.json"
scout_run capfree-one >"$t/k2.out" 2>&1 || { cat "$t/k2.out"; bad "run-scout exit K2"; }
check "a null cap means no cap" test "$(tail -n 1 "$runs" | jq -r .status)" = ok
rm "$STATE_ROOT/settings.json"

if ((fails == 0)); then echo "all passed"; else echo "$fails failed"; exit 1; fi
