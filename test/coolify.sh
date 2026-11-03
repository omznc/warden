#!/usr/bin/env bash
# Test of the Coolify integration: the token check in the inbox, the discovery, and the runner of the coolify scout.
# Uses a stub curl, a stub gh and a stub claude. No network. The Coolify answers are fixed files.
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
# rep <character> <count>: a fake secret is built at run time, so that no secret scanner sees a value in this file.
rep() { printf '%*s' "$2" '' | tr ' ' "$1"; }

mkdir -p "$t/bin" "$t/state" "$t/inbox" "$t/secrets" "$t/work"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_CONFIG_GLOBAL=$t/gitconfig GIT_CONFIG_SYSTEM=/dev/null

git init -q --bare -b main "$t/origin.git"
git clone -q "$t/origin.git" "$t/seed" 2>/dev/null
echo seed >"$t/seed/README"
git -C "$t/seed" add README
git -C "$t/seed" commit -q -m seed
git -C "$t/seed" push -q origin HEAD:main

# Fake token values. The body of a token is 40 equal characters, so a grep for 12 of them finds a leak.
tok_read="7|$(rep r 40)"
tok_write="8|$(rep w 40)"
tok_nosens="9|$(rep n 40)"
tok_bad="5|$(rep x 40)"
body_read=$(rep r 12)
export TOK_READ=$tok_read TOK_WRITE=$tok_write TOK_NOSENS=$tok_nosens
export LEAK_HOOK=hook-must-not-leak-value-1

cat >"$t/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
"repo clone") git clone -q "$ORIGIN" "${4:-$(basename "$3")}" ;;
"repo view") echo main ;;
"pr list") echo '[]' ;;
"issue list") echo '[]' ;;
api*)
	case " $* " in
	*" user "*) echo me ;;
	*) echo '[]' ;;
	esac
	;;
esac
exit 0
EOF

# curl: reads the config on stdin like the real call. It logs argv (a token there is a failure) and marks a call that is not a GET.
# It answers from the files APPS_JSON, DEP_JSON and LOG_TXT, and by the token.
cat >"$t/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$CURL_ARGV"
cfg=
while (($#)); do
	case $1 in
	-K) cfg=$(cat); shift ;;
	-w | --max-time | --connect-timeout | --max-filesize | --proto) shift ;;
	-X | -d | --data* | -T | --upload-file | -F) echo "NOT A GET: $1" >>"$CURL_ARGV" ;;
	esac
	shift
done
url=$(sed -n 's/^url = "\(.*\)"$/\1/p' <<<"$cfg")
out=$(sed -n 's/^output = "\(.*\)"$/\1/p' <<<"$cfg")
tok=$(sed -n 's/.*Bearer \([^"]*\)".*/\1/p' <<<"$cfg")
path=${url#https://coolify.example.com}
echo "$path" >>"$CURL_CALLS"
reply() { printf '%s' "$2" >"$out"; printf '%s' "$1"; }
case $tok in "$TOK_READ" | "$TOK_WRITE" | "$TOK_NOSENS") ;; *) reply 401 '{"message":"Unauthenticated."}'; exit 0 ;; esac
case $path in
/api/v1/teams/current) reply 200 '{"id":0,"name":"Root Team"}' ;;
/api/v1/applications)
	w=
	[[ $tok != "$TOK_WRITE" ]] || w=$LEAK_HOOK
	jq --arg w "$w" 'map(.manual_webhook_secret_github = (if $w == "" then null else $w end))' "$APPS_JSON" >"$out"
	printf 200
	;;
/api/v1/deployments/applications/*) cp "$DEP_JSON" "$out"; printf 200 ;;
/api/v1/applications/*/logs\?*)
	if [[ $tok == "$TOK_NOSENS" ]]; then reply 403 '{"message":"Forbidden"}'; else jq -n --rawfile l "$LOG_TXT" '{logs: $l}' >"$out"; printf 200; fi
	;;
