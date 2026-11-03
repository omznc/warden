#!/usr/bin/env bash
# Test of agent_prepare with real users. Run it as root in the image:
#   podman run --rm -u 0 -v "$PWD":/src:Z -w /src warden bash test/agent-perm.sh
# The runner prepares the directories two times. The agent makes files in between.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
fails=0
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
check() { # description command...
	local d=$1
	shift
	if "$@" >/dev/null 2>&1; then ok "$d"; else bad "$d"; fi
}
[[ $(id -u) == 0 ]] || { echo "run this test as root in the image"; exit 1; }
[[ -x /app/bin/agent-exec.sh ]] || { echo "run this test in the image"; exit 1; }

# agent-unlock.sh accepts only /state/<project>/<scout> and /work/<project>, so the test uses the real roots of the image.
t=$(mktemp -d)
S=/state W=/work
trap 'rm -rf "$t" "$S/p" "$W/p"' EXIT
chmod 755 "$t"
mkdir -p "$S/p/scout" "$W/p"
git init -q "$W/p"
chown -R runner:runner "$S/p" "$W/p"
as_runner() { runuser -u runner -- "$@"; }
as_agent() { runuser -u agent -- "$@"; }
prep() { as_runner env STATE_ROOT="$S" WORK_ROOT="$W" bash -c "source '$root/bin/lib.sh'; agent_prepare p '$S/p/scout' '$W/p'"; }

echo "== First prepare"
check "agent_prepare succeeds" prep
check "the agent writes the state directory" as_agent bash -c "umask 007; echo note >'$S/p/scout/scratchpad.md'; mkdir '$S/p/scout/sub'; echo x >'$S/p/scout/sub/f'"
check "the agent writes the checkout" as_agent bash -c "umask 007; echo x >'$W/p/new.txt'"

echo "== Second prepare, with files of the agent in the trees"
as_runner touch "$S/p/scout/runner-file"
as_runner ln -s /etc/hostname "$S/p/scout/link"
check "agent_prepare succeeds again" prep
check "the note of the agent is kept" test "$(cat "$S/p/scout/scratchpad.md")" = note
check "the file of the agent in a subdirectory is kept" test -f "$S/p/scout/sub/f"
check "the file of the agent keeps the group wardenwork" test "$(stat -c %G "$S/p/scout/scratchpad.md")" = wardenwork
check "a file of the runner gets the group wardenwork and group write" test "$(stat -c '%G %a' "$S/p/scout/runner-file")" = "wardenwork 664"
check "a symlink is not followed" test "$(stat -c %G /etc/hostname)" != wardenwork
check "the agent still writes a file of the first run" as_agent bash -c "echo more >>'$S/p/scout/scratchpad.md'"
check "the runner reads the file of the agent" as_runner cat "$S/p/scout/scratchpad.md"
check "the runner removes the file of the agent" as_runner rm "$W/p/new.txt"
check "a third prepare succeeds" prep

echo "== Symlinks of the agent in the state directory"
sentinel=$t/sentinel
echo keep >"$sentinel"
chown runner:runner "$sentinel"
chmod 600 "$sentinel"
for f in prs.json issues.json scratchpad.md; do
	as_agent bash -c "rm -rf '$S/p/scout/$f'; ln -s '$sentinel' '$S/p/scout/$f'"
done
echo '[]' >"$t/src.json"
chown runner:runner "$t/src.json"
check "the runner writes the state files after the agent made symlinks" as_runner bash -c "
  source '$root/bin/lib.sh'
  put_file '$t/src.json' '$S/p/scout/prs.json' && put_file '$t/src.json' '$S/p/scout/issues.json'
  ensure_file '$S/p/scout/scratchpad.md' && echo line >>'$S/p/scout/scratchpad.md'"
check "the sentinel is unchanged" test "$(cat "$sentinel")" = keep
for f in prs.json issues.json scratchpad.md; do
	check "$f is a regular file" test -f "$S/p/scout/$f" -a ! -L "$S/p/scout/$f"
done

echo "== Directory of the agent in place of a state file"
as_agent bash -c "umask 007; rm -rf '$S/p/scout/prs.json'; mkdir -p '$S/p/scout/prs.json/sub'; echo x >'$S/p/scout/prs.json/sub/f'"
check "put_file replaces a directory of the agent" as_runner bash -c "source '$root/bin/lib.sh'; put_file '$t/src.json' '$S/p/scout/prs.json'"
check "prs.json is a regular file again" test -f "$S/p/scout/prs.json" -a ! -L "$S/p/scout/prs.json"

