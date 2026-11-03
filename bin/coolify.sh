#!/usr/bin/env bash
# Coolify helpers for the coolify scout and for the inbox check. Source this file after lib.sh.
# All requests are GET requests. The runner holds the tokens. The agent never gets a token.
# API facts (Coolify 4.5.3, see docs/domains/coolify.md):
# - GET /api/v1/applications lists the applications. The answer has fields that hold secrets (webhook secrets,
#   Compose content, custom labels), so jq keeps a list of allowed fields and drops all others.
# - GET /api/v1/deployments/applications/<uuid>?take=N lists the deployments. Each has a build log (field logs).
#   The build log can hold build arguments, so it is dropped.
# - GET /api/v1/applications/<uuid>/logs?lines=N gives {"logs": "..."}. It needs the ability read:sensitive.

COOLIFY_MAX_APPS=10
COOLIFY_LOG_LINES=2000
COOLIFY_LOG_BYTES=262144
COOLIFY_UUID_RE='^[A-Za-z0-9_-]{8,64}$'

# jq: type-checked, length-capped values. Coolify data is untrusted text. A value of the wrong type becomes null.
# txt: a string without control characters, at most n characters. sn: a string (at most n characters) or a number.
# shellcheck disable=SC2016
coolify_types_jq='def txt($n): if type == "string" then gsub("\\p{Cc}"; " ") | .[:$n] else null end;
  def sn($n): if type == "number" then . elif type == "string" then .[:$n] else null end;
  def bool: if type == "boolean" then . else null end;'

