#!/usr/bin/env bash
# Test of the operations features: umask, stale items, health and failure notices, weekly summary, PostHog events.
# Uses stubs for gh, claude, curl and the webhook. No network.
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

export STATE_ROOT=$t/state WORK_ROOT=$t/work HERMES_WEBHOOK_URL='' PATH=$t/bin:$PATH
mkdir -p "$t/bin" "$STATE_ROOT" "$WORK_ROOT"

echo "== umask"
check "lib.sh sets umask 027" bash -c "umask 0000; source '$root/bin/lib.sh'; test \"\$(umask)\" = 0027"
mkdir -p "$STATE_ROOT/p" "$WORK_ROOT/p/.git" "$t/outside"
touch "$STATE_ROOT/p/ledger.json" "$WORK_ROOT/p/.git/HEAD" "$t/outside/target"
chmod 666 "$STATE_ROOT/p/ledger.json" "$WORK_ROOT/p/.git/HEAD" "$t/outside/target"
ln -s "$t/outside/target" "$STATE_ROOT/p/link"
bash -c "source '$root/bin/lib.sh'; harden_dirs"
check "harden_dirs removes o+w in the state" test "$(stat -c %a "$STATE_ROOT/p/ledger.json")" = 664
check "harden_dirs removes o+w in the work directory" test "$(stat -c %a "$WORK_ROOT/p/.git/HEAD")" = 664
check "harden_dirs does not follow a symlink" test "$(stat -c %a "$t/outside/target")" = 666

echo "== stale items"
pend=$STATE_ROOT/demo/pending
mkdir -p "$pend"
mkitem() { # id status [extra-json]
	mkdir -p "$pend/$1"
	jq -n --arg i "$1" --arg s "$2" --argjson x "${3:-{\}}" \
		'{kind: "issue", fingerprint: $i, project: "demo", scout: "s", title: "T", body: "b", status: $s} + $x' >"$pend/$1/meta.json"
}
ago() { date -u -d "$1 days ago" +%Y-%m-%dT%H:%M:%SZ; }
mkitem old-created pending "{\"created\": \"$(ago 40)\"}"
mkitem fresh-created pending "{\"created\": \"$(ago 2)\"}"
mkitem old-stamp pending
mv "$pend/old-stamp" "$pend/old-stamp-$(date -u -d '40 days ago' +%Y%m%d%H%M)"
mkitem old-dir pending
touch -d '40 days ago' "$pend/old-dir"
mkitem edited-old pending "{\"created\": \"$(ago 40)\"}"
touch "$pend/edited-old/meta.json"
mkitem approved-old approved "{\"created\": \"$(ago 40)\"}"
mkitem rejected-old rejected "{\"created\": \"$(ago 40)\"}"
echo bundle >"$pend/old-created/bundle"
echo diff >"$pend/old-created/patch.diff"
st() { jq -r .status "$pend/$1"/meta.json; }
check "item_epoch reads the created field" test "$(bash -c "source '$root/bin/lib.sh'; item_epoch '$pend/old-created/meta.json'")" = "$(date -u -d "$(ago 40)" +%s)"
check "item_epoch reads the stamp in the id" bash -c "source '$root/bin/lib.sh'; [[ \$(item_epoch '$(echo "$pend"/old-stamp-*/meta.json)') -lt \$(date -d '39 days ago' +%s) ]]"
check "item_epoch ignores the mtime of meta.json" bash -c "source '$root/bin/lib.sh'; [[ \$(item_epoch '$pend/old-dir/meta.json') -lt \$(date -d '39 days ago' +%s) ]]"
check "stale_days defaults to 30" test "$(bash -c "source '$root/bin/lib.sh'; stale_days")" = 30
"$root/bin/submit-approved.sh" >/dev/null 2>&1 || true
check "an old pending item is stale" test "$(st old-created)" = stale
check "stale_at is set" bash -c "jq -e '.stale_at != null' '$pend/old-created/meta.json'"
check "the bundle and the patch of a stale item are removed" test ! -e "$pend/old-created/bundle" -a ! -e "$pend/old-created/patch.diff"
check "a fresh pending item stays pending" test "$(st fresh-created)" = pending
check "the stamp in the id sets the age" test "$(st "$(basename "$(echo "$pend"/old-stamp-*)")")" = stale
check "the directory mtime sets the age" test "$(st old-dir)" = stale
check "an edit does not make an old item young" test "$(st edited-old)" = stale
check "a rejected item is not changed" test "$(st rejected-old)" = rejected
check "an approved item is not made stale" test "$(st approved-old)" != stale
echo '{"stale_days": 100}' >"$STATE_ROOT/settings.json"
mkitem later pending "{\"created\": \"$(ago 40)\"}"
"$root/bin/submit-approved.sh" >/dev/null 2>&1 || true
check "the stale_days setting is used" test "$(st later)" = pending
rm -f "$STATE_ROOT/settings.json"

