#!/usr/bin/env bash
# Test of the Hermes test notice and of the URLs in settings.json. Uses a stub curl. No network.
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

secret=hermes-test-secret-value-1
export STATE_ROOT=$t/state SECRETS_ROOT=$t/secrets PATH=$t/bin:$PATH CURL_LOG=$t/curl.log
export HERMES_WEBHOOK_URL=https://env.example/hook HERMES_WEBHOOK_SECRET=$secret WARDEN_URL=https://env-warden.example
mkdir -p "$t/bin" "$STATE_ROOT/requests" "$SECRETS_ROOT"
# The stub prints the status that CURL_CODE holds after the option -w. It writes the arguments to the log.
cat >"$t/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$CURL_LOG"
echo "SECRET BODY FROM SERVER" >&2
[[ ${CURL_CODE:-200} != 000 ]] || exit 7
if [[ " $* " == *" -w "* ]]; then printf '%s' "${CURL_CODE:-200}"; else echo "SECRET BODY FROM SERVER"; fi
EOF
chmod +x "$t/bin/curl"
# shellcheck source=/dev/null
source "$root/bin/lib.sh"

result() { jq -r "$1" "$STATE_ROOT/notify-test.json"; }
run_test() { # status
	: >"$CURL_LOG"
	echo '{}' >"$STATE_ROOT/requests/notify-test.json"
	CURL_CODE=$1 handle_requests >"$t/out.txt" 2>&1 || true
}

echo "== The test request"
run_test 200
check "the request is removed" test ! -e "$STATE_ROOT/requests/notify-test.json"
check "status 200 is ok" test "$(result '.ok')" = true -a "$(result '.status')" = 200
check "the call goes to the env URL" grep -q 'https://env.example/hook' "$CURL_LOG"
check "the signature header is sent" grep -q 'X-Webhook-Signature-V2: ' "$CURL_LOG"
check "the secret is not in the curl arguments" bash -c "! grep -qF -- '$secret' '$CURL_LOG'"
check "no body or error text in the output" bash -c "! grep -q 'SECRET BODY' '$t/out.txt' '$STATE_ROOT/notify-test.json'"
check "the result file has no secret" bash -c "! grep -qF -- '$secret' '$STATE_ROOT/notify-test.json'"
run_test 401
check "status 401 is an error with the code" test "$(result '.ok')" = false -a "$(result '.status')" = 401
run_test 000
check "no answer gives 000" test "$(result '.ok')" = false -a "$(result '.status')" = 000
check "no body or error text on a failure" bash -c "! grep -q 'SECRET BODY' '$t/out.txt' '$STATE_ROOT/notify-test.json'"
(unset HERMES_WEBHOOK_SECRET; run_test 200; result '.status' >"$t/s1")
check "no secret gives nosecret" test "$(cat "$t/s1")" = nosecret
(HERMES_WEBHOOK_URL=''; run_test 200; result '.status' >"$t/s2")
check "no URL gives none" test "$(cat "$t/s2")" = none
check "no URL sends nothing" test ! -s "$CURL_LOG"
printf 'HERMES_WEBHOOK_SECRET=from-overrides-secret-2\n' >"$SECRETS_ROOT/overrides.env"
(unset HERMES_WEBHOOK_SECRET; run_test 200; result '.ok' >"$t/s3")
check "the secret comes from overrides.env" test "$(cat "$t/s3")" = true
check "the overrides secret is not in the curl arguments" bash -c "! grep -qF -- from-overrides-secret-2 '$CURL_LOG'"

echo "== URLs in settings.json"
echo '{"hermes_webhook_url": "https://settings.example/hook", "warden_url": "https://ui.example/"}' >"$STATE_ROOT/settings.json"
run_test 200
check "settings.json wins over the env URL" grep -q 'https://settings.example/hook' "$CURL_LOG"
check "the env URL is not called" bash -c "! grep -q env.example '$CURL_LOG'"
check "warden_url wins over WARDEN_URL and drops the slash" test "$(warden_url)" = https://ui.example
for bad_url in 'ftp://x.example/a' 'https://u:p@x.example/' 'https://x.example/a b' 'javascript:alert(1)' "https://$(printf 'a%.0s' {1..600}).example/"; do
	jq -n --arg u "$bad_url" '{hermes_webhook_url: $u, warden_url: $u}' >"$STATE_ROOT/settings.json"
	run_test 200
	check "a bad URL falls back to the env URL (${bad_url:0:30})" bash -c "grep -q 'https://env.example/hook' '$CURL_LOG' && test \"\$(source '$root/bin/lib.sh'; warden_url)\" = https://env-warden.example"
done
echo 'not json' >"$STATE_ROOT/settings.json"
check "a broken settings.json falls back to the env value" test "$(warden_url)" = https://env-warden.example
rm -f "$STATE_ROOT/settings.json"
check "no settings.json falls back to the env value" test "$(warden_url)" = https://env-warden.example

echo "== The sign mode and the plain mode"
check "plain mode still prints the answer of the old call" bash -c "CURL_CODE=200 '$root/bin/notify.sh' hi | grep -q 'SECRET BODY'"
check "the sign vector is unchanged" bash -c "'$root/bin/test-notify.sh' | grep -q '^OK'"

if ((fails == 0)); then echo "all passed"; else echo "$fails failed"; exit 1; fi
