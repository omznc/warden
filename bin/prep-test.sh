#!/usr/bin/env bash
# Prepare a test job for the tester service. Usage: prep-test.sh <project> <id> <checkout> <pending-dir>
# Only a project with test_command in projects.json gets a job. The install step has network and runs only code
# of the base commit, with no script. The tester service runs the tests later, without network and without secrets.
# The runner writes only into TESTS_IN. A job that cannot run gets a queue file with a "preset" result:
# the tester writes the result file in TESTS_OUT.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
STATE_ROOT=${STATE_ROOT:-/tmp/warden-state}
T=${TESTS_IN:-/tests-in}
# shellcheck source=/dev/null
source "$root/bin/lib.sh"
# The tester runs as another user and reads TESTS_IN.
umask 022
proj=${1:?usage: prep-test.sh <project> <id> <checkout> <pending-dir>}
id=${2:?}
checkout=${3:?}
pd=${4:?}
[[ $proj =~ ^[a-z0-9][a-z0-9-]*$ && $id =~ ^[a-z0-9][a-z0-9-]*$ ]] || exit 1

cfg=$(project_cfg "$proj")
cmd=$(jq -r '.test_command // empty' <<<"$cfg")
[[ -n $cmd ]] || exit 0
install=$(jq -r '.test_install // "bun install --frozen-lockfile --ignore-scripts"' <<<"$cfg")
base=$(jq -r '.base_sha // empty' "$pd/meta.json")
[[ $base =~ ^[0-9a-f]{40}$ ]] || exit 1
work=$T/work/$proj/$id
queue=$T/queue/${proj}__$id.json
logf=$(mktemp)
trap 'rm -f "$logf" "$logf.t"' EXIT
safe_rm "$work" || exit 1
mkdir -p "$work/home" "$T/queue"

result() { # status reason; a status other than queued is a preset result for the tester
	local preset=null
	if [[ $1 != queued ]]; then
		preset=$(jq -nc --arg s "$1" --arg r "$2" --rawfile t "$logf" '{status: $s, reason: $r, output_tail: $t}')
		safe_rm "$work"
	fi
	jq -nc --arg p "$proj" --arg i "$id" --arg c "$cmd" --argjson pre "$preset" \
		'{project: $p, id: $i, command: $c} + (if $pre == null then {} else {preset: $pre} end)' >"$queue.tmp" && mv "$queue.tmp" "$queue"
}

gitc clone -q --no-checkout --no-hardlinks "$checkout" "$work/repo" >"$logf" 2>&1 || { result error "clone failed"; exit 0; }
gitc -C "$work/repo" checkout -q --detach "$base" >"$logf" 2>&1 || { result error "base commit not found"; exit 0; }
gitc -C "$work/repo" fetch -q "$pd/bundle" 'refs/heads/*:refs/bundle/*' >"$logf" 2>&1 || { result error "bundle fetch failed"; exit 0; }
tip=$(gitc -C "$work/repo" for-each-ref --format='%(objectname)' refs/bundle | head -n 1)
[[ -n $tip ]] || { result error "bundle has no commit"; exit 0; }

# Paths that can run code in the install step or change what it fetches.
risky='(^|/)(package\.json|bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bunfig\.toml|\.npmrc)$|^\.github/'
if hit=$(gitc -C "$work/repo" diff --name-only --no-renames "$base" "$tip" | grep -E "$risky" | head -n 3 | paste -sd' ') && [[ -n $hit ]]; then
	: >"$logf"
	result skipped "the diff touches: $hit"
	exit 0
fi

if ! (cd "$work/repo" && env -i HOME="$work/home" PATH="$PATH" timeout 600 bash -c "$install") >"$logf" 2>&1; then
	tail -n 200 "$logf" | tail -c 20000 >"$logf.t" && mv "$logf.t" "$logf"
	result error "install failed"
	exit 0
fi
safe_rm "$work/home"
gitc -C "$work/repo" checkout -q -f --detach "$tip" >"$logf" 2>&1 || { result error "checkout of the change failed"; exit 0; }

: >"$logf"
result queued ""