*) reply 404 '{}' ;;
esac
EOF
chmod +x "$t/bin/gh" "$t/bin/curl"

# The application list holds fields that are secret. The scripts must drop them.
cat >"$t/apps.json" <<'EOF'
[{"uuid": "app11111aaaa", "name": "web", "git_repository": "example/repo", "build_pack": "dockerfile", "fqdn": "https://web.example.com",
  "status": "running:healthy", "git_branch": "main", "restart_count": 3, "max_restart_count": 0, "restart_limit_reached": false,
  "health_check_enabled": false, "custom_healthcheck_found": false, "limits_memory": "0", "limits_cpus": "0", "ports_exposes": "3000",
  "custom_docker_run_options": "--restart unless-stopped -e SECRETENV=env-must-not-leak", "docker_compose_raw": "compose-must-not-leak",
  "http_basic_auth_password": "basic-must-not-leak", "last_online_at": "2026-01-01 10:00:00"},
 {"uuid": "app22222bbbb", "name": "cache", "git_repository": "library/redis", "build_pack": "dockerimage", "fqdn": "", "status": "running:unknown"},
 {"uuid": "app33333cccc", "name": "api", "git_repository": "git@github.com:example/other.git", "build_pack": "nixpacks", "fqdn": "https://api.example.com", "status": "exited:unhealthy"},
 {"uuid": "app44444dddd", "name": "site", "git_repository": "https://github.com/example/site.git", "build_pack": "dockerfile", "fqdn": "", "status": "running:healthy"}]
EOF
cat >"$t/dep.json" <<'EOF'
{"count": 2, "deployments": [
 {"deployment_uuid": "dep1", "status": "failed", "commit": "abc123", "commit_message": "Fix the build\nlong body", "created_at": "2026-01-02T10:00:00Z", "finished_at": "2026-01-02T10:01:00Z", "is_webhook": true, "rollback": false, "pull_request_id": 0,
  "logs": "[{\"output\": \"build-secret-must-not-leak\"}]"},
 {"deployment_uuid": "dep0", "status": "finished", "commit": "abc000", "commit_message": "Start", "created_at": "2026-01-01T10:00:00Z", "finished_at": "2026-01-01T10:01:00Z", "is_webhook": false, "rollback": false, "pull_request_id": 0, "logs": "[]"}]}
EOF
# 3000 long lines, then lines with secrets and an error line.
{
	for i in $(seq 1 3000); do printf '2026-01-01 info request %d ok %0150d\n' "$i" 0; done
	printf '\033[31mERROR: connection refused to db\033[0m\n'
	printf 'a leaked key ghp_%s in a log\n' "$(rep a 36)"
	printf 'call with %s done\n' "$tok_read"
	printf 'Authorization: Bearer %s\n' "$(rep b 26)"
	printf 'DATABASE %s=%s set\n' pass"word" "$(rep h 12)"
} >"$t/log.txt"
export APPS_JSON=$t/apps.json DEP_JSON=$t/dep.json LOG_TXT=$t/log.txt CURL_ARGV=$t/curl.argv CURL_CALLS=$t/curl.calls ORIGIN=$t/origin.git
: >"$CURL_ARGV"
: >"$CURL_CALLS"

cat >"$t/settings.json" <<'EOF'
{"coolify": [{"name": "home", "url": "https://coolify.example.com/"}, {"name": "plain", "url": "http://insecure.example.com"},
             {"name": "Bad_Name", "url": "https://x.example.com"}, {"name": "path", "url": "https://x.example.com/api"}]}
EOF
cp "$t/settings.json" "$t/state/settings.json"
cat >"$t/projects.json" <<'EOF'
[{"name": "demo", "repo": "example/repo", "posthog_project_id": "1", "posthog_key_env": "POSTHOG_API_KEY_DEMO",
  "posthog_ui": "https://eu.posthog.com/project/1", "notes": "n", "scouts": ["coolify"],
  "coolify": [{"instance": "home", "app_uuid": "app11111aaaa"}, {"instance": "home", "app_uuid": "bad uuid"}, {"instance": "Bad", "app_uuid": "app22222bbbb"}]}]
