#!/usr/bin/env bash
# Check the signer against a fixed HMAC-SHA256 vector (computed once with openssl).
# Secret s3cret, timestamp 1700000000, body {"text":"hello \"world\""}.
set -euo pipefail
here=$(dirname "$0")
want=676ffda55f881d728ef02d7e05493856ced14177ed57a7ef4e148f38a255169c
body=$(mktemp)
trap 'rm -f "$body"' EXIT
printf '%s' '{"text":"hello \"world\""}' >"$body"
got=$("$here/notify.sh" --sign s3cret 1700000000 "$body")
[[ $got == "$want" ]] || { echo "FAIL: got=$got want=$want"; exit 1; }
echo "OK: $got"
