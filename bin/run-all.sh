#!/usr/bin/env bash
# Scheduler loop. Usage: run-all.sh [<project> <scout>]
# ONCE=1 runs one pass at once and exits. INTERVAL_HOURS (default 12) sets the gap between passes.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
STATE_ROOT=${STATE_ROOT:-/tmp/warden-state}
export STATE_ROOT
mkdir -p "$STATE_ROOT"
stamp=$STATE_ROOT/last-run
interval=$((${INTERVAL_HOURS:-12} * 3600))

# shellcheck source=/dev/null
source "$root/bin/lib.sh"

pass() {
	local p s runs=0 failed=0
	if (($# == 2)); then
		"$root/bin/run-scout.sh" "$1" "$2" || echo "run failed: $1 $2" >&2
		return
	fi
	while IFS=$'\t' read -r p s; do
		# </dev/null: claude and gh read stdin and would eat the rest of the project list.
		runs=$((runs + 1))
		"$root/bin/run-scout.sh" "$p" "$s" </dev/null || { failed=$((failed + 1)); echo "run failed: $p $s" >&2; }
		# An approval or a run request must not wait for the whole pass.
		"$root/bin/submit-approved.sh" </dev/null || echo "submit-approved failed" >&2
		handle_requests
	done < <(projects_json | jq -r '.[] | select(.enabled != false) | .name as $n | .scouts[] | [$n, .] | @tsv')
	pass_alarm "$runs" "$failed"
}

# pass_alarm <runs> <failed>: one notice when more than half of the runs in a pass failed.
pass_alarm() {
	(($1 > 0 && $2 * 2 > $1)) || return 0
	"$root/bin/notify.sh" "warden: $2 of $1 runs failed in this pass" || true
}

if [[ -n ${ONCE:-} || $# -eq 2 ]]; then
	pass "$@"
	exit 0
fi

projects_file >/dev/null
clean_running
# The volumes can come from an older image: fix the modes and the world-write bits one time at the start.
harden_dirs
while true; do
	# Fix the modes at each loop. Skip the walk over all files: run-scout.sh does it for one project.
	harden_dirs --quick
	# Short loop chunk: an approval in the UI becomes a draft PR within about a minute.
	"$root/bin/inbox.sh" || echo "inbox failed" >&2
	"$root/bin/discover.sh" || echo "discover failed" >&2
	"$root/bin/submit-approved.sh" || echo "submit-approved failed" >&2
	tests_gc
	# Sync the GitHub state at most one time in 10 minutes.
	if (($(date +%s) - $(cat "$STATE_ROOT/last-sync" 2>/dev/null || echo 0) >= 600)); then
		date +%s >"$STATE_ROOT/last-sync"
		"$root/bin/sync-github.sh" </dev/null || echo "sync-github failed" >&2
	fi
	handle_requests
	# One summary in 7 days. Write the stamp first, as for the sync.
	if (($(date +%s) - $(cat "$STATE_ROOT/last-weekly" 2>/dev/null || echo 0) >= 604800)); then
		date +%s >"$STATE_ROOT/last-weekly"
		"$root/bin/weekly.sh" </dev/null || echo "weekly failed" >&2
	fi
	last=$(cat "$stamp" 2>/dev/null || echo 0)
	if (($(date +%s) - last >= interval)); then
		# Write the stamp first. A crash or power reset then cannot cause a burst of runs.
		date +%s >"$stamp"
		pass
	fi
	sleep 60
done