EOF
export PATH=$t/bin:$PATH
export STATE_ROOT=$t/state INBOX_ROOT=$t/inbox SECRETS_ROOT=$t/secrets PROJECTS_FILE=$t/projects.json WORK_ROOT=$t/work
export POSTHOG_API_KEY_DEMO=demo-key-value-1 GH_TOKEN=fake-gh-value HERMES_WEBHOOK_URL='' MODE=dry
unset GITHUB_TOKEN SENTRY_TOKEN || true
# shellcheck source=/dev/null
source "$root/bin/lib.sh"
# shellcheck source=/dev/null
source "$root/bin/coolify.sh"

echo "== Instances and keys"
check "only valid https instances without a path are used" test "$(coolify_instances | jq -c '[.[].name]')" = '["home"]'
check "the trailing slash is removed" test "$(coolify_instances | jq -r '.[0].url')" = "https://coolify.example.com"
check "the key of an instance" test "$(coolify_key home-lab)" = COOLIFY_TOKEN_HOME_LAB
check "the name of a key" test "$(coolify_name COOLIFY_TOKEN_HOME_LAB)" = home-lab
check "the key is allowed" secret_key_ok COOLIFY_TOKEN_HOME
check "a lower case key is refused" bash -c "source '$root/bin/lib.sh'; ! secret_key_ok COOLIFY_TOKEN_home"
scrubbed=$(printf 'a %s b\nAuthorization: Bearer %s\n%s=%s\nkeep this\n' "$tok_read" "$(rep b 26)" pass"word" "$(rep h 12)" | COOLIFY_TOKEN_HOME=$tok_read scrub_secrets)
check "the scrub removes a token, a Bearer value and a password" bash -c "[[ \$1 != *rrrrrrrrrrrr* && \$1 != *bbbbbbbbbbbb* && \$1 != *hhhhhhhhhhhh* && \$1 == *'keep this'* ]]" _ "$scrubbed"

echo "== Secret shapes"
# Each shape is built at run time from parts. s1 prints the scrub of one line. hit1 succeeds when secret_hit finds the line.
s1() { printf '%s\n' "$1" | scrub_secrets; }
hit1() { printf '%s\n' "$1" >"$t/hit.txt"; secret_hit "$t/hit.txt"; }
nohit1() { ! hit1 "$1"; }
a20=$(rep a 20)
b36=$(rep b 36)
shapes=(
	"AWS_SECRET_ACCESS_KEY=$(rep q 20)"
	"STRIPE_SECRET_KEY=$(rep q 20)"
	"SECRET_KEY=$(rep q 20)"
	"x sk_li""ve_$a20 y"
	"x sk_te""st_$a20 y"
	"x rk_li""ve_$a20 y"
	"x xox""b-123456789012-$a20"
	"id AK""IA$(rep A 16)"
	"id AS""IA$(rep A 16)"
	"t np""m_$b36"
	"t glp""at-$a20"
	"Cookie: sid=$a20; theme=dark"
	"Set-Cookie: sid=$a20; Path=/; HttpOnly"
	"j ey""J$(rep a 20).ey""J$(rep b 20).$(rep c 20)"
	"u https://admin:$a20@db.example.com/x"
	"{\"api_key\": \"$a20\"}"
	"DB_PASSPHRASE: $a20"
	"MY_CREDENTIAL=$a20"
)
for line in "${shapes[@]}"; do
	out=$(s1 "$line")
	check "the scrub removes: ${line:0:22}" bash -c "[[ \$1 == *'[removed]'* && \$1 != *aaaaaaaaaaaa* && \$1 != *bbbbbbbbbbbb* && \$1 != *qqqqqqqqqqqq* && \$1 != *AAAAAAAAAAAA* && \$1 != *cccccccccccc* ]]" _ "$out"
	check "secret_hit finds: ${line:0:22}" hit1 "$line"
