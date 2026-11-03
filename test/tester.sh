#!/usr/bin/env bash
# Test of the test preparation (bin/prep-test.sh) and of the tester loop (bin/tester.sh). No network.
# The network-less container check is test/tester-net.sh.
set -euo pipefail

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

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_CONFIG_GLOBAL=$t/gitconfig GIT_CONFIG_SYSTEM=/dev/null
export STATE_ROOT=$t/state TESTS_IN=$t/in TESTS_OUT=$t/out PROJECTS_FILE=$t/projects.json
mkdir -p "$t/state" "$t/in/queue" "$t/in/work" "$t/out"
# shellcheck source=/dev/null
source "$root/bin/lib.sh"
tester() { ONCE=1 "$root/bin/tester.sh" >/dev/null 2>&1; }

# The checkout of the runner, with one commit.
git init -q -b main "$t/checkout"
echo base >"$t/checkout/src.txt"
git -C "$t/checkout" add src.txt
git -C "$t/checkout" commit -q -m base
base=$(git -C "$t/checkout" rev-parse HEAD)

cat >"$t/projects.json" <<'JSON'
[{"name": "demo", "repo": "example/repo", "posthog_project_id": "1", "posthog_key_env": "POSTHOG_API_KEY_DEMO", "scouts": ["github-issues"],
  "test_command": "grep -q changed src.txt && echo TESTMARK && ls", "test_install": "test ! -e new.txt && echo install-ran"},
 {"name": "failing", "repo": "example/repo", "posthog_project_id": "1", "posthog_key_env": "POSTHOG_API_KEY_DEMO", "scouts": ["github-issues"],
  "test_command": "echo before-fail; exit 3", "test_install": "true"},
 {"name": "writer", "repo": "example/repo", "posthog_project_id": "1", "posthog_key_env": "POSTHOG_API_KEY_DEMO", "scouts": ["github-issues"],
  "test_command": "touch scribble && echo ok", "test_install": "true"},
 {"name": "nm", "repo": "example/repo", "posthog_project_id": "1", "posthog_key_env": "POSTHOG_API_KEY_DEMO", "scouts": ["github-issues"],
  "test_command": "test -L node_modules && cat node_modules/dep.txt && test -f src.txt", "test_install": "mkdir node_modules && echo depmark > node_modules/dep.txt"},
 {"name": "plain", "repo": "example/repo", "posthog_project_id": "1", "posthog_key_env": "POSTHOG_API_KEY_DEMO", "scouts": ["github-issues"]}]
JSON

# item <project> <id> <file>...: a pending item whose change touches the files. Prints nothing.
item() {
	local p=$1 i=$2 f d=$t/pending/$2
	shift 2
	mkdir -p "$d"
	git -C "$t/checkout" checkout -q -B "br-$i" "$base"
	for f in "$@"; do
		mkdir -p "$t/checkout/$(dirname "$f")"
		echo changed >"$t/checkout/$f"
		git -C "$t/checkout" add "$f"
	done
	git -C "$t/checkout" commit -q -m "change $i"
	git -C "$t/checkout" bundle create "$d/bundle" "$base..br-$i" 2>/dev/null
	jq -n --arg b "$base" '{base_sha: $b}' >"$d/meta.json"
	"$root/bin/prep-test.sh" "$p" "$i" "$t/checkout" "$d"
}
res() { printf '%s/results/%s/%s.json' "$TESTS_OUT" "$1" "$2"; }

echo "== Refused diffs"
for f in package.json packages/a/bun.lock bun.lockb package-lock.json pnpm-lock.yaml yarn.lock bunfig.toml .npmrc .github/workflows/x.yml; do
	id=skip-$(tr -c 'a-z0-9\n' '-' <<<"$f")
	item demo "$id" src.txt "$f"
done
check "no work directory for a skipped diff" bash -c "test -z \"\$(find '$TESTS_IN/work' -mindepth 2 2>/dev/null)\""
check "a skipped diff has no result before the tester runs" test ! -e "$(res demo skip-package-json)"
tester
for f in package.json packages/a/bun.lock bun.lockb package-lock.json pnpm-lock.yaml yarn.lock bunfig.toml .npmrc .github/workflows/x.yml; do
	id=skip-$(tr -c 'a-z0-9\n' '-' <<<"$f")
	check "the tester writes the skipped result for $f" bash -c "jq -e '.status == \"skipped\" and (.reason | contains(\"$f\"))' '$(res demo "$id")'"