# jq: the repository as owner/name from git_repository. An image (dockerimage) has no repository.
# shellcheck disable=SC2016
coolify_repo_jq=$coolify_types_jq'
def repo:
  if (.build_pack // "") == "dockerimage" then null
  else ((.git_repository | if type == "string" then . else "" end) | sub("^(https?://|ssh://)(git@)?[^/]+/"; "") | sub("^git@[^:]+:"; "") | sub("\\.git$"; "") | sub("/+$"; "")
        | if test("^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$") then . else null end) end;'

# coolify_apps_brief <file>: print the array of applications with name, uuid, repository, fqdn and status.
# Each application is read on its own. One bad application does not fail the instance.
coolify_apps_brief() {
	jq -c "$coolify_repo_jq"'
	  [arrays | .[:500][] | select(type == "object" and (.uuid | type == "string"))
	   | try {uuid: (.uuid | txt(64)), name: ((.name | txt(120)) // ""), repo: repo, fqdn: ((.fqdn | txt(300)) // ""), status: ((.status | txt(60)) // ""),
	          build_pack: (.build_pack | txt(60))} catch empty]' "$1"
}

# coolify_app_detail <file> <uuid>: print the allowed fields of one application. No secret field, no env value.
coolify_app_detail() {
	jq -c --arg u "$2" "$coolify_repo_jq"'
	  [arrays | .[] | select(type == "object" and .uuid == $u)][0] // empty
	  | {uuid: (.uuid | txt(64)), name: ((.name | txt(120)) // ""), repo: repo, git_branch: (.git_branch | txt(120)), fqdn: ((.fqdn | txt(300)) // ""),
	     status: ((.status | txt(60)) // ""), build_pack: (.build_pack | txt(60)),
	     restart: {count: (.restart_count | sn(20)), max: (.max_restart_count | sn(20)), limit_reached: (.restart_limit_reached | bool),
	       last_restart_at: (.last_restart_at | txt(40)), last_online_at: (.last_online_at | txt(40))},
	     ports: {exposes: (.ports_exposes | txt(200)), mappings: (.ports_mappings | txt(200))},
	     health_check: {enabled: (.health_check_enabled | bool), dockerfile_healthcheck: (.custom_healthcheck_found | bool), type: (.health_check_type | txt(40)),
	       path: (.health_check_path | txt(200)), port: (.health_check_port | sn(20)), scheme: (.health_check_scheme | txt(20)), method: (.health_check_method | txt(20)),
	       interval: (.health_check_interval | sn(20)), timeout: (.health_check_timeout | sn(20)), retries: (.health_check_retries | sn(20)),
	       start_period: (.health_check_start_period | sn(20))},
	     limits: {memory: (.limits_memory | sn(40)), memory_reservation: (.limits_memory_reservation | sn(40)), memory_swap: (.limits_memory_swap | sn(40)),
	       cpus: (.limits_cpus | sn(40)), cpu_shares: (.limits_cpu_shares | sn(40))},
	     restart_policy: ((((.custom_docker_run_options | if type == "string" then . else "" end) | capture("--restart[= ](?<p>[a-z0-9:-]+)")? | .p) // null) | if . == null then null else txt(40) end)}' "$1"
}

# coolify_deployments <file>: print the last 10 deployments. The build log is not kept.
coolify_deployments() {
	jq -c "$coolify_types_jq"'[(.deployments | arrays)[:10][] | select(type == "object") | {deployment_uuid: (.deployment_uuid | txt(64)), status: (.status | txt(40)), commit: (.commit | txt(64)), commit_message: ((.commit_message | if type == "string" then split("\n")[0] else "" end) | txt(200)),
	  created_at: (.created_at | txt(40)), finished_at: (.finished_at | txt(40)), is_webhook: (.is_webhook | bool), rollback: (.rollback | bool),
	  pull_request_id: (.pull_request_id | sn(20))}]' "$1"
}

# coolify_logs <file>: print the log text. Remove the colour codes and the secrets, keep the last lines, bound the size.
coolify_logs() {
	jq -r '.logs // "" | if type == "string" then . else "" end' "$1" |
		sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' | tr -d '\r\000' | scrub_secrets | tail -n "$COOLIFY_LOG_LINES" | tail -c "$COOLIFY_LOG_BYTES"
}

# coolify_links <project-cfg-json>: print the valid links of a project, at most COOLIFY_MAX_APPS, one JSON object on each line.
coolify_links() {
	jq -c --arg re "$COOLIFY_UUID_RE" '[.coolify | arrays | .[] | select(type == "object")
	  | select((.instance | type == "string" and test("^[a-z0-9]+(-[a-z0-9]+)*$")) and (.app_uuid | type == "string" and test($re)))
	  | {instance, app_uuid}] | unique[:'"$COOLIFY_MAX_APPS"'][]' <<<"$1"
}

# coolify_collect_app <dir> <instance> <uuid> <apps-file>: write <dir>/app-<n>.json and <dir>/logs/<instance>--<uuid>.log.
# Print nothing. Return 1 and write the reason to <dir>/error.txt when the application cannot be read.
coolify_collect_app() {
	local dir=$1 inst=$2 uuid=$3 apps=$4 f=$1/get.tmp code detail deps logn='' note=''
	detail=$(coolify_app_detail "$apps" "$uuid") || detail=
	[[ -n $detail ]] || { echo "the application is not on the instance" >"$dir/error.txt"; return 1; }
	code=$(coolify_get "$inst" "/api/v1/deployments/applications/$uuid?take=10" "$f")
	[[ $code == 200 ]] && deps=$(coolify_deployments "$f") || deps='[]'
	[[ $code == 200 ]] || note="deployments: HTTP $code"
	: >"$dir/logs/$inst--$uuid.log"
	code=$(coolify_get "$inst" "/api/v1/applications/$uuid/logs?lines=$COOLIFY_LOG_LINES" "$f")
	case $code in
	200) coolify_logs "$f" >"$dir/logs/$inst--$uuid.log"; logn="logs/$inst--$uuid.log" ;;
	400) note+=" logs: the application is not running" ;;
	403) note+=" logs: the token has no read:sensitive ability" ;;
	*) note+=" logs: HTTP $code" ;;
	esac
	rm -f "$f"
	jq -nc --arg i "$inst" --argjson a "$detail" --argjson d "$deps" --arg l "$logn" --arg n "${note# }" \
		'$a + {instance: $i, deployments: $d, log_file: (if $l == "" then null else $l end), note: (if $n == "" then null else $n end)}' >"$dir/app-$inst--$uuid.json"
}

