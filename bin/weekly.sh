#!/usr/bin/env bash
# Send one notice with the counts of the last 7 days and a review link for each item that waits.
# Usage: weekly.sh
# The notice has counts and links only: no title, no body, no error text.
# Cost comes from runs.jsonl (the ledger.json files hold issue numbers, not cost).
# run-all.sh starts this script at most one time in 7 days.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
STATE_ROOT=${STATE_ROOT:-/tmp/warden-state}
shopt -s nullglob
# shellcheck source=/dev/null
source "$root/bin/lib.sh"
cut=$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)
url=$(warden_url)
max_links=20

metas=("$STATE_ROOT"/*/pending/*/meta.json)
counts='{}'
if ((${#metas[@]})); then
	# SC2016: the jq program uses $ variables on purpose.
	# shellcheck disable=SC2016
	counts=$(jq -sc --arg c "$cut" '
	  def since(f): (f // "") >= $c and (f // "") != "";
	  {new: ([.[] | select(since(.created))] | length),
	   submitted: ([.[] | select(since(.submitted_at))] | length),
	   merged: ([.[] | select(.gh_state == "merged" and since(.gh_state_at))] | length),
	   closed: ([.[] | select(.gh_state == "closed" and since(.gh_state_at))] | length),
	   rejected: ([.[] | select(since(.decided_at) and .status == "rejected")] | length),
	   stale: ([.[] | select(since(.stale_at))] | length)}' "${metas[@]}" 2>/dev/null || echo '{}')
fi
n() { jq -r --arg k "$1" '.[$k] // 0' <<<"$counts"; }

cost=0
# shellcheck disable=SC2016
[[ ! -f $STATE_ROOT/runs.jsonl ]] || cost=$(jq -rs --arg c "$cut" '[.[] | select((.started // "") >= $c) | .cost_usd // 0] | add // 0' "$STATE_ROOT/runs.jsonl" 2>/dev/null || echo 0)

links=
waiting=0
for m in "${metas[@]}"; do
	[[ $(jq -r '.status' "$m" 2>/dev/null) == pending ]] || continue
	waiting=$((waiting + 1))
	[[ -z $url ]] || ((waiting > max_links)) || links+="$url/review/$(basename "$(dirname "$m")")"$'\n'
done
[[ -z $url ]] || ((waiting <= max_links)) || links+="and $((waiting - max_links)) more"$'\n'

text=$(printf 'warden: weekly summary (7 days)\nNew: %s, submitted: %s, merged: %s, closed: %s, rejected: %s, stale: %s\nCost: %.2f usd\nWaiting for review: %s' \
	"$(n new)" "$(n submitted)" "$(n merged)" "$(n closed)" "$(n rejected)" "$(n stale)" "$cost" "$waiting")
[[ -z $links ]] || text+=$'\n'${links%$'\n'}
"$root/bin/notify.sh" "$text" || true
exit 0
