#!/bin/bash
# Run claude as the user agent. The runner starts this file with sudo (see the sudoers file in the image).
# Root owns this file. The runner and the agent cannot change it.
# The environment comes from sudo --preserve-env, so no token is in the argument list.
umask 007
args=()
for v in STATE_DIR CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY; do
	[[ -z ${!v:-} ]] || args+=("$v=${!v}")
done
exec env -i HOME=/home/agent PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 "TERM=${TERM:-dumb}" "${args[@]}" claude "$@"
