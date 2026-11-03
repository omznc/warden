#!/usr/bin/env bash
# Compare the signals-scout-* skills of warden with the skills of PostHog. Run it on the PC, not in the runner.
# It only reads. It never writes to warden or to the PostHog repository.
# Use: upstream-diff.sh            print one line for each scout
#      upstream-diff.sh --diff <name>   print the diff of one scout (upstream first)
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
ph=${POSTHOG_REPO:-$HOME/dev/posthog}
up=$ph/products/signals/skills

[[ -d $up ]] || { echo "no upstream skills in $up" >&2; exit 1; }

if [[ ${1:-} == --diff ]]; then
	n=${2:-}
	[[ $n =~ ^signals-scout-[a-z0-9-]+$ ]] || { echo "use: $0 --diff signals-scout-<name>" >&2; exit 2; }
	[[ -d $root/skills/$n && -d $up/$n ]] || { echo "the scout $n is not in both repositories" >&2; exit 1; }
	diff -ru "$up/$n" "$root/skills/$n" || true
	exit 0
fi

for d in "$root"/skills/signals-scout-*/; do
	n=$(basename "$d")
	if [[ ! -d $up/$n ]]; then
		echo "missing upstream  $n"
	elif diff -rq "$up/$n" "$d" >/dev/null; then
		echo "same              $n"
	else
		echo "changed           $n (upstream: $(git -C "$ph" log -1 --format='%h %cs' -- "products/signals/skills/$n"))"
	fi
done

for d in "$up"/signals-scout-*/; do
	n=$(basename "$d")
	[[ -d $root/skills/$n ]] || echo "not in warden     $n"
done
