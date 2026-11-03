#!/usr/bin/env bash
# Test of the live projects file, the secrets inbox, the discovery file and the project check.
# Uses a stub gh and a stub curl. No network.
set -euo pipefail

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

mkdir -p "$t/bin" "$t/state" "$t/inbox" "$t/secrets" "$t/root/skills/signals-scout-error-tracking" "$t/root/bin"
# Key values are fake strings. They match no token pattern.
good="good-key-value-1"
usonly=us-only-key-value-1
badkey=bad-key-value-1
sentry="good-sentry-value-1"

# gh: repo view fails with the bad token or for example/norepo. api user prints a login.
cat >"$t/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
"repo view")
	[[ ${GH_TOKEN:-} != bad-gh-value-1 && $3 != example/norepo ]] || exit 1
	echo main
	;;
"api user") echo tester ;;
esac
exit 0
EOF
# curl: the stub reads the header from the config on stdin, like the real call. It answers by host, path and token.
cat >"$t/bin/curl" <<'EOF'
#!/usr/bin/env bash
cfg=
url=
while (($#)); do
	case $1 in
	-K) cfg=$(cat); shift ;;
	-D) : >"$2"; shift ;;
	-*) ;;
	*) url=$1 ;;
	esac
	shift
done
tok=$(sed -n 's/.*Bearer \([^"]*\)".*/\1/p' <<<"$cfg")
case $url in
https://eu.posthog.com/api/organizations/ | https://eu.posthog.com/api/projects/ | https://eu.posthog.com/api/projects/*/)
	[[ $tok == "$GOOD" ]] || exit 22 ;;
https://us.posthog.com/api/organizations/ | https://us.posthog.com/api/projects/ | https://us.posthog.com/api/projects/*/)
	[[ $tok == "$USONLY" ]] || exit 22 ;;