done
pem=$(printf '%s\n' "-----BEGIN RSA PRIVATE KEY-----" "$(rep M 30)" "$(rep N 30)" "-----END RSA PRIVATE KEY-----" "after the key")
out=$(printf '%s\nbefore\n' "$pem" | scrub_secrets)
check "the scrub removes a PEM block with its body" bash -c "[[ \$1 != *MMMMMMMMMM* && \$1 != *NNNNNNNNNN* && \$1 != *PRIVATE* && \$1 == *'after the key'* ]]" _ "$out"
check "secret_hit finds a PEM header" hit1 "-----BEGIN OPENSSH PRIVATE KEY-----"
out=$(printf -- '-----BEGIN EC PRIVATE KEY-----\n%s\n' "$(rep M 30)" | scrub_secrets)
check "the scrub removes a PEM block with no end line" bash -c "[[ \$1 != *MMMMMMMMMM* ]]" _ "$out"
for line in 'level=info msg=started' 'token count: 5' 'passed: 5' 'GET /index.html 200'; do
	check "the scrub keeps: $line" test "$(s1 "$line")" = "$line"
	check "secret_hit passes: $line" nohit1 "$line"
done
check "a name with key keeps its name" test "$(s1 'api_key=abcdefgh')" = "api_key=[removed]"
check "the rest of a query string stays" test "$(s1 'GET /a?token=xyz&b=2')" = "GET /a?token=[removed]&b=2"
check "an empty value list does not empty the log" bash -c "source '$root/bin/lib.sh'; unset GH_TOKEN GITHUB_TOKEN; secret_names() { :; }; [[ \$(printf 'a\nb\n' | scrub_secrets | wc -l) == 2 ]]"

echo "== Types and caps of the Coolify data"
cat >"$t/odd.json" <<'EOF'
[{"uuid": "odd11111aaaa", "name": 5, "git_repository": 7, "fqdn": ["x"], "status": {"a": 1}, "health_check_enabled": "yes", "limits_memory": {"x": 1}, "restart_count": "3"},
 {"uuid": "good2222bbbb", "name": "ok\u001b[31mname", "git_repository": "example/repo", "fqdn": "https://x.example.com", "status": "running:healthy"},
 {"uuid": "long3333cccc", "name": "LONGNAMEX", "git_repository": "example/repo", "ports_exposes": "LONGPORTX"}]
EOF
sed -i "s/LONGNAMEX/$(rep n 500)/; s/LONGPORTX/$(rep p 900)/" "$t/odd.json"
coolify_apps_brief "$t/odd.json" >"$t/brief.json"
coolify_app_detail "$t/odd.json" long3333cccc >"$t/det-long.json"
coolify_app_detail "$t/odd.json" odd11111aaaa >"$t/det-odd.json"
printf '%s' '{"deployments": [{"commit_message": "a\u0007b\nsecond", "status": 5}, "junk"]}' >"$t/d1.json"
coolify_deployments "$t/d1.json" >"$t/deps1.json"
check "one app with wrong types does not fail the list" jq -e 'length == 3' "$t/brief.json"
check "the wrong types become empty values" jq -e '.[0] | .name == "" and .repo == null and .fqdn == "" and .status == ""' "$t/brief.json"
check "the name has no control character and is capped" jq -e '.[1].name == "ok [31mname" and (.[2].name | length) == 120' "$t/brief.json"
check "the detail has capped fields" jq -e '(.ports.exposes | length) == 200 and .health_check.enabled == null' "$t/det-long.json"
check "a wrong type in the detail gives null" jq -e '.health_check.enabled == null and .limits.memory == null and .restart.count == "3"' "$t/det-odd.json"
check "the commit message has no control character, a wrong type gives null" jq -e 'length == 1 and .[0].commit_message == "a b" and .[0].status == null' "$t/deps1.json"

