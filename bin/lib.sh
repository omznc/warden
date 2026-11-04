#!/usr/bin/env bash
# Shared helpers: the agent sandbox, safe git, and the secret scan. Source this file.

# A shell from docker exec has umask 0000. Make new files private to the owner and the group.
# The UI runs as the same uid as the runner, so it still reads them. The tester resets the umask.
umask 027

# git for a checkout that the agent could change: no hooks, no fsmonitor program.
# The agent writes files in the checkout, so git must accept the owner of those files.
gitc() { git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c safe.directory='*' "$@"; }

# agent_isolated: succeed when the agent runs as the user agent (sudo and agent-exec.sh from the image).
# WARDEN_NO_AGENT_USER=1 turns it off. The tests with a stub claude use it.
agent_isolated() { [[ -z ${WARDEN_NO_AGENT_USER:-} && -x /app/bin/agent-exec.sh ]]; }

# agent_grant <dir>...: let the agent write a tree. Group wardenwork, setgid directories, group write.
agent_grant() {
	agent_isolated || return 0
	local d me
	me=$(id -u)
	# The runner changes only the files that it owns. A file of the agent has the group wardenwork already
	# (setgid directory, umask 007 in agent-exec.sh), and the runner cannot change it. Symlinks are skipped.
	for d; do
		find "$d" -user "$me" ! -type l -exec chgrp wardenwork {} + -exec chmod g+rwX {} + || return 1
		find "$d" -user "$me" -type d -exec chmod g+s {} + || return 1
		[[ $(stat -c %G "$d") == wardenwork ]] || return 1
	done
}

# agent_share <file>...: let the agent read a file, and nothing more (mode 0640, group wardenwork).
agent_share() {
	agent_isolated || return 0
	chgrp wardenwork "$@" && chmod 0640 "$@"
}

# agent_unlock <dir>: make the files of the agent below a directory writable for the group.
# The agent can make a directory with mode 700. The runner is not the owner, so rm -rf would fail on it.
# The helper runs as the user agent (sudoers entry in the image). It accepts only a path
# under /state/<project>/<scout> or /work/<project>, and no symlink. Do nothing without a directory.
agent_unlock() {
	agent_isolated || return 0
	[[ -d $1 && ! -L $1 ]] || return 0
	sudo -n -u agent /app/bin/agent-unlock.sh "$1"
}

# agent_reclaim <state-dir> <checkout>: open the directories of one scout for the agent user, then unlock the files of the agent.
# Call it before the runner changes or removes something in them. The agent is not running at that time.
agent_reclaim() {
	local d p
	agent_isolated || return 0
	p=$(dirname "$1")
	chgrp wardenwork "$p" && chmod 0710 "$p" || return 1
	for d in "$1" "$2"; do
		[[ -d $d && ! -L $d ]] || continue
		chgrp wardenwork "$d" && chmod 2770 "$d" || return 1
	done
	agent_unlock "$1" && { [[ ! -d $2 ]] || agent_unlock "$2"; }
}

# put_file <src> <dest>: copy into a path the agent can write. Remove the destination first:
# the agent can leave a symlink or a directory there.
put_file() { agent_unlock "$2" || true; rm -rf -- "$2" && cp -- "$1" "$2"; }

# ensure_file <file>: make a regular file in a path the agent can write. Replace a symlink or other non-regular entry.
ensure_file() {
	[[ -f $1 && ! -L $1 ]] || { agent_unlock "$1" || true; rm -rf -- "$1" && : >"$1"; }
}

# lock_checkout <checkout>: the agent can write the files of the checkout but not .git.
lock_checkout() {
	agent_grant "$1" || return 1
	chmod -R g-w "$1/.git"
	chmod +t "$1"
}