done
tests_gc
check "the runner removes the finished queue files" test -z "$(find "$TESTS_IN/queue" -type f)"

echo "== A project without test_command"
item plain none src.txt
check "no result file" test ! -e "$(res plain none)"

echo "== Queue and run"
item demo good new.txt src.txt
check "the queue file exists" test -f "$TESTS_IN/queue/demo__good.json"
check "the runner wrote no result" test ! -e "$(res demo good)"
check "the work directory holds the change" grep -q changed "$TESTS_IN/work/demo/good/repo/new.txt"
tester || bad "tester exit"
check "the result is pass with the output" bash -c "jq -e '.status == \"pass\" and .exit_code == 0 and (.output_tail | contains(\"TESTMARK\")) and .started != null and .ended != null' '$(res demo good)'"
check "the tester writes the done marker" test -f "$TESTS_OUT/done/demo__good"
check "the tester leaves the input volume as it was" test -f "$TESTS_IN/queue/demo__good.json" -a -d "$TESTS_IN/work/demo/good"
tests_gc
check "the runner removes the queue file and the work directory" test ! -e "$TESTS_IN/queue/demo__good.json" -a ! -e "$TESTS_IN/work/demo/good"
check "the runner keeps the result and the marker" test -f "$(res demo good)" -a -f "$TESTS_OUT/done/demo__good"

echo "== A failing test"
item failing bad1 src.txt
tester || bad "tester exit 2"
check "the result is fail with the exit code and the output" bash -c "jq -e '.status == \"fail\" and .exit_code == 3 and (.output_tail | contains(\"before-fail\"))' '$(res failing bad1)'"

echo "== The tester ignores a bad queue name"
echo '{"command": "true"}' >"$TESTS_IN/queue/not-a-job.json"
tester || bad "tester exit 3"
check "the tester writes no result for a bad queue file" test -z "$(find "$TESTS_OUT/results" -name 'not-a-job*')"
tests_gc
check "the runner deletes a bad queue file" test ! -e "$TESTS_IN/queue/not-a-job.json"

echo "== The job runs in a copy"
item writer w1 src.txt
tester
check "the job passed" bash -c "jq -e '.status == \"pass\"' '$(res writer w1)'"
check "the job did not write in the input volume" test ! -e "$TESTS_IN/work/writer/w1/repo/scribble"

echo "== node_modules is linked, not copied"
item nm n1 src.txt
tester
check "the job sees node_modules through a link" bash -c "jq -e '.status == \"pass\" and (.output_tail | contains(\"depmark\"))' '$(res nm n1)'"

echo "== A partial copy is an error"
mkdir -p "$t/failbin"
printf '#!/bin/sh\necho tar failed >&2\nexit 2\n' >"$t/failbin/tar"
chmod +x "$t/failbin/tar"
item writer p1 src.txt
PATH=$t/failbin:$PATH ONCE=1 "$root/bin/tester.sh" >/dev/null 2>&1
check "the job is an error with the reason and did not run" bash -c "jq -e '.status == \"error\" and (.reason | contains(\"partial copy\")) and .exit_code == 125' '$(res writer p1)'"
check "the done marker is written" test -f "$TESTS_OUT/done/writer__p1"

echo "== A rerun with the same id"
item writer w1 src.txt
tester
check "a new queue file runs again after a done marker" test "$(jq -r .status "$(res writer w1)")" = pass
tests_gc
check "the runner removes the new queue file" test ! -e "$TESTS_IN/queue/writer__w1.json"

echo "== The runner never follows a symlink"
mkdir -p "$t/victim/sym1"
echo keep >"$t/victim/sym1/file"
ln -s "$t/victim" "$TESTS_IN/work/linked"
echo '{}' >"$TESTS_IN/queue/linked__sym1.json"
mkdir -p "$TESTS_OUT/done" && : >"$TESTS_OUT/done/linked__sym1"
tests_gc 2>/dev/null
check "a symlink in the path stops the removal" test -f "$t/victim/sym1/file"
rm -f "$TESTS_IN/work/linked" "$TESTS_IN/queue/linked__sym1.json"
ln -s "$t/victim/sym1/file" "$TESTS_IN/queue/linked__sym2.json"
: >"$TESTS_OUT/done/linked__sym2"
tests_gc 2>/dev/null
check "a symlink as queue file is not followed" test -f "$t/victim/sym1/file"

if ((fails == 0)); then echo "all passed"; else echo "$fails failed"; exit 1; fi
