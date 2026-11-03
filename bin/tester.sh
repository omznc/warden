#!/usr/bin/env bash
# Tester service: run the queued test jobs. No network, no secrets, no state.
# It reads TESTS_IN (read-only) and writes TESTS_OUT: results/<project>/<id>.json and done/<project>__<id>.
# The job runs in a copy of the work directory in /tmp. ONCE=1 empties the queue and exits. Usage: tester.sh
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
IN=${TESTS_IN:-/tests-in}
OUT=${TESTS_OUT:-/tests-out}
export TESTS_OUT
# shellcheck source=/dev/null
source "$root/bin/lib.sh"
# The UI reads TESTS_OUT as another user.
umask 022
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# finish <project> <id>: write the done marker. The runner then removes the queue file and the work directory.
finish() {
	mkdir -p "$OUT/done"
	: >"$OUT/done/$1__$2"
}

# pending_job: print the oldest queue file that has no done marker (or a marker older than the file).
pending_job() {
	local q b
	for q in $(find "$IN/queue" -maxdepth 1 -name '*.json' -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | cut -d' ' -f2-); do
		b=${q##*/}
		b=${b%.json}
		# The runner removes a bad name or a symlink. The tester ignores it.
		[[ ! -L $q && $b == *__* && ${b%%__*} =~ ^[a-z0-9][a-z0-9-]*$ && ${b#*__} =~ ^[a-z0-9][a-z0-9-]*$ ]] || continue
		if [[ -f $OUT/done/$b && ! $q -nt $OUT/done/$b ]]; then continue; fi
		printf '%s' "$q"
		return
	done
}

# copy_job <work-dir> <copy-dir>: copy the tree without repo/node_modules, then link node_modules.
# Fail when tar fails or when the copy has no repo directory.
copy_job() {
	local st
	tar -C "$1" --exclude=./repo/node_modules -cf - . | tar -C "$2" -xpf -
	st=("${PIPESTATUS[@]}")
	((st[0] == 0 && st[1] == 0)) || return 1
	[[ -d $2/repo ]] || return 1
	[[ ! -d $1/repo/node_modules ]] || ln -s "$1/repo/node_modules" "$2/repo/node_modules"
}

# run_job <queue-file>
run_job() {
	local q=$1 b proj id cmd work out start rc status reason="" copy
	b=${q##*/}
	b=${b%.json}
	proj=${b%%__*}
	id=${b#*__}
	rm -f "$OUT/done/${b}"
	cmd=$(jq -r '.command // empty' "$q" 2>/dev/null)
	work=$IN/work/$proj/$id
	start=$(now)
	out=$(mktemp)
	if jq -e '.preset.status' "$q" >/dev/null 2>&1; then
		# The runner could not prepare the job. Only write the result.
		jq -r '.preset.output_tail // ""' "$q" >"$out"
		test_result "$proj" "$id" "$(jq -r '.preset.status' "$q")" "$(jq -r '.preset.reason // ""' "$q")" "$cmd" "" "" "" "$out"
	elif [[ -z $cmd || -L $work || -L $work/repo || ! -d $work/repo ]]; then
		echo "no command or no work directory" >"$out"
		test_result "$proj" "$id" error "bad job" "$cmd" "$start" "$(now)" "" "$out"
	else
		test_result "$proj" "$id" running "" "$cmd" "$start"
		# Copy the work directory to the tmpfs. The job cannot change the input volume, and symlinks stay links.
		# node_modules is large: the copy gets a symlink to it in the input volume, which is read-only here.
		copy=$(mktemp -d /tmp/job.XXXXXX)
		if copy_job "$work" "$copy"; then
			(cd "$copy/repo" && env -i HOME=/tmp/home PATH="$PATH" timeout 600 bash -c "$cmd") >"$out" 2>&1 </dev/null
			rc=$?
		else
			echo "the copy of the work directory failed or is incomplete" >"$out"
			rc=125
		fi
		rm -rf "$copy"
		tail -n 200 "$out" | tail -c 20000 >"$out.t" && mv "$out.t" "$out"
		case $rc in
		0) status=pass ;;
		124) status=error reason="timed out after 600 s" ;;
		125) status=error reason="partial copy of the work directory" ;;
		*) status=fail ;;
		esac
		test_result "$proj" "$id" "$status" "$reason" "$cmd" "$start" "$(now)" "$rc" "$out"
	fi
	rm -f "$out"
	finish "$proj" "$id"
}

# queue_notes: write a queued result for each job that has no result yet.
queue_notes() {
	local q b proj id cmd
	for q in "$IN"/queue/*.json; do
		[[ -f $q && ! -L $q ]] || continue
		b=${q##*/}
		b=${b%.json}
		[[ $b == *__* ]] || continue
		proj=${b%%__*}
		id=${b#*__}
		[[ $proj =~ ^[a-z0-9][a-z0-9-]*$ && $id =~ ^[a-z0-9][a-z0-9-]*$ ]] || continue
		[[ ! -f $OUT/done/$b || $q -nt $OUT/done/$b ]] || continue
		[[ ! -e $OUT/results/$proj/$id.json ]] || [[ $q -nt $OUT/results/$proj/$id.json ]] || continue
		cmd=$(jq -r '.command // empty' "$q" 2>/dev/null)
		test_result "$proj" "$id" queued "" "$cmd"
	done
}

mkdir -p /tmp/home "$OUT/results" "$OUT/done"
while true; do
	queue_notes
	q=$(pending_job)
	if [[ -n $q ]]; then
		run_job "$q"
		continue
	fi
	[[ -z ${ONCE:-} ]] || exit 0
	sleep 10
done
