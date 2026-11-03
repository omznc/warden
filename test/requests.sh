#!/usr/bin/env bash
# Test of the state contract: run ids, running files, run requests and per-project modes.
# Uses a stub gh and a stub claude. No network.
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

mkdir -p "$t/bin" "$t/state" "$t/work"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_CONFIG_GLOBAL=$t/gitconfig GIT_CONFIG_SYSTEM=/dev/null
git init -q --bare -b main "$t/origin.git"
git clone -q "$t/origin.git" "$t/seed" 2>/dev/null
echo seed >"$t/seed/README"
git -C "$t/seed" add README
git -C "$t/seed" commit -q -m seed
git -C "$t/seed" push -q origin HEAD:main

cat >"$t/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
"repo clone") git clone -q "$ORIGIN" "${4:-$(basename "$3")}" ;;
"repo view") echo main ;;
"issue list" | "pr list") [[ " $* " == *" -q "* ]] || echo '[]' ;;
esac
exit 0
EOF
# The stub records whether the running file exists while the agent runs.
cat >"$t/bin/claude" <<'EOF'
#!/usr/bin/env bash
here=$(dirname "$0")
echo run >>"$here/claude-runs"
[[ ! -f $(cat "$here/runfile") ]] || echo yes >>"$here/saw-running"
jq -nc '{is_error: false, num_turns: 1, total_cost_usd: 0, result: ({summary: "stub", findings: [
  {fingerprint: "slow-lcp", action: "issue", severity: "low", title: "Slow LCP", body: "Body."}]} | tojson)}'
EOF
# A stub curl for the PostHog events: it keeps the arguments and the body of each call.
cat >"$t/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"${CURL_LOG:?}"
cat >>"${CURL_LOG:?}.body"
echo >>"${CURL_LOG:?}.body"
exit 1
EOF
chmod +x "$t/bin/gh" "$t/bin/claude" "$t/bin/curl"
export CURL_LOG=$t/curl.log WARDEN_POSTHOG_TOKEN=phc_testtoken_value

cat >"$t/projects.json" <<'EOF'
[{"name": "demo", "repo": "example/repo", "posthog_project_id": "1", "posthog_key_env": "POSTHOG_API_KEY_DEMO",
  "posthog_ui": "https://eu.posthog.com/project/1", "notes": "n", "scouts": ["signals-scout-error-tracking"]}]
EOF

export PATH=$t/bin:$PATH ORIGIN=$t/origin.git
export PROJECTS_FILE=$t/projects.json STATE_ROOT=$t/state WORK_ROOT=$t/work
export POSTHOG_API_KEY_DEMO=phk-demo-value-1 GH_TOKEN=fake-gh-token HERMES_WEBHOOK_URL='' MODE=issues
scout=signals-scout-error-tracking
runs=$STATE_ROOT/runs.jsonl
running=$STATE_ROOT/running/demo__$scout.json
echo "$running" >"$t/bin/runfile"
claude_runs() { wc -l <"$t/bin/claude-runs" 2>/dev/null || echo 0; }

# shellcheck source=/dev/null
source "$root/bin/lib.sh"

echo "== Run id and running file"
"$root/bin/run-scout.sh" demo "$scout" >"$t/a.out" 2>&1 || { cat "$t/a.out"; bad "run-scout exit"; }
check "run id has the format" bash -c "tail -n 1 '$runs' | jq -e '.id | test(\"^[0-9]{8}T[0-9]{6}Z-demo-$scout\$\")'"
check "run id starts with the started time" bash -c "tail -n 1 '$runs' | jq -e '(.started | gsub(\"[-:]\"; \"\")) == (.id | split(\"-\")[0])'"
check "running file existed during the run" test -s "$t/bin/saw-running"
check "running file is gone after the run" test ! -e "$running"
check "issue is pending in env mode issues" test -f "$STATE_ROOT/demo/pending/slow-lcp/meta.json"