echo "== Large error output"
mkdir -p "$t/shapes/logs"
{ for i in $(seq 1 100); do printf 'ERROR line %d %s\n' "$i" "$(rep e 2400)"; done; } >"$t/shapes/logs/big.log"
jq -nc '{log_file: "logs/big.log"}' >"$t/shapes/app-x.json"
coolify_shapes "$t/shapes"
check "error_lines over 200 KB are kept" jq -e '(.error_lines | length) > 200000 and (.error_shapes | length == 64)' "$t/shapes/app-x.json"

echo "== Token check in the inbox"
put_token() { printf '{"value": "%s"}' "$2" >"$INBOX_ROOT/$1.json"; }
inbox() { "$root/bin/inbox.sh" >"$t/inbox.out" 2>&1 || { tail -5 "$t/inbox.out" >&2; bad "inbox.sh exit"; }; }
st() { jq -r --arg k "$1" '.[$k].state' "$INBOX_ROOT/status.json"; }
put_token COOLIFY_TOKEN_HOME "$tok_bad"
put_token COOLIFY_TOKEN_NOPE "$tok_read"
put_token COOLIFY_TOKEN_lower "$tok_read"
inbox
check "a refused token is invalid" test "$(st COOLIFY_TOKEN_HOME)" = invalid
check "an unknown instance is invalid" test "$(st COOLIFY_TOKEN_NOPE)" = invalid
check "an invalid token is not saved" bash -c "! grep -q COOLIFY '$SECRETS_ROOT/overrides.env' 2>/dev/null"
check "a bad key is not listed" bash -c "! jq -e 'has(\"COOLIFY_TOKEN_lower\")' '$INBOX_ROOT/status.json'"
jq -nc --arg v "ab\"cdefghij" '{value: $v}' >"$INBOX_ROOT/COOLIFY_TOKEN_HOME.json"
inbox
check "a token with a quote is refused and not saved" bash -c "[[ \$(jq -r '.COOLIFY_TOKEN_HOME.detail' '$INBOX_ROOT/status.json') == *quote* ]] && ! grep -q 'cdefghij' '$SECRETS_ROOT/overrides.env' 2>/dev/null"
put_token COOLIFY_TOKEN_HOME "$tok_write"
inbox
check "a token that can write gets a warning" test "$(st COOLIFY_TOKEN_HOME)" = warn
check "the warning says write" bash -c "[[ \$(jq -r '.COOLIFY_TOKEN_HOME.detail' '$INBOX_ROOT/status.json') == *'can write'* ]]"
check "a token with a warning is saved" grep -q "^COOLIFY_TOKEN_HOME=" "$SECRETS_ROOT/overrides.env"
put_token COOLIFY_TOKEN_HOME "$tok_nosens"
inbox
check "a token without read:sensitive works and says it lacks logs" bash -c "[[ \$(jq -r '.COOLIFY_TOKEN_HOME | .state + \":\" + .detail' '$INBOX_ROOT/status.json') == ok:*'cannot read logs'* ]]"
put_token COOLIFY_TOKEN_HOME "$tok_read"
inbox
check "a read token with read:sensitive works" bash -c "[[ \$(jq -r '.COOLIFY_TOKEN_HOME | .state + \":\" + .detail' '$INBOX_ROOT/status.json') == ok:*read:sensitive* ]]"
check "the status has no token value" bash -c "! grep -q '$body_read' '$INBOX_ROOT/status.json'"
check "the token is in overrides.env only" bash -c "grep -q '$body_read' '$SECRETS_ROOT/overrides.env' && ! grep -rl '$body_read' '$INBOX_ROOT'"
check "the instance is in the key list" jq -e 'has("COOLIFY_TOKEN_HOME")' "$INBOX_ROOT/status.json"

