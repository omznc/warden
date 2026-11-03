#!/usr/bin/env bash
# Sync the GitHub state of the submitted items (issue, comment, pr, pr-update) into meta.json.
# Usage: sync-github.sh
# Fields written: gh_state (open|closed|merged), gh_state_reason, gh_state_at, synced_at. The field status stays.
# A comment item tracks its parent issue. One gh call for each item. A failed repo is skipped.
# A merged item, and an item that was closed more than 7 days ago, are not read again.
# run-all.sh starts this script at most one time in 10 minutes.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
STATE_ROOT=${STATE_ROOT:-/tmp/warden-state}
WORK_ROOT=${WORK_ROOT:-/tmp/warden-work}
shopt -s nullglob
# shellcheck source=/dev/null
source "$root/bin/lib.sh"
load_overrides
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
stale=$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)
declare -A failed

kind_name() { case $1 in pr) echo "PR" ;; pr-update) echo "PR update" ;; *) echo "${1^}" ;; esac; }

for meta in "$STATE_ROOT"/*/pending/*/meta.json; do
	[[ $(jq -r '.status' "$meta" 2>/dev/null) == submitted ]] || continue
	url=$(jq -r '.url // empty' "$meta")
	[[ $url =~ ^https://github\.com/([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)/(issues|pull)/([0-9]+)$ ]] || continue
	repo=${BASH_REMATCH[1]}
	n=${BASH_REMATCH[3]}
	[[ -z ${failed[$repo]:-} ]] || continue
	[[ $(jq -r '.gh_state // ""' "$meta") != merged ]] || continue
	# A closed item that stayed closed for 7 days is final: stop the polling.
	jq -e --arg c "$stale" '.gh_state == "closed" and ((.gh_state_at // "") != "") and .gh_state_at < $c' "$meta" >/dev/null 2>&1 && continue
	if ! info=$(gh api "repos/$repo/issues/$n" 2>/dev/null) || ! jq -e '.state' <<<"$info" >/dev/null 2>&1; then
		echo "sync-github: cannot read $repo, skipped" >&2
		failed[$repo]=1
		continue
	fi
	new=$(jq -c --arg now "$now" '
	  (if .pull_request.merged_at != null then "merged" elif .state == "closed" then "closed" else "open" end) as $s
	  | {gh_state: $s, gh_state_reason: (if $s == "closed" then .state_reason else null end),
	     gh_state_at: (if $s == "merged" then .pull_request.merged_at elif $s == "closed" then .closed_at else .updated_at end),
	     synced_at: $now}' <<<"$info")
	old=$(jq -r '.gh_state // "open"' "$meta")
	# Read the file again for the write, so that a write of the UI since the read is kept.
	if jq --argjson n "$new" '. + $n' "$meta" >"$meta.tmp"; then mv "$meta.tmp" "$meta"; else continue; fi
	state=$(jq -r '.gh_state' <<<"$new")
	if [[ $old == open && $state != open ]]; then
		kind=$(jq -r '.kind // "pr"' "$meta")
		"$root/bin/notify.sh" "warden: $(kind_name "$kind") $state: $(jq -r '.title' "$meta") $url" || true
		if [[ $state == merged && $kind == pr ]]; then
			proj=$(jq -r '.project' "$meta")
			fp=$(jq -r '.fingerprint' "$meta")
			if [[ $proj =~ ^[a-z0-9][a-z0-9-]*$ && $fp =~ ^[a-z0-9][a-z0-9-]*$ && -d $WORK_ROOT/$proj/.git ]]; then
				gitc -C "$WORK_ROOT/$proj" branch -D "warden/$fp" >/dev/null 2>&1 || true
			fi
		fi
	fi
done
exit 0
