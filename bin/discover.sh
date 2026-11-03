#!/usr/bin/env bash
# Write the discovery file (what the keys can reach) and the project check file to the inbox.
# Run it in each loop chunk. Discovery runs every 15 minutes, or at once when discover.request exists.
# Never write a key value into a file. Usage: discover.sh
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
STATE_ROOT=${STATE_ROOT:-/tmp/warden-state}
INBOX_ROOT=${INBOX_ROOT:-/inbox}
export STATE_ROOT
# shellcheck source=/dev/null
source "$root/bin/lib.sh"
# shellcheck source=/dev/null
source "$root/bin/coolify.sh"
[[ -d $INBOX_ROOT ]] || exit 0
load_overrides
overrides=$(secrets_file)
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
atomic() { # file: write stdin to the file by rename
	cat >"$1.tmp" && mv "$1.tmp" "$1"
}

# ph_all <region> <key> <path>: print the JSON array of all results of a paginated PostHog list.
ph_all() {
	local all='[]' body next p=$3 _
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		body=$(ph_get "$1" "$2" "$p") || return 1
		all=$(jq -nc --argjson a "$all" --argjson b "$body" '$a + ($b.results // [])') || return 1
		next=$(jq -r '.next // empty' <<<"$body")
		[[ -n $next ]] || break
		p=${next#https://"$1".posthog.com}
	done
	printf '%s' "$all"
}

# sentry_get <host> <token> <path>: print the body. The response headers go to $hdr.
hdr=$(mktemp)
trap 'rm -f "$hdr"' EXIT
sentry_get() {
	printf 'header = "Authorization: Bearer %s"\n' "$2" | curl -fsS --max-time 20 -D "$hdr" -K - "https://$1$3"
}

# sentry_all <host> <token>: print the array of projects. Follow the Link header.
sentry_all() {
	local all='[]' body url=/api/0/projects/ _
	for _ in 1 2 3 4 5 6 7 8 9 10; do
		body=$(sentry_get "$1" "$2" "$url") || return 1
		all=$(jq -nc --argjson a "$all" --argjson b "$body" '$a + $b') || return 1
		url=$(grep -oE '<[^>]+>; rel="next"; results="true"' "$hdr" | head -n 1 | sed 's/^<//; s/>.*//')
		[[ -n $url ]] || break
		url=/${url#https://*/}
	done
	printf '%s' "$all"
}

discover_posthog() { # key-env: print one JSON object
	local k=$1 src region ok=false detail=null orgs projects='[]' out=
	if [[ -f $overrides ]] && grep -q "^$k=" "$overrides"; then src=ui; else src="env"; fi
	for region in eu us; do
		if orgs=$(ph_all "$region" "${!k}" /api/organizations/) && out=$(ph_all "$region" "${!k}" /api/projects/); then
			ok=true
			projects=$(jq -nc --argjson o "$orgs" --argjson p "$out" \
				'[$p[] | .organization as $oid | {id: (.id | tostring), name, org_id: $oid, org_name: (([$o[] | select(.id == $oid)][0].name) // null)}]')
			break
		fi
	done
	[[ $ok == true ]] || { detail='"the key was refused or PostHog did not answer"'; region=eu; }
	jq -nc --arg k "$k" --arg s "$src" --argjson ok "$ok" --argjson d "$detail" --arg r "$region" --argjson p "$projects" \
		'{key_env: $k, source: $s, ok: $ok, detail: $d, region: $r, projects: $p}'
}

discover_sentry() { # print one JSON object, or null without a token
	local host list="" ok=false
	[[ -n ${SENTRY_TOKEN:-} ]] || { echo null; return; }
	for host in sentry.io de.sentry.io; do
		if list=$(sentry_all "$host" "$SENTRY_TOKEN"); then
			ok=true
			[[ $(jq length <<<"$list") -eq 0 ]] || break
		fi
	done
	[[ $ok == true ]] || list='[]'
	jq -nc --argjson ok "$ok" --argjson l "$list" \
		'{ok: $ok, detail: (if $ok | not then "Sentry refused the token or did not answer" elif ($l | length) == 0 then "no projects found" else null end),
		  projects: [$l[] | {org: .organization.slug, slug, name, platform}]}'
}

# discover_coolify: print the array of instances with their applications (name, uuid, repository, fqdn, status).
# coolify_apps_brief keeps the allowed fields only: no env value and no secret field.
discover_coolify() {
	local name url key f code out='[]' ok detail apps
	f=$(mktemp)
	while IFS=$'\t' read -r name url; do
		key=$(coolify_key "$name")
		ok=false
		apps='[]'
		detail=
		if [[ -z ${!key:-} ]]; then
			detail="$key is not set"
		else
			code=$(coolify_get "$name" /api/v1/applications "$f")
			if [[ $code == 200 ]] && apps=$(coolify_apps_brief "$f"); then
				ok=true
			else
				apps='[]'
				detail="Coolify answered HTTP $code"
				[[ $code != 000 ]] || detail="no answer from $name"
			fi
		fi
		out=$(jq -nc --argjson a "$out" --arg n "$name" --arg u "$url" --argjson ok "$ok" --arg d "$detail" --argjson p "$apps" \
			'$a + [{name: $n, url: $u, ok: $ok, detail: (if $d == "" then null else $d end), apps: $p}]')
	done < <(coolify_instances | jq -r '.[] | [.name, .url] | @tsv')
	rm -f "$f"
	printf '%s' "$out"
}

discover() {
	local login k gh_ok=true gh_detail=null ph='[]'
	login=$(gh api user -q .login 2>/dev/null) || { gh_ok=false; gh_detail='"gh could not read the user"'; login=; }
	for k in $(compgen -v POSTHOG_API_KEY_); do
		[[ -n ${!k} ]] || continue
		ph=$(jq -nc --argjson a "$ph" --argjson o "$(discover_posthog "$k")" '$a + [$o]')
	done
	jq -nc --arg t "$(now)" --argjson ok "$gh_ok" --arg l "$login" --argjson d "$gh_detail" --argjson ph "$ph" --argjson s "$(discover_sentry)" --argjson c "$(discover_coolify)" \
		'{updated_at: $t, github: {ok: $ok, login: (if $l == "" then null else $l end), detail: $d}, posthog: $ph, sentry: $s, coolify: $c}' |
		atomic "$INBOX_ROOT/discovery.json"
}

disc=$INBOX_ROOT/discovery.json
if [[ -e $INBOX_ROOT/discover.request ]]; then
	rm -f "$INBOX_ROOT/discover.request"
	discover
elif [[ ! -f $disc ]] || (($(date +%s) - $(stat -c %Y "$disc") >= 900)); then
	discover
fi

# --- project check -----------------------------------------------------------

ps=$INBOX_ROOT/project-status.json
prev='{}'
[[ ! -f $ps ]] || prev=$(jq -c 'if type == "object" then . else {} end' "$ps" 2>/dev/null || echo '{}')

# check_project <json>: print the status object (without the hash).
check_project() {
	local c=$1 repo kenv id region key org proj host detail=() repo_ok=true ph_ok=true s_ok=null
	repo=$(jq -r .repo <<<"$c")
	kenv=$(jq -r .posthog_key_env <<<"$c")
	id=$(jq -r .posthog_project_id <<<"$c")
	region=$(jq -r '.posthog_region // "eu"' <<<"$c")
	key=${!kenv:-}
	gh repo view "$repo" --json name >/dev/null 2>&1 || { repo_ok=false; detail+=("no access to the repository"); }
	if [[ -z $key ]]; then
		ph_ok=false
		detail+=("$kenv is not set")
	elif ! ph_get "$region" "$key" "/api/projects/$id/" >/dev/null 2>&1; then
		ph_ok=false
		detail+=("PostHog project $id is not reachable with $kenv")
	fi
	if jq -e '.sentry.org and .sentry.project' <<<"$c" >/dev/null 2>&1; then
		org=$(jq -r .sentry.org <<<"$c")
		proj=$(jq -r .sentry.project <<<"$c")
		s_ok=false
		if [[ -z ${SENTRY_TOKEN:-} ]]; then
			detail+=("SENTRY_TOKEN is not set")
		else
			for host in sentry.io de.sentry.io; do
				if sentry_get "$host" "$SENTRY_TOKEN" "/api/0/projects/$org/$proj/" >/dev/null 2>&1; then s_ok=true; break; fi
			done
			[[ $s_ok == true ]] || detail+=("Sentry project $org/$proj is not reachable")
		fi
	fi
	jq -nc --argjson r "$repo_ok" --argjson p "$ph_ok" --argjson s "$s_ok" --arg d "$(IFS=';'; echo "${detail[*]:-}")" --arg t "$(now)" \
		'{repo_ok: $r, posthog_ok: $p, sentry_ok: $s, detail: (if $d == "" then null else $d end), checked_at: $t}'
}

# stale <entry>: succeed when the entry failed and is older than 15 minutes.
stale() {
	local t
	jq -e '.repo_ok and .posthog_ok and (.sentry_ok != false)' <<<"$1" >/dev/null && return 1
	t=$(date -d "$(jq -r .checked_at <<<"$1")" +%s 2>/dev/null) || return 0
	(($(date +%s) - t >= 900))
}

out=$prev
changed=0
while IFS= read -r c; do
	name=$(jq -r .name <<<"$c")
	hash=$(jq -cS . <<<"$c" | sha256sum | cut -d' ' -f1)
	old=$(jq -c --arg n "$name" '.[$n] // empty' <<<"$prev")
	if [[ -n $old && $(jq -r .hash <<<"$old") == "$hash" ]] && ! stale "$old"; then continue; fi
	out=$(jq -c --arg n "$name" --arg h "$hash" --argjson s "$(check_project "$c")" '.[$n] = ({hash: $h} + $s)' <<<"$out")
	changed=1
done < <(projects_json 2>/dev/null | jq -c '.[]')
# Drop the entries of removed projects.
out=$(jq -c --argjson names "$(projects_json 2>/dev/null | jq -c '[.[].name]')" 'with_entries(select(.key | IN($names[])))' <<<"$out")
if ((changed)) || [[ $out != "$prev" ]]; then
	printf '%s\n' "$out" | atomic "$ps"
fi
