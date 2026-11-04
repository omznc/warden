#!/bin/bash
# Make the files of the agent in one tree writable for the group wardenwork, so that the runner can remove them.
# The runner starts this file as the user agent with sudo (see the sudoers file in the image). Root owns this file.
# The one argument is a directory under /state/<project>/<scout> or /work/<project>.
# Refuse a symlink and any other path. The change reaches only files that the agent owns, and no symlink target.
set -eu
[[ $# -eq 1 ]] || exit 2
d=$1
[[ -d $d && ! -L $d ]] || exit 2
r=$(realpath -e -- "$d") || exit 2
[[ $r == "$d" ]] || exit 2
[[ $r =~ ^/(state/[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*|work/[A-Za-z0-9][A-Za-z0-9._-]*)(/.*)?$ ]] || exit 2
me=$(id -un)
# Skip the .git of a checkout. The agent cannot write it, and git makes new directories there
# with mode 750 for the runner group. The agent cannot enter them, so find would fail.
# First the directories, one at a time: find must be able to enter a directory before it reads the content.
find -P "$r" -path "$r/.git" -prune -o -user "$me" -type d -exec chmod u+rwx,g+rwx {} \;
find -P "$r" -path "$r/.git" -prune -o -user "$me" ! -type l -exec chmod u+rwX,g+rwX {} +