# agent_prepare <project> <state-dir> <checkout>: give the agent the checkout (not .git) and the state directory of one run, and nothing more.
# /state/<project> is closed except for the one scout directory.
agent_prepare() {
	local proj=$1 state=$2 checkout=$3 d
	agent_isolated || return 0
	chgrp wardenwork "${STATE_ROOT:-/state}/$proj" && chmod 0710 "${STATE_ROOT:-/state}/$proj" || return 1
	for d in "${STATE_ROOT:-/state}/$proj"/*/; do chmod 0700 "$d"; done
	chgrp wardenwork "$state" "$checkout" && chmod 2770 "$state" "$checkout" || return 1
	agent_unlock "$state" && agent_unlock "$checkout" && lock_checkout "$checkout" && agent_grant "$state"
}

# strip_world_write <dir>...: remove the world-write bit from the files below the directories.
# A file that a shell with umask 0000 made can be world-writable. Symlinks are skipped.
strip_world_write() {
	local d
	for d; do
		[[ -d $d ]] && find "$d" ! -type l -perm -o+w -exec chmod o-w {} + 2>/dev/null
	done
	return 0
}

# harden_dirs [--quick]: the dirs that hold secrets or state are private to the runner. The agent can only pass through
# /state and /work (mode 0710, group wardenwork). A checkout that is not in use is closed (mode 0700).
# The search for world-writable files walks all the files. --quick skips it. run-all.sh does the full walk one time
# at the start, and run-scout.sh does it for the directories of one project.
harden_dirs() {
	local d
	for d in "${SECRETS_ROOT:-/secrets}" "${INBOX_ROOT:-/inbox}"; do
		[[ -d $d ]] && chmod 0700 "$d" 2>/dev/null
	done
	for d in "${STATE_ROOT:-/state}" "${WORK_ROOT:-/work}"; do
		[[ -d $d ]] || continue
		agent_isolated && chgrp wardenwork "$d" 2>/dev/null
		chmod 0710 "$d" 2>/dev/null
		[[ ${1:-} == --quick ]] || strip_world_write "$d"
	done
	for d in "${WORK_ROOT:-/work}"/*/; do
		[[ -d $d ]] && chmod 0700 "$d" 2>/dev/null
	done
	return 0
}

# Make a private directory outside the checkout. It holds the MCP config and the settings file.
# Prints the path. /run/warden is the place in the container.
# The agent process (claude) must read the files, so the group wardenwork gets read access to this directory only.
agent_sandbox_dir() {
	local d
	if [[ -d /run/warden && -w /run/warden ]]; then
		d=$(mktemp -d /run/warden/run.XXXXXX)
	else
		d=$(mktemp -d "${TMPDIR:-/tmp}/warden-sbx.XXXXXX")
	fi
	if agent_isolated; then
		chgrp wardenwork "$d" && chmod 0750 "$d"
	fi
	printf '%s' "$d"
}

# agent_settings <file> <sandbox-dir> <checkout>: write the permission denies as a settings file.
# A path rule that starts with // is an absolute path.
agent_settings() {
	local f=$1 sbx=$2 checkout=$3
	jq -n --arg sbx "/$sbx" --arg co "/$checkout" --arg home "/${HOME:-/home/runner}" '
	  ["//proc/**", "//run/warden/**", "//secrets/**", "//inbox/**", "//tests-in/**", "//tests-out/**", "//tests/**", "//app/bin/**",
	   $sbx + "/**", "//home/runner/**", "//home/agent/.claude/**", "//home/agent/.claude.json", $home + "/.claude/**", $home + "/.claude.json"] as $secret
	  | [$secret[] | ("Read(", "Edit(") + . + ")"]
	    + [($co + "/.git/**", $co + "/.github/**") | "Edit(" + . + ")"]
	  | {permissions: {deny: .}}' >"$f"
	agent_share "$f"
}

agent_cmd=()
agent_allowed='Read,Edit,Write,Glob,Grep,mcp__posthog__*,Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(ls:*)'
agent_denied='Bash(git push:*),Bash(gh:*),Bash(curl:*),Bash(wget:*),WebFetch,WebSearch,Bash(git * --no-index*),Bash(git * --output*),Bash(git * --ext-diff*),Bash(git * --textconv*)'