https://sentry.io/*) [[ $tok == "$SENTRY" ]] || exit 22 ;;
*) exit 7 ;;
esac
case $url in
*/api/organizations/) echo '{"results":[{"id":"o1","name":"Org One"}],"next":null}' ;;
*/api/projects/) echo '{"results":[{"id":42,"name":"Proj","organization":"o1"}],"next":null}' ;;
*/api/projects/*/) echo '{"id":42}' ;;
https://sentry.io/api/0/projects/) echo '[{"slug":"api","name":"API","platform":"node","organization":{"slug":"org1"}}]' ;;
*) echo '{}' ;;
esac
EOF
chmod +x "$t/bin/gh" "$t/bin/curl"

cat >"$t/projects.json" <<'EOF'
[{"name": "demo", "repo": "example/repo", "posthog_project_id": "42", "posthog_key_env": "POSTHOG_API_KEY_PERSONAL",
  "posthog_ui": "u", "notes": "n", "scouts": ["signals-scout-error-tracking"], "sentry": {"org": "org1", "project": "api"}},
 {"name": "off", "repo": "example/repo", "posthog_project_id": "42", "posthog_key_env": "POSTHOG_API_KEY_PERSONAL",
  "posthog_ui": "u", "notes": "n", "scouts": ["signals-scout-error-tracking"], "enabled": false},
 {"name": "Bad Name", "repo": "example/repo", "posthog_key_env": "POSTHOG_API_KEY_PERSONAL", "scouts": ["signals-scout-error-tracking"]},
 {"name": "badscout", "repo": "example/repo", "posthog_key_env": "POSTHOG_API_KEY_PERSONAL", "scouts": ["nope"]},
 {"name": "badkey", "repo": "example/repo", "posthog_key_env": "HERMES_WEBHOOK_SECRET", "scouts": ["signals-scout-error-tracking"]},
 {"name": "badrepo", "repo": "no-slash", "posthog_key_env": "POSTHOG_API_KEY_PERSONAL", "scouts": ["signals-scout-error-tracking"]}]
EOF

export PATH=$t/bin:$PATH GOOD=$good USONLY=$usonly SENTRY=$sentry
export STATE_ROOT=$t/state INBOX_ROOT=$t/inbox SECRETS_ROOT=$t/secrets PROJECTS_FILE=$t/projects.json
export HERMES_WEBHOOK_URL=''
unset GH_TOKEN SENTRY_TOKEN POSTHOG_API_KEY_PERSONAL POSTHOG_API_KEY_US || true

# Run the scripts from a copy of bin/, so that a stub can take the place of run-scout.sh.
cp "$root"/bin/*.sh "$t/root/bin/"
cat >"$t/root/bin/run-scout.sh" <<'EOF'
#!/usr/bin/env bash
echo "$1 $2" >>"$RUN_LOG"
EOF
chmod +x "$t/root/bin/run-scout.sh"
export RUN_LOG=$t/runs.log
# shellcheck source=/dev/null
source "$t/root/bin/lib.sh"
root_lib=$t/root

echo "== Live projects file"
(root=$root_lib; projects_file >/dev/null)
check "the state file is a copy of the seed" cmp -s "$t/projects.json" "$STATE_ROOT/projects.json"
echo '[]' >"$t/projects.json"
check "no seed file gives an empty list" bash -c "STATE_ROOT='$t/noseed' PROJECTS_FILE='$t/none.json' root='$root_lib' bash -c 'source $root_lib/bin/lib.sh; test \"\$(projects_json | jq length)\" = 0'"
(root=$root_lib; projects_file >/dev/null)
check "an existing state file is not replaced" test "$(jq length "$STATE_ROOT/projects.json")" = 6
names=$(root=$root_lib projects_json 2>"$t/invalid.log" | jq -c '[.[].name]')
check "only valid entries are read" test "$names" = '["demo","off"]'
check "each invalid entry is logged" test "$(grep -c 'invalid project entry' "$t/invalid.log")" = 4
echo 'not json' >"$STATE_ROOT/projects.json.bad"
check "a bad file does not crash the reader" bash -c "STATE_ROOT='$t/bad' PROJECTS_FILE='$STATE_ROOT/projects.json.bad' root='$root_lib' bash -c 'source $root_lib/bin/lib.sh; projects_json >/dev/null 2>&1'"
ONCE=1 "$t/root/bin/run-all.sh" >/dev/null 2>&1 || true
check "the pass runs the enabled project only" test "$(cat "$RUN_LOG")" = "demo signals-scout-error-tracking"

echo "== Secrets inbox"
w() { jq -nc --arg v "$2" '{value: $v, written_at: "t"}' >"$INBOX_ROOT/$1.json"; }
w GH_TOKEN bad-gh-value-1
w POSTHOG_API_KEY_PERSONAL "$badkey"
w ANTHROPIC_BASE_URL https://evil.example.com/x
w SENTRY_TOKEN "has a space"
w ANTHROPIC_API_KEY short
"$t/root/bin/inbox.sh" >/dev/null 2>&1 || bad "inbox exit"
st=$INBOX_ROOT/status.json
check "a GH_TOKEN without access is invalid and lists the repo" bash -c "jq -e '.GH_TOKEN.state == \"invalid\" and (.GH_TOKEN.detail | contains(\"example/repo\"))' '$st'"
check "a refused PostHog key is invalid" test "$(jq -r .POSTHOG_API_KEY_PERSONAL.state "$st")" = invalid
check "a URL key is refused and not in the status" test "$(jq 'has("ANTHROPIC_BASE_URL")' "$st")" = false
check "a value with a space is invalid" test "$(jq -r .SENTRY_TOKEN.state "$st")" = invalid
check "a short value is invalid" test "$(jq -r .ANTHROPIC_API_KEY.state "$st")" = invalid
check "no value reaches overrides.env" test ! -s "$SECRETS_ROOT/overrides.env"
check "the inbox files are deleted" test -z "$(find "$INBOX_ROOT" -name '*.json' ! -name 'status.json' ! -name 'discovery.json' ! -name 'project-status.json')"
w GH_TOKEN good-gh-value-1
w POSTHOG_API_KEY_PERSONAL "$good"
w CLAUDE_CODE_OAUTH_TOKEN oauth-value-123456
"$t/root/bin/inbox.sh" >/dev/null 2>&1 || bad "inbox exit 2"
check "valid values are written to overrides.env" bash -c "grep -q '^GH_TOKEN=good-gh-value-1\$' '$SECRETS_ROOT/overrides.env' && grep -q '^POSTHOG_API_KEY_PERSONAL=$good\$' '$SECRETS_ROOT/overrides.env'"
check "overrides.env has mode 600" test "$(stat -c %a "$SECRETS_ROOT/overrides.env")" = 600
check "valid keys are ok with the source ui" bash -c "jq -e '.GH_TOKEN.state == \"ok\" and .GH_TOKEN.source == \"ui\" and .POSTHOG_API_KEY_PERSONAL.state == \"ok\"' '$st'"
check "a key from the environment has the source env" bash -c "ANTHROPIC_AUTH_TOKEN=x1234567890 '$t/root/bin/inbox.sh' && jq -e '.ANTHROPIC_AUTH_TOKEN.source == \"env\"' '$st'"
check "the status holds no value" bash -c "! grep -qF -e good-gh-value-1 -e '$good' -e oauth-value-123456 -e bad-gh-value-1 '$st'"
check "the loader exports the overrides" bash -c "source '$t/root/bin/lib.sh'; load_overrides; [[ \$GH_TOKEN == good-gh-value-1 ]]"
jq -nc '{clear: true, written_at: "t"}' >"$INBOX_ROOT/GH_TOKEN.json"
"$t/root/bin/inbox.sh" >/dev/null 2>&1 || true
check "clear removes the key" bash -c "! grep -q '^GH_TOKEN=' '$SECRETS_ROOT/overrides.env' && grep -q '^POSTHOG_API_KEY_PERSONAL=' '$SECRETS_ROOT/overrides.env'"
check "a cleared key has the source unset" test "$(jq -r .GH_TOKEN.source "$st")" = unset

echo "== PostHog event keys"
w WARDEN_POSTHOG_TOKEN notaprojecttoken
w WARDEN_POSTHOG_HOST 'https://evil.example.com/path?x=1'
"$t/root/bin/inbox.sh" >/dev/null 2>&1 || bad "inbox exit 3"
check "a token without the prefix phc_ is invalid" test "$(jq -r .WARDEN_POSTHOG_TOKEN.state "$st")" = invalid
check "a host with a path is invalid" test "$(jq -r .WARDEN_POSTHOG_HOST.state "$st")" = invalid
w WARDEN_POSTHOG_TOKEN phc_goodprojecttoken1
w WARDEN_POSTHOG_HOST https://eu.i.posthog.com
"$t/root/bin/inbox.sh" >/dev/null 2>&1 || bad "inbox exit 4"
check "a project token and a host are written to overrides.env" bash -c "grep -q '^WARDEN_POSTHOG_TOKEN=phc_goodprojecttoken1\$' '$SECRETS_ROOT/overrides.env' && grep -q '^WARDEN_POSTHOG_HOST=https://eu.i.posthog.com\$' '$SECRETS_ROOT/overrides.env'"
check "the loader exports the PostHog keys" bash -c "source '$t/root/bin/lib.sh'; load_overrides; [[ \$WARDEN_POSTHOG_TOKEN == phc_goodprojecttoken1 && \$WARDEN_POSTHOG_HOST == https://eu.i.posthog.com ]]"
check "the status holds no token" bash -c "! grep -qF phc_goodprojecttoken1 '$st'"
check "secret_hit finds the token" bash -c "source '$t/root/bin/lib.sh'; load_overrides; echo phc_goodprojecttoken1 >'$t/leak.txt'; secret_hit '$t/leak.txt'"

echo "== Discovery"
export POSTHOG_API_KEY_US=$usonly SENTRY_TOKEN=$sentry
touch "$INBOX_ROOT/discover.request"
"$t/root/bin/discover.sh" >/dev/null 2>&1 || bad "discover exit"
disc=$INBOX_ROOT/discovery.json
check "the request file is deleted" test ! -e "$INBOX_ROOT/discover.request"
check "github login is read" test "$(jq -r .github.login "$disc")" = tester
check "the key from the UI is found with its projects" bash -c "jq -e '[.posthog[] | select(.key_env == \"POSTHOG_API_KEY_PERSONAL\")][0] | .ok and .source == \"ui\" and .region == \"eu\" and .projects[0].id == \"42\" and .projects[0].org_name == \"Org One\"' '$disc'"
check "the key that works only in us gets region us" bash -c "jq -e '[.posthog[] | select(.key_env == \"POSTHOG_API_KEY_US\")][0] | .ok and .source == \"env\" and .region == \"us\"' '$disc'"
check "sentry projects are listed" bash -c "jq -e '.sentry.ok and .sentry.projects[0].org == \"org1\" and .sentry.projects[0].slug == \"api\"' '$disc'"
check "the file holds no key value" bash -c "! grep -qF -e '$good' -e '$usonly' -e '$sentry' '$disc'"
cp "$disc" "$t/disc.before"
"$t/root/bin/discover.sh" >/dev/null 2>&1 || true
check "no new discovery inside 15 minutes" cmp -s "$disc" "$t/disc.before"
unset SENTRY_TOKEN

echo "== Project check"
ps=$INBOX_ROOT/project-status.json
echo '[{"name": "demo", "repo": "example/repo", "posthog_project_id": "42", "posthog_key_env": "POSTHOG_API_KEY_PERSONAL", "scouts": ["signals-scout-error-tracking"]}]' >"$STATE_ROOT/projects.json"
export POSTHOG_API_KEY_PERSONAL=$good
"$t/root/bin/discover.sh" >/dev/null 2>&1 || bad "discover exit 2"
check "the project is checked" bash -c "jq -e '.demo.repo_ok and .demo.posthog_ok and .demo.sentry_ok == null and (.demo.hash | length == 64)' '$ps'"
jq '.demo.checked_at = "keep"' "$ps" >"$ps.t" && mv "$ps.t" "$ps"
"$t/root/bin/discover.sh" >/dev/null 2>&1 || true
check "an unchanged config is not checked again" test "$(jq -r .demo.checked_at "$ps")" = keep
jq '.[0].repo = "example/norepo"' "$STATE_ROOT/projects.json" >"$t/p.tmp" && mv "$t/p.tmp" "$STATE_ROOT/projects.json"
"$t/root/bin/discover.sh" >/dev/null 2>&1 || true
check "a changed config is checked again" bash -c "jq -e '.demo.checked_at != \"keep\" and (.demo.repo_ok | not) and (.demo.detail | contains(\"repository\"))' '$ps'"
jq '.[0].sentry = {org: "org1", project: "api"} | .[0].repo = "example/repo"' "$STATE_ROOT/projects.json" >"$t/p.tmp" && mv "$t/p.tmp" "$STATE_ROOT/projects.json"
SENTRY_TOKEN=$sentry "$t/root/bin/discover.sh" >/dev/null 2>&1 || true
check "sentry is checked when the project has it" test "$(jq -r .demo.sentry_ok "$ps")" = true
echo '[]' >"$STATE_ROOT/projects.json"
"$t/root/bin/discover.sh" >/dev/null 2>&1 || true
check "a removed project leaves the status" test "$(jq 'has("demo")' "$ps")" = false

if ((fails == 0)); then echo "all passed"; else echo "$fails failed"; exit 1; fi