echo "== Directories of the agent with mode 700"
as_agent bash -c "umask 007
  mkdir -p '$S/p/scout/coolify-logs/sub' '$W/p/deep/sub' && rm -f '$S/p/scout/prs.json' && mkdir -p '$S/p/scout/prs.json/sub'
  echo x >'$S/p/scout/coolify-logs/sub/f'; echo x >'$S/p/scout/prs.json/sub/f'; echo x >'$W/p/deep/sub/f'
  ln -s '$sentinel' '$W/p/deep/sub/sl'
  chmod 700 '$S/p/scout/coolify-logs/sub' '$S/p/scout/prs.json/sub' '$W/p/deep/sub'
  chmod 000 '$W/p/deep/sub' '$S/p/scout/coolify-logs/sub'"
if as_runner rm -rf "$S/p/scout/coolify-logs" 2>/dev/null; then bad "control: the runner cannot remove a directory with mode 700"; else ok "control: the runner cannot remove a directory with mode 700"; fi
mkdir -p "$t/pub/logs"
echo '{}' >"$t/pub/coolify.json"
echo log >"$t/pub/logs/a.log"
chown -R runner:runner "$t/pub"
check "the runner unlocks the state and the checkout" as_runner env STATE_ROOT="$S" WORK_ROOT="$W" bash -c "source '$root/bin/lib.sh'; agent_reclaim '$S/p/scout' '$W/p'"
check "put_file replaces a directory with mode 700" as_runner bash -c "source '$root/bin/lib.sh'; put_file '$t/src.json' '$S/p/scout/prs.json'"
check "prs.json is a regular file after the unlock" test -f "$S/p/scout/prs.json" -a ! -L "$S/p/scout/prs.json"
as_agent bash -c "umask 007; mkdir -p -m 700 '$S/p/scout/coolify-logs/sub2'; echo x >'$S/p/scout/coolify-logs/sub2/f'; chmod 000 '$S/p/scout/coolify-logs/sub2'"
check "coolify_publish replaces a directory with mode 700" as_runner bash -c "source '$root/bin/lib.sh'; source '$root/bin/coolify.sh'; coolify_publish '$t/pub' '$S/p/scout'"
check "coolify-logs holds the new log" test -f "$S/p/scout/coolify-logs/a.log" -a ! -e "$S/p/scout/coolify-logs/sub2"
check "the runner removes the checkout after the unlock" as_runner bash -c "source '$root/bin/lib.sh'; agent_unlock '$W/p'; rm -rf '$W/p'"
check "the symlink of the agent did not change its target" test "$(cat "$sentinel")" = keep -a "$(stat -c %a "$sentinel")" = 600

echo "== The helper refuses other paths"
mkdir -p "$W/p" && chown runner:runner "$W/p" && chmod 2770 "$W/p" && chgrp wardenwork "$W/p"
mkdir -p "$t/outside" && chown agent "$t/outside" && chmod 700 "$t/outside"
as_agent ln -s "$S/p/scout" "$W/p/lnk"
as_agent mkdir -p "$W/p/real"
unlock() { as_runner sudo -n -u agent /app/bin/agent-unlock.sh "$@"; }
refuse() { # description path
	if unlock "$2" >/dev/null 2>&1; then bad "$1"; else ok "$1"; fi
}
refuse "a path outside the roots" "$t/outside"
refuse "/etc" /etc
refuse "the root /state" "$S"
refuse "a project directory in /state" "$S/p"
refuse "a symlink to an allowed directory" "$W/p/lnk"
refuse "a path with .." "$S/p/scout/../scout"
refuse "a path with a symlink parent" "$W/p/lnk/coolify-logs"
refuse "no argument" ""
if as_runner sudo -n -u agent /app/bin/agent-unlock.sh "$W/p" "$W/p/real" >/dev/null 2>&1; then bad "two arguments"; else ok "two arguments"; fi
check "a refused path stays unchanged" test "$(stat -c %a "$t/outside")" = 700
check "an allowed path works" unlock "$W/p"
check "the runner cannot run another command as the agent" bash -c "! runuser -u runner -- sudo -n -u agent /bin/true"

if ((fails == 0)); then echo "all passed"; else echo "$fails failed"; exit 1; fi
