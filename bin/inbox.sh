#!/usr/bin/env bash
# Read the secrets inbox, check each new value, and write the valid ones to overrides.env.
# Then write status.json. Never write a value into the status, a log or a message.
# Usage: inbox.sh
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
STATE_ROOT=${STATE_ROOT:-/tmp/warden-state}
INBOX_ROOT=${INBOX_ROOT:-/inbox}
export STATE_ROOT
# shellcheck source=/dev/null
source "$root/bin/lib.sh"
# shellcheck source=/dev/null
source "$root/bin/coolify.sh"
shopt -s nullglob
[[ -d $INBOX_ROOT ]] || exit 0
overrides=$(secrets_file)
mkdir -p "$(dirname "$overrides")" 2>/dev/null || true
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

declare -A st det upd
vstate=
vdetail=
vurl=

# check_coolify <key> <value>: call the instance with the token. The token is in the environment of a subshell only.
# The instance must be in settings.json. Set vstate, vdetail and vurl. vurl is the one URL that the probe uses
# and that bind_coolify saves.
check_coolify() {
	local name out
	name=$(coolify_name "$1")
	vurl=$(coolify_instances | jq -r --arg n "$name" '.[] | select(.name == $n) | .url')
	if [[ -z $vurl ]]; then
		vstate=invalid
		vdetail="no Coolify instance named $name in the settings"
		return 0
	fi
	out=$(export "$1=$2" COOLIFY_UNBOUND=1 COOLIFY_URL_PIN="$vurl"; coolify_probe "$name")
	vstate=${out%%$'\t'*}
	vdetail=${out#*$'\t'}
	[[ $vstate =~ ^(ok|warn|invalid|error)$ ]] || { vstate=error; vdetail="the check gave no result"; }
}

# check_value <key> <value>: set vstate and vdetail.
check_value() {
	local k=$1 v=$2 bad=() repo id region rc
	vstate=ok
	vdetail=
	if [[ $k == GH_TOKEN ]]; then
		while IFS= read -r repo; do
			GH_TOKEN="$v" gh repo view "$repo" --json name >/dev/null 2>&1 || bad+=("$repo")
		done < <(projects_json 2>/dev/null | jq -r '[.[].repo] | unique[]')
		if ((${#bad[@]})); then
			vstate=invalid
			vdetail="no access to: ${bad[*]}"
		fi
	elif [[ $k == WARDEN_POSTHOG_TOKEN && $v != phc_* ]]; then
		vstate=invalid
		vdetail="a PostHog project token starts with phc_"
	elif [[ $k == WARDEN_POSTHOG_HOST && ! $v =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]]; then
		vstate=invalid
		vdetail="the host must look like https://eu.i.posthog.com"
	elif [[ $k == COOLIFY_TOKEN_* ]]; then
		check_coolify "$k" "$v"
	elif [[ $k == POSTHOG_API_KEY_* ]]; then
		while IFS=$'\t' read -r id region; do
			ph_get "$region" "$v" "/api/projects/$id/" >/dev/null 2>&1
			rc=$?
			((rc == 0)) && continue
			if ((rc == 22)); then vstate=invalid; else vstate=error; fi
			bad+=("$id")
		done < <(projects_json 2>/dev/null | jq -r --arg k "$k" '.[] | select(.posthog_key_env == $k) | [.posthog_project_id, (.posthog_region // "eu")] | @tsv')
		((${#bad[@]})) && vdetail="PostHog refused the key for project: ${bad[*]}"
	fi
	return 0
}

# bind_coolify <key> <url>: remember the URL that the token was checked against. coolify_get refuses another URL.
bind_coolify() {
	local f name url=$2
	f=$(dirname "$overrides")/coolify-urls.json
	name=$(coolify_name "$1")
	(
		umask 077
		jq -c --arg n "$name" --arg u "$url" '(if type == "object" then . else {} end) + {($n): $u}' "$f" 2>/dev/null >"$f.tmp" || jq -nc --arg n "$name" --arg u "$url" '{($n): $u}' >"$f.tmp"
	) && mv "$f.tmp" "$f"
}

# set_override <key> <value|"">: write or remove the key in overrides.env. Mode 600, atomic.
set_override() {
	local tmp=$overrides.tmp
	(
		umask 077
		{
			[[ ! -f $overrides ]] || grep -v "^$1=" "$overrides" || true
			[[ -z $2 ]] || printf '%s=%s\n' "$1" "$2"
		} >"$tmp"
	) && mv "$tmp" "$overrides"
}

for f in "$INBOX_ROOT"/*.json; do
	k=${f##*/}
	k=${k%.json}
	[[ $k != status && $k != discovery && $k != project-status ]] || continue
	body=$(cat "$f" 2>/dev/null || true)
	rm -f "$f"
	if ! secret_key_ok "$k"; then
		echo "inbox: key refused: ${k:0:60}" >&2
		continue
	fi
	upd[$k]=$(now)
	if jq -e '.clear == true' <<<"$body" >/dev/null 2>&1; then
		set_override "$k" ""
		st[$k]=; det[$k]=
		continue
	fi
	v=$(jq -r 'select(.value | type == "string") | .value' <<<"$body" 2>/dev/null || true)
	if [[ ! $v =~ ^[^[:space:]]{8,500}$ ]]; then
		st[$k]=invalid
		det[$k]="the value must be one line of 8 to 500 characters with no space"
		continue
	fi
	if [[ $k == COOLIFY_TOKEN_* && $v == *[\"\\[:cntrl:]]* ]]; then
		st[$k]=invalid
		det[$k]='a Coolify token must not have a quote, a backslash or a control character'
		continue
	fi
	vurl=
	check_value "$k" "$v"
	st[$k]=$vstate
	det[$k]=$vdetail
	if [[ $vstate == ok || $vstate == warn ]]; then
		set_override "$k" "$v"
		[[ $k != COOLIFY_TOKEN_* ]] || bind_coolify "$k" "$vurl"
	fi
done

# Build the key list: allowed names that are set anywhere, requested, named by a project, or in the old status.
status=$INBOX_ROOT/status.json
prev='{}'
[[ ! -f $status ]] || prev=$(jq -c 'if type == "object" then . else {} end' "$status" 2>/dev/null || echo '{}')
keys=$({
	printf '%s\n' GH_TOKEN CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY SENTRY_TOKEN WARDEN_POSTHOG_TOKEN WARDEN_POSTHOG_HOST HERMES_WEBHOOK_SECRET
	compgen -v POSTHOG_API_KEY_
	coolify_instances | jq -r '.[].name' | while IFS= read -r n; do coolify_key "$n"; echo; done
	[[ ! -f $overrides ]] || cut -d= -f1 "$overrides"
	projects_json 2>/dev/null | jq -r '.[].posthog_key_env'
	jq -r 'keys[]' <<<"$prev"
	printf '%s\n' "${!st[@]}"
} | sort -u)
lines=
while IFS= read -r k; do
	secret_key_ok "$k" || continue
	if [[ -f $overrides ]] && grep -q "^$k=" "$overrides"; then src=ui; elif [[ -n ${!k:-} ]]; then src="env"; else src="unset"; fi
	if [[ -v st[$k] ]]; then
		s=${st[$k]} d=${det[$k]} u=${upd[$k]}
	else
		s=$(jq -r --arg k "$k" '.[$k].state // ""' <<<"$prev")
		d=$(jq -r --arg k "$k" '.[$k].detail // ""' <<<"$prev")
		u=$(jq -r --arg k "$k" '.[$k].updated_at // ""' <<<"$prev")
	fi
	# A cleared or unset key has no state.
	[[ $src != unset || -v st[$k] ]] || s=
	lines+=$(printf '%s\t%s\t%s\t%s\t%s' "$k" "$src" "$s" "$d" "$u")$'\n'
done <<<"$keys"
printf '%s' "$lines" | jq -R -s 'split("\n") | map(select(length > 0) | split("\t")
  | {key: .[0], value: {source: .[1], state: (if .[2] == "" then null else .[2] end),
     detail: (if .[3] == "" then null else .[3] end), updated_at: (if .[4] == "" then null else .[4] end)}}) | from_entries' >"$status.tmp" &&
	mv "$status.tmp" "$status"