echo "== PostHog events"
check "a failing curl does not fail the run" test "$(tail -n 1 "$runs" | jq -r .status)" = ok
check "one event for the run and one for the new item" test "$(jq -s '[.[].event] | sort | join(",")' -r "$CURL_LOG.body")" = "warden item created,warden scout run"
check "the run event has the numbers" bash -c "jq -e 'select(.event == \"warden scout run\") | .properties | .project == \"demo\" and .status == \"ok\" and .exit_code == 0 and .items_created == 1 and (.duration_s | type) == \"number\" and .cost_usd == 0' '$CURL_LOG.body'"
check "the item event has ids only" test "$(jq -r 'select(.event == "warden item created") | .properties | [.item_id, .kind, (keys | length | tostring)] | join(",")' "$CURL_LOG.body")" = "slow-lcp,issue,5"
check "an event has the fixed distinct id and no person profile" bash -c "jq -e --arg h \"warden-\$(hostname)\" 'select(.event == \"warden scout run\") | .distinct_id == \$h and .properties[\"\$process_person_profile\"] == false' '$CURL_LOG.body'"
check "the event has the title of no item" bash -c "! grep -q 'Slow LCP' '$CURL_LOG.body'"
check "the token is not in the curl arguments" bash -c "! grep -q phc_testtoken_value '$CURL_LOG'"
check "the events go to the capture endpoint" bash -c "grep -q 'https://eu.i.posthog.com/i/v0/e/' '$CURL_LOG'"
check "the token is not in the notice or the log of the run" bash -c "! grep -q phc_testtoken_value '$t/a.out'"
check "no event without a token" bash -c "n=\$(wc -l <'$CURL_LOG'); WARDEN_POSTHOG_TOKEN= bash -c \"source '$root/bin/lib.sh'; ph_capture x '{}'\"; test \"\$(wc -l <'$CURL_LOG')\" = \"\$n\""
check "the agent environment has no PostHog token" bash -c "source '$root/bin/lib.sh'; export WARDEN_POSTHOG_TOKEN=phc_testtoken_value WARDEN_POSTHOG_HOST=https://x.example; echo p >'$t/p.txt'; echo s >'$t/s.md'; echo m >'$t/m.json'; echo t >'$t/t.json'; agent_build p '$t/s.md' '$t/m.json' '$t/t.json' 5; ! printf '%s\n' \"\${agent_cmd[@]}\" | grep -q 'WARDEN_POSTHOG'"

echo "== Per-project mode beats env MODE"
rm -rf "$STATE_ROOT/demo/pending"
echo '{"projects": {"demo": {"mode": "dry"}}}' >"$STATE_ROOT/settings.json"
"$root/bin/run-scout.sh" demo "$scout" >"$t/b.out" 2>&1 || { cat "$t/b.out"; bad "run-scout exit B"; }
check "no pending item in mode dry" test ! -e "$STATE_ROOT/demo/pending"
check "run record has mode dry" test "$(tail -n 1 "$runs" | jq -r .mode)" = dry
echo '{"projects": {"demo": {"mode": "bogus"}}}' >"$STATE_ROOT/settings.json"
check "invalid mode falls back to env MODE" test "$(project_mode demo "$MODE")" = issues
rm "$STATE_ROOT/settings.json"

echo "== Run requests"
mkdir -p "$STATE_ROOT/requests" "$STATE_ROOT/running"
: >"$t/bin/claude-runs"
echo '{"requested_at": "2026-01-01T00:00:00Z"}' >"$STATE_ROOT/requests/demo__$scout.json"
echo '{}' >"$STATE_ROOT/requests/demo__nope.json"
echo '{}' >"$STATE_ROOT/requests/demo__...json"
echo '{}' >"$STATE_ROOT/requests/x__..json"
echo '{}' >"$STATE_ROOT/requests/nounderscore.json"
echo "$$" >"$t/last-run"
handle_requests >"$t/c.out" 2>&1 || true
check "a valid request ran once" test "$(claude_runs)" = 1
check "all requests are deleted" test -z "$(ls -A "$STATE_ROOT/requests")"
check "a request leaves the last-run stamp alone" test ! -e "$STATE_ROOT/last-run"

echo "== A busy pair keeps its request"
echo '{}' >"$running"
echo '{}' >"$STATE_ROOT/requests/demo__$scout.json"
handle_requests >"$t/d.out" 2>&1 || true
check "no run while the pair runs" test "$(claude_runs)" = 1
check "the request waits" test -f "$STATE_ROOT/requests/demo__$scout.json"

echo "== Stale running files"
echo '{}' >"$STATE_ROOT/running/old__scout.json"
clean_running
check "stale running files are removed" test -z "$(ls -A "$STATE_ROOT/running")"

echo "== An approval does not wait for the end of the pass"
mkdir -p "$t/root2/bin"
cp "$root"/bin/*.sh "$t/root2/bin/"
mkdir -p "$t/root2/skills/signals-scout-error-tracking" "$t/root2/skills/signals-scout-logs"
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\necho "scout $*" >>"$ORDER_LOG"\n' >"$t/root2/bin/run-scout.sh"
# shellcheck disable=SC2016
printf '#!/usr/bin/env bash\necho submit >>"$ORDER_LOG"\n' >"$t/root2/bin/submit-approved.sh"
cat >"$t/two.json" <<'JSON'
[{"name": "demo", "repo": "example/repo", "posthog_project_id": "1", "posthog_key_env": "POSTHOG_API_KEY_DEMO",
  "scouts": ["signals-scout-error-tracking", "signals-scout-logs"]}]
JSON
ORDER_LOG=$t/order.log PROJECTS_FILE=$t/two.json STATE_ROOT=$t/state2 ONCE=1 "$t/root2/bin/run-all.sh" >"$t/ra.out" 2>&1 || true
check "submit-approved runs after each scout run" test "$(paste -sd' ' "$t/order.log")" = "scout demo signals-scout-error-tracking submit scout demo signals-scout-logs submit"

if ((fails == 0)); then echo "all passed"; else echo "$fails failed"; exit 1; fi
