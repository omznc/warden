#!/usr/bin/env bash
# Test of bin/sync-github.sh with a stub gh. No network.
set -euo pipefail
export WARDEN_NO_AGENT_USER=1

root=$(cd "$(dirname "$0")/.." && pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
fails=0
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
check() { # description command...
	local d=$1
	shift
	if "$@" >/dev/null 2>&1; then ok "$d"; else bad "$d"; fi
}

mkdir -p "$t/bin" "$t/state/demo/pending" "$t/work"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_CONFIG_GLOBAL=$t/gitconfig GIT_CONFIG_SYSTEM=/dev/null
export STATE_ROOT=$t/state WORK_ROOT=$t/work HERMES_WEBHOOK_URL='' PATH=$t/bin:$PATH GH_LOG=$t/gh.log API=$t/api

# The stub answers "gh api repos/<repo>/issues/<n>" from $API/<owner>__<repo>__<n>.json. A missing file is a failure.
cat >"$t/bin/gh" <<'EOS'
#!/usr/bin/env bash
echo "$*" >>"$GH_LOG"
[[ $1 == api && $2 =~ ^repos/([^/]+)/([^/]+)/issues/([0-9]+)$ ]] || exit 0
f=$API/${BASH_REMATCH[1]}__${BASH_REMATCH[2]}__${BASH_REMATCH[3]}.json
[[ -f $f ]] && cat "$f" || exit 1
EOS
chmod +x "$t/bin/gh"
mkdir -p "$API"

# A checkout with the local branch of the PR.
git init -q -b main "$t/work/demo"
git -C "$t/work/demo" commit -q --allow-empty -m seed
git -C "$t/work/demo" branch warden/pr-one

item() { # id kind url [extra-json]
	mkdir -p "$t/state/demo/pending/$1"
	jq -n --arg k "$2" --arg u "$3" --arg i "$1" --argjson x "${4:-{\}}" \
		'{kind: $k, fingerprint: $i, project: "demo", scout: "s", title: ("T " + $i), body: "b", status: "submitted", url: $u} + $x' >"$t/state/demo/pending/$1/meta.json"
}
meta() { printf '%s/state/demo/pending/%s/meta.json' "$t" "$1"; }
item pr-one pr https://github.com/example/repo/pull/1
item issue-two issue https://github.com/example/repo/issues/2 '{"ui_field": "keep"}'
item comment-three comment https://github.com/example/repo/issues/3
item open-four issue https://github.com/example/repo/issues/4
item broken-five issue https://github.com/example/broken/issues/5
echo '{"state": "closed", "closed_at": "2026-01-02T00:00:00Z", "state_reason": "completed", "pull_request": {"merged_at": "2026-01-02T00:00:00Z"}}' >"$API/example__repo__1.json"
echo '{"state": "closed", "closed_at": "2026-01-03T00:00:00Z", "state_reason": "not_planned"}' >"$API/example__repo__2.json"
echo '{"state": "closed", "closed_at": "2026-01-04T00:00:00Z", "state_reason": "completed"}' >"$API/example__repo__3.json"
echo '{"state": "open", "updated_at": "2026-01-05T00:00:00Z", "state_reason": null}' >"$API/example__repo__4.json"

"$root/bin/sync-github.sh" >"$t/out.txt" 2>"$t/err.txt"
check "a merged PR is merged" bash -c "jq -e '.gh_state == \"merged\" and .gh_state_at == \"2026-01-02T00:00:00Z\" and .synced_at != null and .status == \"submitted\"' '$(meta pr-one)'"
check "an issue closed as not planned is closed with the reason" bash -c "jq -e '.gh_state == \"closed\" and .gh_state_reason == \"not_planned\" and .gh_state_at == \"2026-01-03T00:00:00Z\"' '$(meta issue-two)'"
check "a field of the UI is kept" test "$(jq -r .ui_field "$(meta issue-two)")" = keep
check "a comment item tracks the parent issue" test "$(jq -r .gh_state "$(meta comment-three)")" = closed
check "an open issue stays open" bash -c "jq -e '.gh_state == \"open\" and .gh_state_at == \"2026-01-05T00:00:00Z\"' '$(meta open-four)'"
check "a failing repo is skipped with one log line" bash -c "test \"\$(grep -c 'cannot read example/broken' '$t/err.txt')\" = 1 && jq -e '.gh_state == null and .status == \"submitted\"' '$(meta broken-five)'"
check "one notice for a merged PR" grep -q '^warden: PR merged: T pr-one https://github.com/example/repo/pull/1$' "$t/out.txt"
check "one notice for a closed issue" grep -q '^warden: Issue closed: T issue-two https://github.com/example/repo/issues/2$' "$t/out.txt"
check "no notice for an open issue" bash -c "! grep -q 'T open-four' '$t/out.txt'"
check "the local branch of a merged PR is deleted" bash -c "! git -C '$t/work/demo' rev-parse -q --verify refs/heads/warden/pr-one"

: >"$t/out.txt"
# Item 2 closed on 2026-01-03, more than 7 days ago: the next pass must not read it. A recent close is read again.
item old-six issue https://github.com/example/repo/issues/6 '{"gh_state": "closed", "gh_state_at": "2026-01-03T00:00:00Z"}'
recent=$(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ)
item recent-seven issue https://github.com/example/repo/issues/7 "{\"gh_state\": \"closed\", \"gh_state_at\": \"$recent\"}"
echo '{"state": "closed", "closed_at": "2026-01-03T00:00:00Z"}' >"$API/example__repo__6.json"
echo "{\"state\": \"closed\", \"closed_at\": \"$recent\"}" >"$API/example__repo__7.json"
"$root/bin/sync-github.sh" >"$t/out.txt" 2>/dev/null
check "a closed item older than 7 days is not read again" test "$(grep -c 'issues/2$' "$GH_LOG")" = 1
check "an old closed item is not read at all" test "$(grep -c 'issues/6$' "$GH_LOG")" = 0
check "a recently closed item is read again" test "$(grep -c 'issues/7$' "$GH_LOG")" = 1
: >"$t/out.txt"
check "no second notice for the same change" test ! -s "$t/out.txt"
check "a merged item is not read again" test "$(grep -c 'issues/1$' "$GH_LOG")" = 1

if ((fails == 0)); then echo "all passed"; else echo "$fails failed"; exit 1; fi