# agent_build <prompt> <system-file> <mcp-file> <settings-file> <max-turns> [extra claude args...]
# Sets the array agent_cmd. The agent gets a clean environment: no secret except its own model credentials.
# Export STATE_DIR before the call. With isolation, sudo passes the variables by name (--preserve-env), so no
# secret is in the argument list, which every process can read in /proc.
agent_build() {
	local prompt=$1 sys=$2 mcp=$3 settings=$4 turns=$5 v keep=
	shift 5
	local -a claude_args=(-p "$prompt"
		--append-system-prompt "$(cat "$sys")"
		--mcp-config "$mcp" --strict-mcp-config --settings "$settings"
		--output-format json --max-turns "$turns" --model "${CLAUDE_MODEL:-sonnet}"
		--permission-mode acceptEdits --allowedTools "$agent_allowed" --disallowedTools "$agent_denied" "$@")
	if agent_isolated; then
		for v in STATE_DIR CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY; do
			keep+=,$v
		done
		agent_cmd=(sudo -n -u agent "--preserve-env=${keep#,}" /app/bin/agent-exec.sh "${claude_args[@]}")
		return 0
	fi
	agent_cmd=(env -i "HOME=${HOME:-/home/runner}" "PATH=$PATH" "LANG=${LANG:-C.UTF-8}" "TERM=${TERM:-dumb}")
	for v in STATE_DIR CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY; do
		[[ -z ${!v:-} ]] || agent_cmd+=("$v=${!v}")
	done
	agent_cmd+=(claude "${claude_args[@]}")
}

# secret_names: the names of the variables that hold a secret value.
secret_names() {
	printf '%s\n' GH_TOKEN GITHUB_TOKEN CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY SENTRY_TOKEN WARDEN_POSTHOG_TOKEN HERMES_WEBHOOK_SECRET WARDEN_PASSWORD
	compgen -v POSTHOG_API_KEY_
	compgen -v COOLIFY_TOKEN_
}

# The secret shapes. scrub_secrets and secret_hit both use these patterns (ERE).
# A name with SECRET, PASSWORD, TOKEN, KEY and the like, then = or :, then a value.
# A false positive is better than a leak.
secret_kv_re='[A-Za-z0-9_.-]*(secret|password|passwd|token|key|passphrase|credential|authorization)[A-Za-z0-9_.-]*["'"'"']?[[:space:]]*[=:][[:space:]]*'
secret_pass_re='(^|[^A-Za-z0-9_.-])pass["'"'"']?[[:space:]]*[=:][[:space:]]*'
secret_val_re='"[^"]+"|'"'"'[^'"'"']+'"'"'|[^[:space:]",;&]+'
secret_token_re='gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|phx_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-or-[A-Za-z0-9_-]{20,}|[sr]k_(live|test)_[A-Za-z0-9]{10,}|xox[abprs]-[A-Za-z0-9-]{10,}|(AKIA|ASIA)[A-Z0-9]{16}|npm_[A-Za-z0-9]{30,}|glpat-[A-Za-z0-9_-]{20,}|[0-9]+\|[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*'
secret_bearer_re='(Bearer|Basic) [A-Za-z0-9._~+/=-]{12,}'
secret_urlpass_re='://[^/@[:space:]:]+:[^/@[:space:]]+@'
secret_cookie_re='(Set-)?Cookie:[[:space:]]*'
secret_pem_begin_re='-----BEGIN [A-Z ]*PRIVATE KEY[A-Z ]*-----'
secret_pem_end_re='-----END [A-Z ]*PRIVATE KEY[A-Z ]*-----'

