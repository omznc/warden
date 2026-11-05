#!/usr/bin/env bash
# Send the items that a person approved in the UI to GitHub: issues, comments and draft PRs.
# Usage: submit-approved.sh
# Reads $STATE_ROOT/<project>/pending/<id>/meta.json. Only this script uses the GitHub token.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
STATE_ROOT=${STATE_ROOT:-/tmp/warden-state}
WORK_ROOT=${WORK_ROOT:-/tmp/warden-work}
shopt -s nullglob
# shellcheck source=/dev/null
source "$root/bin/lib.sh"
load_overrides

# One caller at a time: the loop in run-all.sh and the pass call this script. Another caller exits at once.
# The lock file is in the top of the state, where the agent cannot write.
mkdir -p "$STATE_ROOT"
old_umask=$(umask)
umask 077
exec 9>"$STATE_ROOT/submit.lock"
umask "$old_umask"
flock -n 9 || exit 0

# gq: git with all output on stderr. Stdout of a submit function holds the URL and nothing else.
gq() { gitc "$@" >&2; }

setmeta() { # meta-file jq-args...; atomic write
	local f=$1
	shift
	jq "$@" "$f" >"$f.tmp" && mv "$f.tmp" "$f"
}

ledger_set() { # project key number
	local ledger=$STATE_ROOT/$1/ledger.json
	[[ -f $ledger ]] || echo '{}' >"$ledger"
	jq --arg k "$2" --argjson n "$3" '.[$k] = $n' "$ledger" >"$ledger.tmp" && mv "$ledger.tmp" "$ledger"
}

# body_out <meta-file>: print the body and the footer. Skip the footer when the body already has the marker.
body_out() {
	jq -r '(.body) as $b | (.footer // "") as $f
	  | ([$f | match("<!-- warden:fp=[^ ]+ -->").string] | first) as $m
	  | if $f == "" or ($m != null and ($b | contains($m))) or ($b | contains($f | ltrimstr("\n\n"))) then $b else $b + $f end' "$1"
}

submit_pr() { # meta-file repo; prints the PR url
	local meta=$1 repo=$2 d proj fp checkout def br rel url
	d=$(dirname "$meta")
	proj=$(jq -r '.project' "$meta")
	fp=$(jq -r '.fingerprint' "$meta")
	checkout=$WORK_ROOT/$proj
	br=warden/$fp
	gh auth setup-git >&2
	[[ -d $checkout/.git ]] || gh repo clone "$repo" "$checkout" >/dev/null
	def=$(gh repo view "$repo" --json defaultBranchRef -q .defaultBranchRef.name)
	# run-scout.sh leaves the checkout on the PR branch. Git refuses to fetch into a checked-out branch.
	gq -C "$checkout" fetch -q origin || return 1
	gq -C "$checkout" checkout -q -f --detach "origin/$def" || return 1
	gq -C "$checkout" fetch -q --force "$d/bundle" "refs/heads/$br:refs/heads/$br" || return 1
	# The default branch can move between the run and the approval. Do not open a PR that conflicts with it.
	if ! gitc -C "$checkout" merge-tree --write-tree "origin/$def" "$br" >/dev/null 2>&1; then
		echo "the change conflicts with $def now; the next scout run can propose it again"
		return 3
	fi
	gq -C "$checkout" push -q origin "$br" || return 1
	rel=$(jq -r '.related_issue // empty' "$meta")
	{ jq -r '.body' "$meta"; [[ -z $rel ]] || printf '\nRefs #%s\n' "$rel"; } >"$d/body.md"
	gh label create warden -R "$repo" --force >/dev/null 2>&1
	url=$(gh pr create -R "$repo" --draft --head "$br" --base "$def" --title "$(jq -r '.title' "$meta")" \
		--body-file "$d/body.md" --label warden) || { rm -f "$d/body.md"; return 1; }
	rm -f "$d/body.md"
	ledger_set "$proj" "pr:$fp" "${url##*/}" || echo "ledger update failed" >&2
	printf '%s' "$url"
}