echo "== Discovery"
"$root/bin/discover.sh" >"$t/disc.out" 2>&1 || { tail -5 "$t/disc.out" >&2; bad "discover.sh exit"; }
d=$INBOX_ROOT/discovery.json
check "the instance is listed and ok" jq -e '.coolify[0] | .name == "home" and .ok == true and .url == "https://coolify.example.com"' "$d"
check "four apps are listed" jq -e '.coolify[0].apps | length == 4' "$d"
check "the repository is owner/name for each form" jq -e '[.coolify[0].apps[] | {(.name): .repo}] | add == {web: "example/repo", cache: null, api: "example/other", site: "example/site"}' "$d"
check "an app has name, uuid, fqdn and status" jq -e '.coolify[0].apps[0] | .uuid == "app11111aaaa" and .fqdn == "https://web.example.com" and .status == "running:healthy"' "$d"
check "the file has no secret field and no token" bash -c "! grep -qE 'must-not-leak|$body_read|compose|basic' '$d'"
check "the plain http instance is not called" bash -c "! grep -q insecure '$CURL_CALLS'"
check "no token is in argv" bash -c "! grep -qE 'rrrrrrrrrrrr|wwwwwwwwwwww|nnnnnnnnnnnn' '$CURL_ARGV'"
cp "$SECRETS_ROOT/overrides.env" "$t/overrides.keep"
rm -f "$SECRETS_ROOT/overrides.env"
touch "$INBOX_ROOT/discover.request"
"$root/bin/discover.sh" >"$t/disc2.out" 2>&1 || true
check "without a token the instance is not ok and says why" jq -e '.coolify[0] | .ok == false and (.detail | contains("COOLIFY_TOKEN_HOME"))' "$d"
cp "$t/overrides.keep" "$SECRETS_ROOT/overrides.env"