# coolify_prepare <project-cfg-json> <dir>: fetch the data of the linked applications into <dir>.
# <dir>/coolify.json has the data, <dir>/logs/ has the log files. Needs seen_file.
# Return 0 when the agent has news to read. Return 1 with coolify_note when it has not. Return 2 with coolify_note on an error.
# shellcheck disable=SC2034,SC2154  # coolify_note and coolify_digest are read by the caller. seen_file is set by the caller.
# Set coolify_digest. The digest does not change with the log lines, only with the deployments, the status,
# the settings and the shapes of the error lines (the digits are masked).
coolify_prepare() {
	local cfg=$1 dir=$2 link inst uuid n=0 ok=0 errs='[]' apps_cache seen_digest
	mkdir -p "$dir/logs" "$dir/apps"
	while IFS= read -r link; do
		[[ -n $link ]] || continue
		n=$((n + 1))
		inst=$(jq -r .instance <<<"$link")
		uuid=$(jq -r .app_uuid <<<"$link")
		apps_cache=$dir/apps/$inst.json
		if [[ ! -f $apps_cache ]]; then
			[[ $(coolify_get "$inst" /api/v1/applications "$apps_cache") == 200 ]] || { rm -f "$apps_cache"; : >"$dir/apps/$inst.failed"; }
		fi
		if [[ -f $dir/apps/$inst.failed ]]; then
			errs=$(jq -c --arg i "$inst" --arg u "$uuid" '. + [{instance: $i, app_uuid: $u, reason: "the instance did not answer, or the token is not valid"}]' <<<"$errs")
			continue
		fi
		if coolify_collect_app "$dir" "$inst" "$uuid" "$apps_cache"; then
			ok=$((ok + 1))
		else
			errs=$(jq -c --arg i "$inst" --arg u "$uuid" --arg r "$(cat "$dir/error.txt")" '. + [{instance: $i, app_uuid: $u, reason: $r}]' <<<"$errs")
		fi
	done < <(coolify_links "$cfg")
	if ((n == 0)); then coolify_note="No Coolify application is linked to this project."; return 1; fi
	if ((ok == 0)); then coolify_note="No linked Coolify application could be read."; return 2; fi
	coolify_shapes "$dir"
	jq -cs --argjson e "$errs" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{generated_at: $t, apps: ., errors: $e}' "$dir"/app-*.json >"$dir/coolify.json"
	coolify_digest=$(jq -c 'del(.generated_at) | .apps |= map(del(.error_lines, .restart.last_online_at))' "$dir/coolify.json" | sha256sum | cut -d' ' -f1)
	seen_digest=$(jq -r '.digest // empty' "$seen_file" 2>/dev/null || true)
	if [[ $seen_digest == "$coolify_digest" ]]; then coolify_note="Nothing changed on Coolify since the last run."; return 1; fi
	return 0
}

# coolify_shapes <dir>: add error_lines (the last 100 lines that look like errors) and error_shapes (a hash of the
# line shapes with the digits masked) to each app file.
# The lines go to jq through a file in <dir>, which only the runner can read. An argument over 128 KB fails.
coolify_shapes() {
	local f log shapes lines=$1/error-lines.tmp
	for f in "$1"/app-*.json; do
		log=$(jq -r '.log_file // empty' "$f")
		: >"$lines"
		shapes=''
		if [[ -n $log && -f $1/$log ]]; then
			{ grep -aiE 'error|fatal|panic|exception|traceback|fail|oom|killed|segfault|unhandled|refused|timed? ?out' "$1/$log" | tail -n 100; } >"$lines" || true
			shapes=$(sed -E 's/[0-9]+/N/g' "$lines" | sort -u | sha256sum | cut -d' ' -f1)
		fi
		jq -c --rawfile l "$lines" --arg s "$shapes" '. + {error_lines: ($l | rtrimstr("\n")), error_shapes: $s}' "$f" >"$f.tmp" && mv "$f.tmp" "$f"
	done
	rm -f "$lines"
}

