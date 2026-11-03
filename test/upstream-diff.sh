#!/usr/bin/env bash
# Test of bin/upstream-diff.sh with two temporary directories.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
fails=0
check() { # description command...
	local d=$1
	shift
	if "$@" >/dev/null 2>&1; then printf 'ok   %s\n' "$d"; else printf 'FAIL %s\n' "$d"; fails=$((fails + 1)); fi
}

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_CONFIG_GLOBAL=$t/gitconfig GIT_CONFIG_SYSTEM=/dev/null
mkdir -p "$t/w/bin" "$t/w/skills" "$t/ph/products/signals/skills"
cp "$root/bin/upstream-diff.sh" "$t/w/bin/"
for n in same changed missing; do mkdir "$t/w/skills/signals-scout-$n"; echo a >"$t/w/skills/signals-scout-$n/SKILL.md"; done
for n in same changed extra; do mkdir "$t/ph/products/signals/skills/signals-scout-$n"; echo a >"$t/ph/products/signals/skills/signals-scout-$n/SKILL.md"; done
echo local >>"$t/w/skills/signals-scout-changed/SKILL.md"
git -C "$t/ph" init -q
git -C "$t/ph" add products
git -C "$t/ph" commit -q -m init
before=$(find "$t" -type f -exec md5sum {} + | sort | md5sum)

out=$(POSTHOG_REPO=$t/ph "$t/w/bin/upstream-diff.sh")
check "same scout" grep -q '^same  *signals-scout-same$' <<<"$out"
check "changed scout with the upstream commit" grep -Eq '^changed  *signals-scout-changed \(upstream: [0-9a-f]+ 20' <<<"$out"
check "missing upstream" grep -q '^missing upstream  *signals-scout-missing$' <<<"$out"
check "upstream scout that warden lacks" grep -q '^not in warden  *signals-scout-extra$' <<<"$out"
check "diff of one scout" bash -c "POSTHOG_REPO='$t/ph' '$t/w/bin/upstream-diff.sh' --diff signals-scout-changed | grep -q '^+local'"
check "a bad name is refused" bash -c "! POSTHOG_REPO='$t/ph' '$t/w/bin/upstream-diff.sh' --diff ../x"
check "nothing is written" test "$(find "$t" -type f -exec md5sum {} + | sort | md5sum)" = "$before"

if ((fails == 0)); then echo "all passed"; else echo "$fails failed"; exit 1; fi