echo "== Runner"
cat >"$t/bin/claude" <<'EOF'
#!/usr/bin/env bash
here=$(dirname "$0")
echo x >>"$here/claude.log"
cp "$STATE_DIR/coolify.json" "$here/claude.copy"
mkdir -p "$here/claude.copy.logs" && cp "$STATE_DIR"/coolify-logs/* "$here/claude.copy.logs/"
env | grep -c COOLIFY_TOKEN >"$here/claude.copy.env" || true
jq -nc '{is_error: false, result: "{\"summary\": \"stub\", \"findings\": []}", num_turns: 2, total_cost_usd: 0.01}'
EOF
chmod +x "$t/bin/claude"
export CLAUDE_LOG=$t/bin/claude.log CLAUDE_COPY=$t/bin/claude.copy
: >"$CLAUDE_LOG"
runs=$STATE_ROOT/runs.jsonl
run() { "$root/bin/run-scout.sh" demo coolify >"$t/$1.out" 2>&1 || { tail -8 "$t/$1.out" >&2; bad "run-scout exit $1"; }; }
claude_runs() { wc -l <"$CLAUDE_LOG"; }
: >"$CURL_ARGV"

run a
check "the agent runs one time" test "$(claude_runs)" = 1
check "the agent has one valid application (the bad links are skipped)" jq -e '.apps | length == 1 and .[0].name == "web" and .[0].repo == "example/repo"' "$CLAUDE_COPY"
check "the agent sees the deployments, the health check and the limits" jq -e '.apps[0] | (.deployments | length == 2 and .[0].status == "failed" and .[0].commit_message == "Fix the build") and .health_check.enabled == false and .limits.memory == "0" and .restart.count == 3 and .restart_policy == "unless-stopped"' "$CLAUDE_COPY"
check "the data has no secret field and no build log" bash -c "! grep -qE 'must-not-leak|SECRETENV|$body_read|compose|basic' '$CLAUDE_COPY'"
check "the agent environment has no Coolify token" test "$(cat "$CLAUDE_COPY.env")" = 0
log=$(ls "$CLAUDE_COPY".logs/*.log)
check "the log keeps at most 2000 lines" test "$(wc -l <"$log")" -le 2000
check "the log keeps at most 256 KB" test "$(wc -c <"$log")" -le 262144
check "the log keeps the last lines" grep -q "ERROR: connection refused" "$log"
check "the log has no colour code" bash -c "! grep -q \$'\\033' '$log'"
check "the log has no token, no key, no Bearer value and no password" bash -c "! grep -qE 'rrrrrrrrrrrr|ghp_|bbbbbbbbbbbb|hhhhhhhhhhhh' '$log'"
check "the data lists the error lines" jq -e '.apps[0].error_lines | contains("ERROR: connection refused")' "$CLAUDE_COPY"
check "no token is in argv" bash -c "! grep -qE 'rrrrrrrrrrrr' '$CURL_ARGV'"
check "every request is a GET" bash -c "! grep -q 'NOT A GET' '$CURL_ARGV'"
check "the log request asks for 2000 lines" grep -q "logs?lines=2000" "$CURL_CALLS"
check "the seen file holds a digest" jq -e '.digest | length == 64' "$STATE_ROOT/demo/coolify.seen.json"

run b
check "the same data does not start the agent" test "$(claude_runs)" = 1
check "the run is ok with the reason" test "$(tail -n 1 "$runs" | jq -r '.status + ":" + .summary')" = "ok:Nothing changed on Coolify since the last run."

jq 'map(if .uuid == "app11111aaaa" then .last_online_at = "2026-01-05 10:00:00" else . end)' "$APPS_JSON" >"$t/apps.tmp" && mv "$t/apps.tmp" "$APPS_JSON"
run c
check "a new last_online_at alone does not start the agent" test "$(claude_runs)" = 1

printf '2026-02-01 FATAL: out of memory, process killed\n' >>"$LOG_TXT"
run d
check "a new kind of error line starts the agent" test "$(claude_runs)" = 2

printf '2026-02-02 info request 9999 ok\n' >>"$LOG_TXT"
run e
check "a new normal log line does not start the agent" test "$(claude_runs)" = 2

jq '.deployments[0].status = "finished"' "$DEP_JSON" >"$t/dep.tmp" && mv "$t/dep.tmp" "$DEP_JSON"
run f
check "a new deployment status starts the agent" test "$(claude_runs)" = 3

echo "== URL binding"
: >"$CURL_CALLS"
jq '.coolify[0].url = "https://other.example.com"' "$t/settings.json" >"$STATE_ROOT/settings.json"
code=$(load_overrides; coolify_get home /api/v1/teams/current "$t/none.out" || true)
check "a changed URL alone gets no request and no token" bash -c "[[ $code == 000 ]] && [[ ! -s '$CURL_CALLS' ]]"
cp "$t/settings.json" "$STATE_ROOT/settings.json"
code=$(load_overrides; coolify_get home /api/v1/teams/current "$t/none.out")
check "the saved URL works again" test "$code" = 200

echo "== Errors"
jq 'map(if .uuid == "app11111aaaa" then .status = "restarting:unhealthy" else . end)' "$APPS_JSON" >"$t/apps.tmp" && mv "$t/apps.tmp" "$APPS_JSON"
sed -i 's/^COOLIFY_TOKEN_HOME=.*/COOLIFY_TOKEN_HOME=bad-token-value-1/' "$SECRETS_ROOT/overrides.env"
if "$root/bin/run-scout.sh" demo coolify >"$t/g.out" 2>&1; then bad "a refused token must fail the run"; else ok "a refused token fails the run"; fi
check "the failed run is an error record" test "$(tail -n 1 "$runs" | jq -r .status)" = error
check "the agent did not start" test "$(claude_runs)" = 3
cp "$t/overrides.keep" "$SECRETS_ROOT/overrides.env"
jq 'del(.[0].coolify)' "$t/projects.json" >"$t/p.tmp" && cp "$t/p.tmp" "$STATE_ROOT/projects.json"
run h
check "a project with no link skips the run" test "$(tail -n 1 "$runs" | jq -r '.status + ":" + .summary')" = "ok:No Coolify application is linked to this project."

if ((fails == 0)); then echo "all passed"; else echo "$fails failed"; exit 1; fi