# coolify_publish <dir> <state-dir>: give the agent a copy. The runner keeps the original in <dir>.
coolify_publish() {
	local f
	put_file "$1/coolify.json" "$2/coolify.json" || return 1
	agent_unlock "$2/coolify-logs" || true
	rm -rf -- "$2/coolify-logs" && mkdir -p "$2/coolify-logs" || return 1
	for f in "$1"/logs/*.log; do
		[[ -f $f ]] || continue
		put_file "$f" "$2/coolify-logs/${f##*/}" || return 1
	done
}

# coolify_mark_seen: remember the digest of this run. Only the runner writes the file. Needs seen_file.
coolify_mark_seen() {
	[[ -n ${coolify_digest:-} ]] || return 0
	jq -nc --arg d "$coolify_digest" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{digest: $d, at: $t}' >"$seen_file.tmp" && mv "$seen_file.tmp" "$seen_file"
}

# coolify_probe <name>: check the token of an instance (COOLIFY_TOKEN_<NAME> in the environment).
# Print "state<TAB>detail". The state is ok, warn, invalid or error.
# What a token can do is not in the API, so this is a probe:
# - 401 means the token is not valid. 403 means that the API is off, the IP is blocked or the token has no ability.
# - Logs of a running application need read:sensitive. 403 on the log request means that the token has not got it.
# - The webhook secrets of an application are in the list only for a token with write. A value there means write.
coolify_probe() {
	local name=$1 f code uuid write
	f=$(mktemp)
	code=$(coolify_get "$name" /api/v1/teams/current "$f")
	case $code in
	200) ;;
	401) rm -f "$f"; printf 'invalid\tCoolify refused the token\n'; return 0 ;;
	403) rm -f "$f"; printf 'invalid\tCoolify refused the request (API access is off, the IP is blocked, or the token has no ability)\n'; return 0 ;;
	*) rm -f "$f"; printf 'error\tNo usable answer from the instance (HTTP %s)\n' "$code"; return 0 ;;
	esac
	code=$(coolify_get "$name" /api/v1/applications "$f")
	if [[ $code != 200 ]]; then rm -f "$f"; printf 'error\tThe application list gave HTTP %s\n' "$code"; return 0; fi
	write=$(jq -r '[arrays | .[] | select(type == "object") | .manual_webhook_secret_github, .manual_webhook_secret_gitlab, .manual_webhook_secret_gitea, .manual_webhook_secret_bitbucket
	  | select(type == "string" and length > 0)] | length' "$f" 2>/dev/null || echo 0)
	uuid=$(jq -r '[arrays | .[] | select(type == "object" and ((.status // "") | startswith("running")))][0].uuid // empty' "$f" 2>/dev/null || true)
	if ((${write:-0} > 0)); then
		rm -f "$f"
		printf 'warn\tThis token can write: Coolify returns webhook secrets to it. Use a token with read and read:sensitive only.\n'
		return 0
	fi
	code=000
	[[ -z $uuid ]] || code=$(coolify_get "$name" "/api/v1/applications/$uuid/logs?lines=1" "$f")
	rm -f "$f"
	case $code in
	403) printf 'ok\tNo read:sensitive: the coolify scout cannot read logs. Add read:sensitive for the log analysis.\n' ;;
	200) printf 'ok\tThe token can read sensitive data (read:sensitive). Coolify also returns env values and secrets to this token. The runner drops them and the agent never gets them.\n' ;;
	*) printf 'ok\tRead access works. Whether the token has read:sensitive (logs) is not known: no running application to test.\n' ;;
	esac
}