echo "== health and failure notices"
hr() { bash -c "root='$root'; source '$root/bin/lib.sh'; health_record demo scout-a $1"; }
check "a first failure sends no notice" test -z "$(hr 3)"
check "a second failure sends one notice with the exit code" test "$(hr 3)" = "warden: demo/scout-a failed 2 times in a row (exit code 3)"
check "a third failure sends no notice" test -z "$(hr 3)"
check "the count and no last good time are saved" bash -c "jq -e '.[\"demo/scout-a\"] | .fails == 3 and .last_good == null and .last_exit == 3' '$STATE_ROOT/health.json'"
check "a good run after two failures sends one notice" test "$(hr 0)" = "warden: demo/scout-a runs again after 3 failures"
check "a good run resets the count and sets the last good time" bash -c "jq -e '.[\"demo/scout-a\"] | .fails == 0 and .last_good != null' '$STATE_ROOT/health.json'"
check "a good run in a row sends no notice" test -z "$(hr 0)"
check "a failure after a good run sends no notice" test -z "$(hr 1)"
check "health.json is private to the runner" test "$(stat -c %a "$STATE_ROOT/health.json")" = 600

# A pass with more than half of the runs failed sends one notice.
mkdir -p "$t/root/skills/s1" "$t/root/skills/s2" "$t/root/skills/s3"
cp -r "$root/bin" "$t/root/bin"
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\n[[ $2 != s3 ]] && exit 1\nexit 0\n' >"$t/root/bin/run-scout.sh"
cat >"$t/root/projects.json" <<'EOF'
[{"name": "demo", "repo": "example/repo", "posthog_project_id": "1", "posthog_key_env": "POSTHOG_API_KEY_DEMO", "scouts": ["s1", "s2", "s3"]}]
EOF
out=$(ONCE=1 STATE_ROOT="$t/pass-state" PROJECTS_FILE="$t/root/projects.json" bash "$t/root/bin/run-all.sh" 2>/dev/null)
check "a pass with 2 of 3 failed runs sends one notice" test "$(grep -c '^warden: 2 of 3 runs failed in this pass$' <<<"$out")" = 1
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\n[[ $2 == s1 ]] && exit 1\nexit 0\n' >"$t/root/bin/run-scout.sh"
out=$(ONCE=1 STATE_ROOT="$t/pass-state" PROJECTS_FILE="$t/root/projects.json" bash "$t/root/bin/run-all.sh" 2>/dev/null)
check "a pass with 1 of 3 failed runs sends none" test -z "$(grep 'runs failed in this pass' <<<"$out")"

echo "== weekly summary"
rm -rf "$t/wk" && mkdir -p "$t/wk/demo/pending"
wk() { # id json
	mkdir -p "$t/wk/demo/pending/$1"
	jq -n --argjson x "$2" '{kind: "issue", fingerprint: "f", project: "demo", scout: "s", title: "SECRET-TITLE", body: "b"} + $x' >"$t/wk/demo/pending/$1/meta.json"
}
wk a-new "{\"status\": \"pending\", \"created\": \"$(ago 1)\"}"
wk b-old "{\"status\": \"pending\", \"created\": \"$(ago 20)\"}"
wk c-sub "{\"status\": \"submitted\", \"created\": \"$(ago 9)\", \"submitted_at\": \"$(ago 2)\", \"gh_state\": \"merged\", \"gh_state_at\": \"$(ago 1)\"}"
wk d-closed "{\"status\": \"submitted\", \"created\": \"$(ago 30)\", \"submitted_at\": \"$(ago 20)\", \"gh_state\": \"closed\", \"gh_state_at\": \"$(ago 3)\"}"
wk e-rej "{\"status\": \"rejected\", \"created\": \"$(ago 5)\", \"decided_at\": \"$(ago 4)\"}"
wk f-stale "{\"status\": \"stale\", \"created\": \"$(ago 40)\", \"stale_at\": \"$(ago 1)\"}"
jq -nc --arg a "$(ago 1)" --arg b "$(ago 30)" '{started: $a, cost_usd: 1.25}, {started: $a, cost_usd: 0.5}, {started: $b, cost_usd: 9}' >"$t/wk/runs.jsonl"
msg=$(STATE_ROOT="$t/wk" WARDEN_URL=https://w.example "$root/bin/weekly.sh")
check "the summary has the counts" grep -qx 'New: 2, submitted: 1, merged: 1, closed: 1, rejected: 1, stale: 1' <<<"$msg"
check "the summary has the cost of the last 7 days" grep -qx 'Cost: 1.75 usd' <<<"$msg"
check "the summary has a link for each waiting item" bash -c "grep -qx 'https://w.example/review/a-new' <<<'$msg' && grep -qx 'https://w.example/review/b-old' <<<'$msg' && grep -qx 'Waiting for review: 2' <<<'$msg'"
check "the summary has no title" bash -c "! grep -q SECRET-TITLE <<<'$msg'"
msg=$(STATE_ROOT="$t/wk" WARDEN_URL="" "$root/bin/weekly.sh")
check "without warden_url the summary has no link" bash -c "grep -qx 'Waiting for review: 2' <<<'$msg' && ! grep -q 'review/' <<<'$msg'"

if ((fails == 0)); then echo "all passed"; else echo "$fails failed"; exit 1; fi