submit_pr_update() { # meta-file repo; prints the PR url. Pushes only when the remote branch is still at base_sha.
	local meta=$1 repo=$2 d proj n base checkout info ref remote tmpref
	d=$(dirname "$meta")
	proj=$(jq -r '.project' "$meta")
	n=$(jq -r '.number // empty' "$meta")
	base=$(jq -r '.base_sha // empty' "$meta")
	[[ $n =~ ^[0-9]+$ && $base =~ ^[0-9a-f]{40}$ ]] || { echo "bad PR number or base"; return 1; }
	checkout=$WORK_ROOT/$proj
	gh auth setup-git >&2
	[[ -d $checkout/.git ]] || gh repo clone "$repo" "$checkout" >/dev/null
	info=$(gh pr view "$n" -R "$repo" --json headRefName,state,url) || { echo "cannot read PR $n"; return 1; }
	ref=$(jq -r '.headRefName' <<<"$info")
	# Only a warden branch gets a push.
	[[ $(jq -r '.state' <<<"$info") == OPEN && $ref == warden/* ]] || { echo "PR $n is not an open warden PR"; return 1; }
	gq -C "$checkout" fetch -q origin "$ref" || { echo "fetch of $ref failed"; return 1; }
	remote=$(gitc -C "$checkout" rev-parse FETCH_HEAD)
	[[ $remote == "$base" ]] || { echo "the branch moved since the run (remote ${remote:0:7}, base ${base:0:7}); nothing pushed"; return 1; }
	tmpref=refs/warden/submit-$n
	gq -C "$checkout" fetch -q --force "$d/bundle" "refs/heads/warden/ci-update:$tmpref" || { echo "bundle fetch failed"; return 1; }
	gq -C "$checkout" merge-base --is-ancestor "$base" "$tmpref" || { echo "the update does not build on the base"; return 1; }
	# A plain push. Git refuses it when it is not a fast-forward.
	gq -C "$checkout" push -q origin "$tmpref:refs/heads/$ref" || { echo "push failed"; return 1; }
	jq -r '.url' <<<"$info"
}

submit_issue() { # meta-file repo; prints the issue url
	local meta=$1 repo=$2 d url
	d=$(dirname "$meta")
	body_out "$meta" >"$d/body.md"
	gh label create warden -R "$repo" --force >/dev/null 2>&1
	url=$(gh issue create -R "$repo" --title "$(jq -r '.title' "$meta")" --body-file "$d/body.md" --label warden) || { rm -f "$d/body.md"; return 1; }
	rm -f "$d/body.md"
	ledger_set "$(jq -r '.project' "$meta")" "$(jq -r '.fingerprint' "$meta")" "${url##*/}" || echo "ledger update failed" >&2
	printf '%s' "$url"
}

submit_comment() { # meta-file repo; prints the issue url
	local meta=$1 repo=$2 d n
	d=$(dirname "$meta")
	n=$(jq -r '.number // empty' "$meta")
	[[ $n =~ ^[0-9]+$ ]] || { echo "bad issue number"; return 1; }
	body_out "$meta" >"$d/body.md"
	gh issue comment "$n" -R "$repo" --body-file "$d/body.md" >/dev/null || { rm -f "$d/body.md"; return 1; }
	rm -f "$d/body.md"
	printf 'https://github.com/%s/issues/%s' "$repo" "$n"
}

submit_one() { # meta-file; prints the url
	local meta=$1 d proj fp repo kind
	local -a scan
	d=$(dirname "$meta")
	proj=$(jq -r '.project' "$meta")
	fp=$(jq -r '.fingerprint' "$meta")
	kind=$(jq -r '.kind // "pr"' "$meta")
	[[ $proj =~ ^[a-z0-9][a-z0-9-]*$ && $fp =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "bad project or fingerprint"; return 1; }
	[[ $kind == pr || $kind == pr-update || $kind == issue || $kind == comment ]] || { echo "bad kind"; return 1; }
	repo=$(project_cfg "$proj" | jq -r '.repo // empty')
	[[ -n $repo ]] || { echo "project $proj is not in projects.json"; return 1; }
	# Scan again before each write: the secret list can change after the item was saved.
	jq -r '.title, .body, (.footer // "")' "$meta" >"$d/scan.tmp"
	scan=("$d/scan.tmp")
	[[ $kind != pr* ]] || scan+=("$d/patch.diff")
	if secret_hit "${scan[@]}"; then
		rm -f "$d/scan.tmp"
		echo "blocked-secret"
		return 2
	fi
	rm -f "$d/scan.tmp"
	"submit_${kind//-/_}" "$meta" "$repo"
}

# record_feedback <meta-file>: tell the scout about a rejection, one time. The harness reads the scratchpad.
record_feedback() {
	local meta=$1 proj scout fp line
	[[ $(jq -r '.feedback_recorded // false' "$meta") != true ]] || return 0
	proj=$(jq -r '.project' "$meta")
	scout=$(jq -r '.scout' "$meta")
	fp=$(jq -r '.fingerprint' "$meta")
	[[ $proj =~ ^[a-z0-9][a-z0-9-]*$ && $scout =~ ^[a-z0-9][a-z0-9-]*$ && $fp =~ ^[a-z0-9][a-z0-9-]*$ ]] || return 0
	line=$(jq -r --arg d "$(date -u +%Y-%m-%d)" '
	  def one: gsub("[\\r\\n]+"; " ");
	  ((.reject_reason // "") | one | .[:300]) as $r
	  | "- \($d) REJECTED \(.fingerprint) \"\((.title // "") | one | gsub("\""; "'"'"'") | .[:200])\": \(if ($r | gsub("\\s"; "")) == "" then "no reason" else $r end)"' "$meta") || return 0
	# The scratchpad belongs to the agent. Write it only while no scout of the project runs, so the agent
	# cannot swap the file for a symlink between the check and the write. A busy lock: a later round retries.
	if ! checkout_lock "$proj" || ! flock -n "$CHECKOUT_FD"; then
		checkout_unlock
		return 0
	fi
	mkdir -p "$STATE_ROOT/$proj/$scout"
	ensure_file "$STATE_ROOT/$proj/$scout/scratchpad.md" && printf '%s\n' "$line" >>"$STATE_ROOT/$proj/$scout/scratchpad.md"
	local rc=$?
	checkout_unlock
	((rc == 0)) || return 0
	setmeta "$meta" '.feedback_recorded = true'
	item_event "$meta" pending rejected
}

label() { case $1 in pr) echo "draft PR" ;; *) echo "$1" ;; esac; }

github_url_ok() { [[ $1 =~ ^https://github\.com/[^[:space:]]+$ ]]; }
# A saved error message is one short line from our own code. It is never raw output.
short_err() {
	local m=${1%%$'\n'*} f bad=0
	m=${m:0:200}
	[[ -n $m && $m != "+"* ]] || bad=1
	if ((!bad)); then
		f=$(mktemp)
		printf '%s\n' "$m" >"$f"
		if secret_hit "$f"; then bad=1; fi
		rm -f "$f"
	fi
	((!bad)) || m="The write failed. Check GitHub before you retry."
	printf '%s' "$m"
}

# An item in submitting at the start of a pass was cut short. It may have written to GitHub: do not retry it.
# SC2016: the jq programs use $ variables on purpose.
# shellcheck disable=SC2016
for meta in "$STATE_ROOT"/*/pending/*/meta.json; do
	[[ $(jq -r '.status' "$meta" 2>/dev/null) == submitting ]] || continue
	setmeta "$meta" '.status = "error" | .error = "Interrupted during submit. Check GitHub before you retry."'
	item_event "$meta" submitting error
	"$root/bin/notify.sh" "warden: submit interrupted: $(jq -r '.title' "$meta"). Check GitHub before you retry." || true
done

# mark_stale: a pending item older than stale_days turns stale. Nobody submits a stale item.
# The status is checked again inside the jq program, so a decision of the UI since the read is kept.
# SC2016: the jq program uses $ variables on purpose.
# shellcheck disable=SC2016
mark_stale() {
	local meta limit at d
	limit=$(($(date +%s) - $(stale_days) * 86400))
	at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
	for meta in "$STATE_ROOT"/*/pending/*/meta.json; do
		[[ $(jq -r '.status' "$meta" 2>/dev/null) == pending ]] || continue
		(($(item_epoch "$meta") < limit)) || continue
		setmeta "$meta" --arg at "$at" 'if .status == "pending" then .status = "stale" | .stale_at = $at else . end' || continue
		if [[ $(jq -r '.status' "$meta" 2>/dev/null) == stale ]]; then
			d=$(dirname "$meta")
			rm -f "$d/bundle" "$d/patch.diff"
			item_event "$meta" pending stale
		fi
	done
}
mark_stale

# shellcheck disable=SC2016
for meta in "$STATE_ROOT"/*/pending/*/meta.json; do
	status=$(jq -r '.status' "$meta" 2>/dev/null) || continue
	case $status in
	approved)
		title=$(jq -r '.title' "$meta")
		kind=$(jq -r '.kind // "pr"' "$meta")
		# A PR uses the checkout that a scout run uses. Take the lock of the project.
		# When a run holds it, leave the item approved: a later round sends it.
		# A bad project name takes no lock: submit_one refuses it.
		if [[ $kind == pr || $kind == pr-update ]]; then
			proj=$(jq -r '.project' "$meta")
			if checkout_lock "$proj" && ! flock -n "$CHECKOUT_FD"; then
				checkout_unlock
				continue
			fi
		fi
		# Mark the item before the write, so that a crash cannot cause a second write.
		setmeta "$meta" '.status = "submitting"' || { checkout_unlock; continue; }
		out=$(submit_one "$meta")
		rc=$?
		# The git work is done. Release the checkout.
		checkout_unlock
		if ((rc == 0)) && github_url_ok "$out"; then
			at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
			setmeta "$meta" --arg u "$out" --arg at "$at" '.status = "submitted" | .url = $u | .submitted_at = $at' || setmeta "$meta" --arg u "$out" --arg at "$at" '.status = "submitted" | .url = $u | .submitted_at = $at' || true
			item_event "$meta" approved submitted
			"$root/bin/notify.sh" "warden: $(label "$kind") submitted: $title $out" || true
		elif ((rc == 0)); then
			setmeta "$meta" '.status = "error" | .error = "The write returned no valid GitHub URL. Check GitHub before you retry."'
			"$root/bin/notify.sh" "warden: $(label "$kind") submit unclear: $title. Check GitHub." || true
		elif ((rc == 3)); then
			# The change conflicts with the default branch. A stale item does not block the fingerprint: the next run can propose it again.
			at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
			setmeta "$meta" --arg at "$at" --arg e "$(short_err "$out")" '.status = "stale" | .stale_at = $at | .error = $e'
			rm -f "$(dirname "$meta")/bundle" "$(dirname "$meta")/patch.diff"
			item_event "$meta" approved stale
		else
			setmeta "$meta" --arg e "$(short_err "$out")" '.status = "error" | .error = $e'
			if [[ $out == blocked-secret ]]; then
				"$root/bin/notify.sh" "warden: blocked a write that looked like a secret ($(jq -r '"\(.project)/\(.scout)"' "$meta"))" || true
			else
				"$root/bin/notify.sh" "warden: $(label "$kind") submit failed: $title" || true
			fi
		fi
		[[ $(jq -r '.status' "$meta" 2>/dev/null) != error ]] || item_event "$meta" approved error
		;;
	rejected)
		rm -f "$(dirname "$meta")/bundle" "$(dirname "$meta")/patch.diff"
		record_feedback "$meta"
		;;
	esac
done
