#!/usr/bin/env bash
# Send a text to the Hermes webhook. Signature: HMAC-SHA256 V2.
# Usage: notify.sh "<text>"   or   notify.sh --sign <secret> <timestamp> <body-file>
# The URL in settings.json (hermes_webhook_url) wins over the env HERMES_WEBHOOK_URL.
# NOTIFY_STATUS_FILE=<file>: write the HTTP status (or none, nosecret, 000) to the file. Print no answer.
set -euo pipefail
# A traced run must not print the webhook secret.
{ set +x; } 2>/dev/null

sign() { # secret timestamp body-file
	{ printf '%s.' "$2"; cat "$3"; } | openssl dgst -sha256 -hmac "$1" -r | cut -d' ' -f1
}

if [[ ${1:-} == --sign ]]; then
	sign "$2" "$3" "$4"
	exit 0
fi

text=${1:?usage: notify.sh "<text>"}
root=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=/dev/null
source "$root/bin/lib.sh"
load_overrides
status_file=${NOTIFY_STATUS_FILE:-}
# fail <status>: record the status for the test and stop.
fail() {
	[[ -z $status_file ]] || printf '%s' "$1" >"$status_file"
	exit 1
}

url=$(hermes_url)
if [[ -z $url ]]; then
	[[ -z $status_file ]] || fail none
	printf '%s\n' "$text"
	exit 0
fi
[[ -z $status_file || -n ${HERMES_WEBHOOK_SECRET:-} ]] || fail nosecret

body=$(mktemp)
trap 'rm -f "$body"' EXIT
jq -nj --arg text "$text" '{text: $text}' >"$body"
ts=$(date +%s)
sig=$(sign "${HERMES_WEBHOOK_SECRET:?HERMES_WEBHOOK_SECRET is not set}" "$ts" "$body")
args=(-X POST "$url" -H 'Content-Type: application/json' -H "X-Webhook-Timestamp: $ts" -H "X-Webhook-Signature-V2: $sig" --data-binary @"$body")
if [[ -n $status_file ]]; then
	# The answer body and the curl error text are dropped. Only the status code stays.
	code=$(curl -s --connect-timeout 5 --max-time 10 -o /dev/null -w '%{http_code}' "${args[@]}" 2>/dev/null) || code=000
	printf '%s' "$code" >"$status_file"
	[[ $code == 2?? ]]
else
	curl -fsS --connect-timeout 5 --max-time 10 "${args[@]}"
fi