# scrub_secrets: filter stdin to stdout. Replace each secret value and each token-like string with [removed].
# The values go through a file, not argv. Use it on text from a service log before the agent reads it.
scrub_secrets() {
	{ set +x; } 2>/dev/null
	local pat n v
	pat=$(mktemp)
	for n in $(secret_names); do
		v=${!n:-}
		[[ ${#v} -lt 8 ]] || printf '%s\n' "$v" >>"$pat"
	done
	# awk reads the values first (the file ARGV[1]), then the text from stdin. An empty value file is safe.
	awk 'FILENAME == ARGV[1] { v[++n] = $0; next }
	  { for (i = 1; i <= n; i++) while ((p = index($0, v[i])) > 0) $0 = substr($0, 1, p - 1) "[removed]" substr($0, p + length(v[i])); print }' "$pat" - |
		sed -E "s#$secret_pem_begin_re.*$secret_pem_end_re#[removed]#;
		  \\#$secret_pem_begin_re#,\\#$secret_pem_end_re#c\\
[removed]
		  s#$secret_token_re#[removed]#g;
		  s#($secret_bearer_re)#Bearer [removed]#g;
		  s#($secret_urlpass_re)#://[removed]@#g;
		  s#($secret_cookie_re).*#\\1[removed]#I;
		  s#($secret_kv_re)($secret_val_re)#\\1[removed]#Ig;
		  s#($secret_pass_re)($secret_val_re)#\\1[removed]#Ig"
	rm -f "$pat"
}

# secret_hit <file>...: succeed when a file holds a secret value or a token-like string.
# The patterns go through a file, not argv.
secret_hit() {
	local xt=0 rc
	[[ $- == *x* ]] && xt=1
	{ set +x; } 2>/dev/null
	_secret_hit "$@"
	rc=$?
	((xt)) && set -x
	return $rc
}
_secret_hit() {
	local pat v n
	pat=$(mktemp)
	for n in $(secret_names); do
		v=${!n:-}
		[[ -z $v ]] || printf '%s\n' "$v" >>"$pat"
	done
	local hit=1
	if [[ -s $pat ]] && grep -qFf "$pat" -- "$@"; then hit=0; fi
	if grep -qE "$secret_token_re|$secret_pem_begin_re|$secret_urlpass_re" -- "$@"; then hit=0; fi
	if grep -qiE "$secret_bearer_re|${secret_cookie_re}[^[:space:]]|($secret_kv_re|$secret_pass_re)($secret_val_re)" -- "$@"; then hit=0; fi
	rm -f "$pat"
	return $hit
}

# project_mode <project> <default>: the mode of a project. settings.json wins over the default.
# An invalid or missing value gives the default.
project_mode() {
	local m
	m=$(jq -r --arg p "$1" '.projects[$p].mode // empty' "${STATE_ROOT:-/tmp/warden-state}/settings.json" 2>/dev/null || true)
	case $m in
	dry | issues | prs) printf '%s' "$m" ;;
	*) printf '%s' "$2" ;;
	esac
}

# stale_days: days after which a pending item turns stale. settings.json stale_days, default 30.
stale_days() {
	jq -r '.stale_days | if type == "number" and . >= 1 then floor else 30 end' "${STATE_ROOT:-/tmp/warden-state}/settings.json" 2>/dev/null || echo 30
}

# item_epoch <meta-file>: the creation time of an item, in epoch seconds.
# Order: the created field, the UTC stamp at the end of the id, the mtime of the item directory.
# The mtime of meta.json is not used: an edit or a decision rewrites it.
item_epoch() {
	local d c e id
	d=$(dirname "$1")
	id=${d##*/}
	c=$(jq -r '.created // empty' "$1" 2>/dev/null)
	if [[ -n $c ]] && e=$(date -u -d "$c" +%s 2>/dev/null); then
		printf '%s' "$e"
	elif [[ $id =~ -([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})?(-[0-9]+)?$ ]] &&
		e=$(date -u -d "${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]} ${BASH_REMATCH[4]}:${BASH_REMATCH[5]}:${BASH_REMATCH[6]:-00}" +%s 2>/dev/null); then
		printf '%s' "$e"
	else
		stat -c %Y "$d"
	fi
}

# health_record <project> <scout> <exit-code>: count the runs of a scout in a row that failed.
# $STATE_ROOT/health.json holds fails, last_good, last_exit and last_at for each project/scout. Only the runner
# writes it (mode 600, in the top directory of the state, which the agent cannot write).
# A notice goes out when the count reaches 2 and when a scout with 2 or more failures runs well again.
# The notice has the project, the scout and the exit code. It has no output of the run.
# Needs $root.
health_record() {
	local f=${STATE_ROOT:-/tmp/warden-state}/health.json key=$1/$2 rc=$3 cur old now
	now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
	[[ $rc =~ ^[0-9]+$ ]] || rc=1
	(
		umask 077
		exec 9>"$f.lock"
		flock 9
		cur=$(jq -c 'if type == "object" then . else {} end' "$f" 2>/dev/null || echo '{}')
		old=$(jq -r --arg k "$key" '.[$k].fails // 0' <<<"$cur")
		# SC2016: the jq program uses $ variables on purpose.
		# shellcheck disable=SC2016
		jq -c --arg k "$key" --argjson rc "$rc" --arg now "$now" '
		  .[$k] = (if $rc == 0 then {fails: 0, last_good: $now, last_exit: 0, last_at: $now}
		           else ((.[$k] // {}) | {fails: ((.fails // 0) + 1), last_good: (.last_good // null), last_exit: $rc, last_at: $now}) end)' \
			<<<"$cur" >"$f.tmp" && mv "$f.tmp" "$f"
		if ((rc != 0 && old + 1 == 2)); then
			"$root/bin/notify.sh" "warden: $key failed 2 times in a row (exit code $rc)" || true
		elif ((rc == 0 && old >= 2)); then
			"$root/bin/notify.sh" "warden: $key runs again after $old failures" || true
		fi
	)
}

# clean_running: delete the running files that a crash or a power reset left.
clean_running() { rm -f "${STATE_ROOT:-/tmp/warden-state}"/running/*.json; }

# checkout_lock <project>: open $STATE_ROOT/checkout-<project>.lock on a free fd and set CHECKOUT_FD.
# The caller takes the lock with flock on that fd. run-scout.sh holds it for the whole run.
# submit-approved.sh holds it for the git work of one PR. The file is in the top of the state (mode 600).
# A child process that sudo starts has no fd above 2, so the agent never holds the lock.
checkout_lock() {
	local old rc
	[[ $1 =~ ^[a-z0-9][a-z0-9-]*$ ]] || return 1
	old=$(umask)
	umask 077
	exec {CHECKOUT_FD}>"${STATE_ROOT:-/tmp/warden-state}/checkout-$1.lock"
	rc=$?
	umask "$old"
	return $rc
}

# checkout_unlock: close the fd of checkout_lock. This releases the lock.
checkout_unlock() {
	[[ -z ${CHECKOUT_FD:-} ]] || exec {CHECKOUT_FD}>&-
	CHECKOUT_FD=
}

# url_ok <url>: a http or https URL with a plain host, at most 500 characters, no user info.
url_ok() {
	local re='^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]"<>\\]*)?$'
	((${#1} <= 500)) && [[ $1 =~ $re ]]
}

# settings_url <key> <fallback>: a URL from settings.json wins over the fallback. A bad URL in the file is ignored.
# settings.json is in the top directory of the state. The agent cannot write there.
# With the third argument "strip", a trailing slash is removed (for a base URL). A webhook URL stays as it is.
settings_url() {
	local v
	v=$(jq -r --arg k "$1" '.[$k] | strings' "${STATE_ROOT:-/tmp/warden-state}/settings.json" 2>/dev/null || true)
	if ! url_ok "$v"; then printf '%s' "$2"; elif [[ ${3:-} == strip ]]; then printf '%s' "${v%/}"; else printf '%s' "$v"; fi
}

# warden_url: the base URL of the UI, for the links in notices. Empty means that notices have no link.
warden_url() { settings_url warden_url "${WARDEN_URL:-}" strip; }

# hermes_url: the Hermes webhook URL. Empty means that notify.sh prints the text only.
hermes_url() { settings_url hermes_webhook_url "${HERMES_WEBHOOK_URL:-}"; }

# notify_test: send the fixed test text and write $STATE_ROOT/notify-test.json for the UI.
# The file has ok, status and at. The status is an HTTP code, none (no URL), nosecret or 000 (no answer).
# It never has the response body or an error text. Needs $root.
notify_test() {
	local s=${STATE_ROOT:-/tmp/warden-state} st rc=0 code
	st=$(mktemp)
	NOTIFY_STATUS_FILE=$st "$root/bin/notify.sh" "warden test message" </dev/null >/dev/null 2>&1 || rc=$?
	code=$(cat "$st" 2>/dev/null || true)
	rm -f "$st"
	[[ $code =~ ^([0-9]{3}|none|nosecret)$ ]] || code=000
	jq -n --argjson ok "$((rc == 0))" --arg st "$code" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{ok: ($ok == 1), status: $st, at: $at}' >"$s/notify-test.json.tmp" &&
		mv "$s/notify-test.json.tmp" "$s/notify-test.json"
}

# handle_requests: run the scouts that the UI requested. Needs $root. Run-now requests are
# $STATE_ROOT/requests/<project>__<scout>.json. The file requests/notify-test.json asks for a test notice. A bad request is deleted. A busy pair is kept.
handle_requests() {
	local state=${STATE_ROOT:-/tmp/warden-state} f b p s
	for f in "$state"/requests/*.json; do
		[[ -f $f ]] || continue
		b=${f##*/}
		b=${b%.json}
		p=${b%%__*}
		s=${b#*__}
		if [[ $b == notify-test ]]; then
			rm -f "$f"
			notify_test || echo "notify test failed" >&2
			continue
		fi
		if [[ $b != *__* ]] || ! projects_json 2>/dev/null | jq -e --arg p "$p" --arg s "$s" 'any(.[]; .name == $p and (.scouts | index($s)))' >/dev/null 2>&1; then
			echo "bad run request, deleted: $b" >&2
			rm -f "$f"
			continue
		fi
		[[ ! -e $state/running/$b.json ]] || continue
		rm -f "$f"
		# </dev/null: claude and gh read stdin and would eat the rest of the loop input.
		# shellcheck disable=SC2154
		"$root/bin/run-scout.sh" "$p" "$s" </dev/null || echo "run failed: $p $s" >&2
	done
}

# --- secrets -----------------------------------------------------------------

secret_key_ok() { [[ $1 =~ ^(GH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|POSTHOG_API_KEY_[A-Z0-9_]+|SENTRY_TOKEN|WARDEN_POSTHOG_TOKEN|WARDEN_POSTHOG_HOST|HERMES_WEBHOOK_SECRET|COOLIFY_TOKEN_[A-Z0-9_]+)$ ]]; }

secrets_file() { printf '%s' "${SECRETS_ROOT:-/secrets}/overrides.env"; }

# load_overrides: export the KEY=VALUE lines of overrides.env. Allowlist again. Never source the file.
load_overrides() {
	local xt=0 f line k v
	[[ $- == *x* ]] && xt=1
	{ set +x; } 2>/dev/null
	f=$(secrets_file)
	[[ -f $f ]] || { ((xt)) && set -x; return 0; }
	while IFS= read -r line || [[ -n $line ]]; do
		k=${line%%=*}
		v=${line#*=}
		[[ $line == *=* && -n $v ]] && secret_key_ok "$k" && export "$k=$v"
	done <"$f"
	((xt)) && set -x
	return 0
}

# --- projects ----------------------------------------------------------------

# projects_file: the live file in the state. It is copied from the repository file one time (seed).
# Without a seed file, the live file is an empty list. The UI adds projects.
projects_file() {
	local s=${STATE_ROOT:-/tmp/warden-state} seed=${PROJECTS_FILE:-$root/projects.json}
	if [[ ! -f $s/projects.json ]]; then
		mkdir -p "$s"
		if [[ -f $seed ]]; then cp "$seed" "$s/projects.json.tmp"; else echo '[]' >"$s/projects.json.tmp"; fi
		mv "$s/projects.json.tmp" "$s/projects.json"
	fi
	printf '%s' "$s/projects.json"
}

# jq predicate: a valid project entry. $skills is the list of skill directories.
# shellcheck disable=SC2016
project_valid_jq='def valid:
  type == "object"
  and ((.name // "") | type == "string" and test("^[a-z0-9][a-z0-9-]*$"))
  and ((.repo // "") | type == "string" and test("^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$"))
  and ((.posthog_key_env // "") | type == "string" and test("^POSTHOG_API_KEY_[A-Z0-9_]+$"))
  and ((.scouts // null) | type == "array" and all(.[]; type == "string" and IN($skills[])));'

# projects_json: print the array of valid projects. Log each invalid entry. Never fails.
projects_json() {
	local f skills
	f=$(projects_file)
	skills=$(find "$root/skills" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | jq -R . | jq -sc .)
	jq -r --argjson skills "$skills" "$project_valid_jq"'
	  .[]? | select(valid | not) | "invalid project entry skipped: \(.name? // "?")"' "$f" >&2 2>/dev/null || echo "projects.json is not valid JSON" >&2
	jq -c --argjson skills "$skills" "$project_valid_jq"' [.[]? | select(valid)]' "$f" 2>/dev/null || echo '[]'
}

# project_cfg <name>: the valid entry of a project, compact JSON. Empty when missing.
project_cfg() { projects_json 2>/dev/null | jq -c --arg p "$1" '.[] | select(.name == $p)'; }

# --- network helpers (a key never goes into argv) ----------------------------

# ph_get <region> <key> <path>: GET a PostHog API path. Prints the body.
ph_get() {
	printf 'header = "Authorization: Bearer %s"\n' "$2" | curl -fsS --max-time 20 -K - "https://$1.posthog.com$3"
}

# --- Coolify (GET requests only) ---------------------------------------------
# settings.json holds coolify: [{name, url}]. The token of an instance is the secret COOLIFY_TOKEN_<NAME>,
# where <NAME> is the name in upper case with _ for each -. A name has no _, so the key maps back to one name.

# coolify_key <name>: the secret key of an instance.
coolify_key() { local n=${1^^}; printf 'COOLIFY_TOKEN_%s' "${n//-/_}"; }

# coolify_name <key>: the instance name of a secret key.
coolify_name() { local n=${1#COOLIFY_TOKEN_}; n=${n,,}; printf '%s' "${n//_/-}"; }

# coolify_url_ok <url>: https, a plain host, an optional port, no path, no user info.
coolify_url_ok() { ((${#1} <= 200)) && [[ $1 =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; }

# coolify_instances: print the array of valid instances from settings.json, with no trailing slash.
# settings.json is in the top directory of the state. The agent cannot write there.
coolify_instances() {
	local name url out='[]'
	while IFS=$'\t' read -r name url; do
		[[ $name =~ ^[a-z0-9]+(-[a-z0-9]+)*$ && ${#name} -le 30 ]] || continue
		url=${url%/}
		coolify_url_ok "$url" || continue
		out=$(jq -c --arg n "$name" --arg u "$url" '. + [{name: $n, url: $u}]' <<<"$out")
	done < <(jq -r '.coolify | arrays | .[] | select(type == "object") | [.name, .url] | select(all(.[]; type == "string")) | @tsv' "${STATE_ROOT:-/tmp/warden-state}/settings.json" 2>/dev/null)
	printf '%s' "$out"
}

# coolify_get <name> <path> <outfile>: GET <path> of an instance. Print the HTTP code, 000 without an answer.
# The token and the URL go through the config on stdin, so no token is in argv. No redirect is followed.
# The token comes from the environment (COOLIFY_TOKEN_<NAME>). Only the runner has it.
coolify_get() {
	{ set +x; } 2>/dev/null
	local url key tok code
	[[ $2 =~ ^/api/v1/[A-Za-z0-9/_?=\&.-]+$ ]] || { echo 000; return 1; }
	# COOLIFY_URL_PIN is the URL that inbox.sh checked. It is set only there.
	url=${COOLIFY_URL_PIN:-$(coolify_instances | jq -r --arg n "$1" '.[] | select(.name == $n) | .url')}
	key=$(coolify_key "$1")
	tok=${!key:-}
	[[ -n $url && -n $tok ]] || { echo 000; return 1; }
	# The token goes into a quoted line of the curl config. Refuse a character that ends the quote.
	[[ $tok != *[\"\\[:cntrl:]]* ]] || { echo 000; return 1; }
	# A token that was saved in Warden is bound to the URL that it was checked against (coolify-urls.json, written by inbox.sh).
	# A change of the URL alone then never sends the token to the new URL.
	if [[ -z ${COOLIFY_UNBOUND:-} ]] && grep -q "^$key=" "$(secrets_file)" 2>/dev/null; then
		[[ $(jq -r --arg n "$1" '.[$n] // empty' "$(dirname "$(secrets_file)")/coolify-urls.json" 2>/dev/null) == "$url" ]] || { echo 000; return 1; }
	fi
	code=$(printf 'url = "%s%s"\nheader = "Authorization: Bearer %s"\nheader = "Accept: application/json"\noutput = "%s"\n' "$url" "$2" "$tok" "$3" |
		curl -sS --proto '=https' --connect-timeout 10 --max-time 20 --max-filesize 8000000 -w '%{http_code}' -K - 2>/dev/null) || code=000
	printf '%s' "$code"
}

# ph_capture <event> <properties-json>: send one product event to PostHog. Never fails.
# It does nothing without WARDEN_POSTHOG_TOKEN (a project token). The host is WARDEN_POSTHOG_HOST,
# default https://eu.i.posthog.com. The token goes through the environment of jq and the body goes through
# stdin, so the token is in no argument list. Properties hold ids, statuses and numbers only: no title,
# no body, no URL, no error text. The agent does not get the token (agent_build passes a fixed list).
ph_capture() {
	[[ -n ${WARDEN_POSTHOG_TOKEN:-} ]] || return 0
	local xt=0 host=${WARDEN_POSTHOG_HOST:-https://eu.i.posthog.com}
	[[ $- == *x* ]] && xt=1
	{ set +x; } 2>/dev/null
	host=${host%/}
	[[ $host =~ ^https?://[A-Za-z0-9.:-]+$ ]] || host=https://eu.i.posthog.com
	# SC2016: the jq program uses env and $ variables on purpose.
	# shellcheck disable=SC2016
	jq -nc --arg ev "$1" --arg id "warden-$(hostname)" --argjson p "${2:-{\}}" \
		'{api_key: env.WARDEN_POSTHOG_TOKEN, event: $ev, distinct_id: $id, properties: ($p + {"$process_person_profile": false})}' 2>/dev/null |
		curl -sS -o /dev/null --max-time 5 -X POST -H 'Content-Type: application/json' --data-binary @- "$host/i/v0/e/" >/dev/null 2>&1 || true
	((xt)) && set -x
	return 0
}

# item_event <meta-file> <old-status> <new-status>: the event "warden item status changed".
item_event() {
	local d id
	d=$(dirname "$1")
	id=${d##*/}
	ph_capture "warden item status changed" "$(jq -c --arg id "$id" --arg o "$2" --arg n "$3" \
		'{project, scout, item_id: $id, kind: (.kind // "pr"), old_status: $o, new_status: $n}' "$1" 2>/dev/null || echo '{}')"
}

# --- tests -------------------------------------------------------------------
# Two volumes. TESTS_IN: the runner writes, the tester reads. TESTS_OUT: the tester writes, the runner and the UI read.

# test_result <project> <id> <status> <reason> <command> [started] [ended] [exit_code] [tail-file]
# Only the tester calls this. It writes into TESTS_OUT.
test_result() {
	local d=${TESTS_OUT:-/tests-out}/results/$1 tail=${9:-}
	mkdir -p "$d"
	jq -n --arg s "$3" --arg r "$4" --arg c "$5" --arg st "${6:-}" --arg en "${7:-}" --arg x "${8:-}" \
		--rawfile t "${tail:-/dev/null}" \
		'{status: $s, reason: (if $r == "" then null else $r end), command: $c,
		  started: (if $st == "" then null else $st end), ended: (if $en == "" then null else $en end),
		  exit_code: ($x | tonumber? // null), output_tail: $t}' >"$d/$2.json.tmp" && mv "$d/$2.json.tmp" "$d/$2.json"
}

# safe_rm <path>: remove a path under TESTS_IN. Refuse a symlink in the path itself or in a parent below TESTS_IN.
safe_rm() {
	local p=$1 root=${TESTS_IN:-/tests-in} cur
	[[ $p == "$root"/* ]] || return 1
	cur=$p
	while [[ $cur != "$root" && $cur != / ]]; do
		if [[ -L $cur ]]; then
			echo "tests: refused a symlink: $cur" >&2
			return 1
		fi
		cur=$(dirname "$cur")
	done
	rm -rf -- "$p"
}

# tests_gc: remove the queue entries and the work directories of the jobs that the tester finished.
# The tester writes TESTS_OUT/done/<project>__<id> after the result. The runner never writes into TESTS_OUT.
# A queue file that is newer than its marker is a new job with the same id: keep it.
tests_gc() {
	local in=${TESTS_IN:-/tests-in} out=${TESTS_OUT:-/tests-out} q b proj id
	for q in "$in"/queue/*.json; do
		[[ -e $q || -L $q ]] || continue
		b=${q##*/}
		b=${b%.json}
		[[ -L $q ]] && { safe_rm "$q" || true; continue; }
		proj=${b%%__*}
		id=${b#*__}
		if [[ $b != *__* || ! $proj =~ ^[a-z0-9][a-z0-9-]*$ || ! $id =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
			safe_rm "$q" || true
			continue
		fi
		[[ -f $out/done/$b && ! $q -nt $out/done/$b ]] || continue
		safe_rm "$in/work/$proj/$id" || true
		safe_rm "$q" || true
	done
	return 0
}
