#!/usr/bin/env bash
# Host test: a queued job runs in a container with the same limits as the tester service of compose.yaml:
# no network, read-only root, uid 1001, no capabilities, input volume read-only. The result is written.
# Needs podman and the image "warden". Run it on the host, not in the image.
# shellcheck disable=SC2016
set -euo pipefail

t=$(mktemp -d)
trap 'podman unshare rm -rf "$t"' EXIT
fails=0
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

mkdir -p "$t/in/queue" "$t/in/work/demo/net1/repo" "$t/out"
chmod -R a+rX "$t/in"
chmod 777 "$t/out"
echo hi >"$t/in/work/demo/net1/repo/file.txt"
chmod a+r "$t/in/work/demo/net1/repo/file.txt"
# The job tries the network and the input volume. It prints NETFAIL when the network is off, and the job still passes.
cmd='if curl -sS --max-time 5 https://example.com >/dev/null 2>&1; then echo NETUP; else echo NETFAIL; fi; test -f file.txt; test -z "$GH_TOKEN"; touch /tests-in/x 2>/dev/null && echo INWRITE; touch /app/x 2>/dev/null && echo ROOTWRITE; true'
jq -n --arg c "$cmd" '{project: "demo", id: "net1", command: $c}' >"$t/in/queue/demo__net1.json"
chmod a+r "$t/in/queue/demo__net1.json"
podman run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --user 1001 \
	--tmpfs /tmp:size=1g,mode=1777 -e ONCE=1 -e GH_TOKEN= \
	-v "$t/in":/tests-in:ro,Z -v "$t/out":/tests-out:Z warden bin/tester.sh >/dev/null 2>&1 || bad "tester container exit"
r=$t/out/results/demo/net1.json
if jq -e '.status == "pass" and (.output_tail | contains("NETFAIL")) and (.output_tail | contains("INWRITE") | not) and (.output_tail | contains("ROOTWRITE") | not)' "$r" >/dev/null 2>&1; then ok "the job ran with no network, read-only, and passed"; else bad "result: $(cat "$r" 2>/dev/null)"; fi
if [[ -e $t/out/done/demo__net1 ]]; then ok "the done marker exists"; else bad "no done marker"; fi
if [[ -e $t/in/queue/demo__net1.json && -d $t/in/work/demo/net1 && ! -e $t/in/x ]]; then ok "the input volume is unchanged"; else bad "the input volume changed"; fi

if ((fails == 0)); then echo "all passed"; else echo "$fails failed"; exit 1; fi
