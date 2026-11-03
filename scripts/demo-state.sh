#!/usr/bin/env bash
# Build a demo state for the Warden UI. All data is invented.
# Usage: scripts/demo-state.sh <dir>
# Then run the UI with:
#   STATE_ROOT=<dir>/state INBOX_ROOT=<dir>/inbox TESTS_ROOT=<dir>/tests-out \
#   INTERVAL_HOURS=12 WARDEN_PASSWORD=demo bun run dev
# The script needs bash, jq and git.
set -euo pipefail

out=${1:?usage: demo-state.sh <dir>}
S=$out/state I=$out/inbox T=$out/tests-out
rm -rf "$S" "$I" "$T"
mkdir -p "$S" "$I" "$T"
w=$(mktemp -d)
trap 'rm -rf "$w"' EXIT

now=$(date -u +%s)
iso() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
stamp() { date -u -d "@$1" +%Y%m%dT%H%M%SZ; }
# rt <cycle> <slot>: start time of a run. Cycle 13 is the latest, 24 hours apart, so each of 14 days has runs.
rt() { echo $((now - 3 * 3600 - (13 - $1) * 86400 + $2 * 360)); }

# --- projects and settings ---------------------------------------------------
jq -n '[
  {name: "web", repo: "acme/web", posthog_project_id: "12345", posthog_key_env: "POSTHOG_API_KEY_PERSONAL", posthog_region: "eu",
   posthog_ui: "https://eu.posthog.com/project/12345", notes: "Web app of Acme.", test_command: "bun test",
   scouts: ["signals-scout-error-tracking", "signals-scout-web-vitals", "signals-scout-product-analytics", "signals-scout-session-replay", "github-issues", "instrumentation-gaps", "warden-ci"]},
  {name: "api", repo: "acme/api", posthog_project_id: "12346", posthog_key_env: "POSTHOG_API_KEY_PERSONAL", posthog_region: "eu",
   posthog_ui: "https://eu.posthog.com/project/12346", notes: "Backend API of Acme. No web pages.",
   coolify: [{instance: "home", app_uuid: "demo-api-0001"}, {instance: "home", app_uuid: "demo-worker-0002"}],
   scouts: ["signals-scout-error-tracking", "signals-scout-logs", "instrumentation-gaps", "coolify", "warden-ci"]},
  {name: "mobile", repo: "acme/mobile", posthog_project_id: "12347", posthog_key_env: "POSTHOG_API_KEY_PERSONAL", posthog_region: "eu",
   posthog_ui: "https://eu.posthog.com/project/12347", notes: "Mobile app of Acme. Paused.", enabled: false,
   scouts: ["signals-scout-error-tracking", "signals-scout-product-analytics"]}
]' >"$S/projects.json"

jq -n '{daily_cost_cap_usd: 12, stale_days: 30, reject_days: 30,
  hermes_webhook_url: "https://hermes.example.com/webhooks/warden", warden_url: "https://warden.example.com",
  coolify: [{name: "home", url: "https://coolify.example.com"}],
  projects: {web: {mode: "prs", auto_submit: false}, api: {mode: "prs", auto_submit: false}, mobile: {mode: "dry", auto_submit: false}}}' >"$S/settings.json"
echo "$(rt 13 0)" >"$S/last-run"
jq -n --arg at "$(iso $((now - 3600)))" '{ok: true, status: "200", at: $at}' >"$S/notify-test.json"

# --- inbox: secret status and discovery (names and states only) -----------------
key() { jq -n --arg s "$2" --arg d "$3" --arg at "$(iso $((now - 5 * 86400)))" '{source: $s, state: "ok", detail: (if $d == "" then null else $d end), updated_at: $at}'; }
jq -n \
	--argjson gh "$(key GH_TOKEN env 'Logged in as acme-bot.')" \
	--argjson cl "$(key CLAUDE_CODE_OAUTH_TOKEN env '')" \
	--argjson ph "$(key POSTHOG_API_KEY_PERSONAL ui 'Reaches 3 projects.')" \
	--argjson pt "$(key WARDEN_POSTHOG_TOKEN ui '')" \
	--argjson phost "$(key WARDEN_POSTHOG_HOST ui '')" \
	--argjson hs "$(key HERMES_WEBHOOK_SECRET ui '')" \
	--argjson co "$(key COOLIFY_TOKEN_HOME ui 'Reaches 4 apps.')" \
	'{GH_TOKEN: $gh, CLAUDE_CODE_OAUTH_TOKEN: $cl, POSTHOG_API_KEY_PERSONAL: $ph, WARDEN_POSTHOG_TOKEN: $pt, WARDEN_POSTHOG_HOST: $phost, HERMES_WEBHOOK_SECRET: $hs, COOLIFY_TOKEN_HOME: $co}' >"$I/status.json"
# The UI reads CLAUDE_CODE_OAUTH_TOKEN as set from env. The others come from the UI.
jq '.GH_TOKEN.source = "env"' "$I/status.json" >"$w/s.json" && mv "$w/s.json" "$I/status.json"

jq -n --arg at "$(iso $((now - 1800)))" '{
  updated_at: $at,
  github: {ok: true, login: "acme-bot", detail: ""},
  posthog: [{key_env: "POSTHOG_API_KEY_PERSONAL", source: "ui", ok: true, region: "eu", projects: [
    {id: "12345", name: "Acme web", org_id: "org-demo", org_name: "Acme"},
    {id: "12346", name: "Acme api", org_id: "org-demo", org_name: "Acme"},
    {id: "12347", name: "Acme mobile", org_id: "org-demo", org_name: "Acme"}]}],
  sentry: null,
  coolify: [{name: "home", url: "https://coolify.example.com", ok: true, detail: null, apps: [
    {uuid: "demo-api-0001", name: "acme-api", repo: "acme/api", fqdn: "https://api.example.com", status: "running:healthy", build_pack: "dockerfile"},
    {uuid: "demo-worker-0002", name: "acme-worker", repo: "acme/api", fqdn: "", status: "running:healthy", build_pack: "dockerfile"},
    {uuid: "demo-web-0003", name: "acme-web", repo: "acme/web", fqdn: "https://www.example.com", status: "running:healthy", build_pack: "nixpacks"},
    {uuid: "demo-docs-0004", name: "acme-docs", repo: "acme/docs", fqdn: "https://docs.example.com", status: "exited:unhealthy", build_pack: "static"}]}]
}' >"$I/discovery.json"
jq -n --arg at "$(iso $((now - 1800)))" '{web: {repo_ok: true, posthog_ok: true, sentry_ok: null, checked_at: $at},
  api: {repo_ok: true, posthog_ok: true, sentry_ok: null, checked_at: $at}, mobile: {repo_ok: true, posthog_ok: true, sentry_ok: null, checked_at: $at}}' >"$I/project-status.json"

# --- pending items ---------------------------------------------------------------
# item <project> <id> <kind> <scout> <severity> <number> <created-epoch> <status> <extra-json> <title>; the body comes on stdin.
item() {
	local d=$S/$1/pending/$2
	mkdir -p "$d"
	jq -n --arg kind "$3" --arg fp "$2" --arg project "$1" --arg scout "$4" --arg sev "$5" --arg num "$6" --arg created "$(iso "$7")" \
		--arg status "$8" --argjson extra "$9" --arg title "${10}" --rawfile body /dev/stdin \
		'{kind: $kind, fingerprint: $fp, project: $project, scout: $scout, title: $title, body: ($body | sub("\\s+$"; "")),
		  footer: ("Posted by Warden, scout `" + $scout + "`."), number: ($num | tonumber? // null), severity: $sev,
		  created: $created, status: $status, url: null} + $extra' >"$d/meta.json"
}
# repo_diff <file>: make a diff from the old and new trees under $w/old and $w/new.
repo_diff() {
	rm -rf "$w/r" && mkdir "$w/r" && cp -r "$w/old/." "$w/r/"
	git -C "$w/r" init -q && git -C "$w/r" add -A && git -C "$w/r" -c user.name=demo -c user.email=demo@example.com commit -qm base
	rm -rf "$w/r"/src && cp -r "$w/new/." "$w/r/"
	git -C "$w/r" add -A && git -C "$w/r" diff --cached >"$1"
	rm -rf "$w/old" "$w/new"
}
test_result() { # project id status tail-file started ended
	mkdir -p "$T/results/$1"
	jq -n --arg s "$3" --arg st "$(iso "$5")" --arg en "$(iso "$6")" --rawfile t "$4" \
		'{status: $s, reason: null, command: "bun test", started: $st, ended: $en, exit_code: 0, output_tail: $t}' >"$T/results/$1/$2.json"
}

# 1. Draft PR: instrumentation gap in checkout.
id=checkout-submit-missing-event
mkdir -p "$w/old/src/checkout" "$w/new/src/checkout"
cat >"$w/old/src/checkout/submit.ts" <<'EOF'
import { api } from "../lib/api";
import type { Cart } from "./types";

export async function submitCheckout(cart: Cart, paymentMethodId: string) {
  const order = await api.post("/orders", { cartId: cart.id, paymentMethodId });
  return order;
}
EOF
cat >"$w/new/src/checkout/submit.ts" <<'EOF'
import { api } from "../lib/api";
import { posthog } from "../lib/posthog";
import type { Cart } from "./types";

export async function submitCheckout(cart: Cart, paymentMethodId: string) {
  const order = await api.post("/orders", { cartId: cart.id, paymentMethodId });
  posthog.capture("checkout_submitted", {
    order_id: order.id,
    item_count: cart.items.length,
    currency: cart.currency,
  });
  return order;
}
EOF
cat >"$w/new/src/checkout/submit.test.ts" <<'EOF'
import { expect, mock, test } from "bun:test";

const capture = mock();
mock.module("../lib/posthog", () => ({ posthog: { capture } }));
mock.module("../lib/api", () => ({ api: { post: async () => ({ id: "order-1" }) } }));

test("submitCheckout captures checkout_submitted", async () => {
  const { submitCheckout } = await import("./submit");
  const cart = { id: "cart-1", items: [{ sku: "a" }], currency: "USD" };
  await submitCheckout(cart as never, "pm-1");
  expect(capture).toHaveBeenCalledWith(
    "checkout_submitted",
    expect.objectContaining({ order_id: "order-1", item_count: 1, currency: "USD" }),
  );
});
EOF
mkdir -p "$S/web/pending/$id"
repo_diff "$S/web/pending/$id/patch.diff"
item web $id pr instrumentation-gaps medium "" "$(($(rt 13 5) + 240))" pending \
	'{"base_sha": "7f3c9a1d2b84e6f05a1c3d7e9b2f4a6c8e0d1b35", "related_issue": 297}' \
	"Capture checkout_submitted when a customer places an order" <<'EOF'
## What this changes

The checkout flow does not send an event when a customer places an order. The only record is the `orders` table of the API. The PostHog funnel "Checkout" therefore ends at `payment_started`, and it cannot show how many customers finish.

This pull request adds one `checkout_submitted` event to `submitCheckout`. The event has the order id, the item count and the currency. It has no card data and no email address.

## Evidence

- In the funnel "Checkout" of PostHog project 12345, 31% of the sessions that reach `payment_started` have no later event.
- 6 of 6 session recordings that I checked show the confirmation page. None has a matching event.

## Test

A new unit test mocks the PostHog client and checks the name and the properties of the event. `bun test` passes with 14 tests.
EOF
cat >"$w/tail.txt" <<'EOF'
bun test v1.3.4 (d3a1f0c2)

src/checkout/submit.test.ts:
(pass) submitCheckout captures checkout_submitted [3.12ms]

src/checkout/cart.test.ts:
(pass) cart total adds item prices [0.41ms]
(pass) cart total applies a percent discount [0.38ms]
(pass) cart total never goes below zero [0.22ms]

src/lib/api.test.ts:
(pass) api.post sends the json body [1.85ms]
(pass) api.post throws on a 500 answer [0.97ms]

 14 pass
 0 fail
 31 expect() calls
Ran 14 tests across 6 files. [214.00ms]
EOF
test_result web $id pass "$w/tail.txt" "$(($(rt 13 5) + 330))" "$(($(rt 13 5) + 352))"

# 2. PR update from warden-ci: a merge conflict is resolved.
id=ci-482-merge-conflict
mkdir -p "$w/old/src/billing" "$w/new/src/billing"
cat >"$w/old/src/billing/upgrade.ts" <<'EOF'
import { api } from "../lib/api";
import { posthog } from "../lib/posthog";

export async function upgradePlan(accountId: string, planId: string) {
  const result = await api.post(`/accounts/${accountId}/plan`, { planId });
  posthog.capture("plan_upgraded", { account_id: accountId, plan_id: planId });
  return result;
}
EOF
cat >"$w/new/src/billing/upgrade.ts" <<'EOF'
import { api } from "../lib/api";
import { posthog } from "../lib/posthog";

export async function upgradePlan(accountId: string, planId: string, previousPlanId?: string) {
  const result = await api.post(`/accounts/${accountId}/plan`, { planId, previousPlanId });
  posthog.capture("plan_upgraded", {
    account_id: accountId,
    plan_id: planId,
    previous_plan_id: previousPlanId,
  });
  return result;
}
EOF
mkdir -p "$S/web/pending/$id"
repo_diff "$S/web/pending/$id/patch.diff"
item web $id pr-update warden-ci low 482 "$(($(rt 13 6) + 300))" pending \
	'{"base_sha": "c41e8d07a9b3f25e6d1a0b7c9e3f5a2d4b6c8e10"}' \
	"Resolve the merge conflict in PR #482" <<'EOF'
PR #482 has a merge conflict with `main` in `src/billing/upgrade.ts`.

`main` added the optional argument `previousPlanId` to `upgradePlan` after this branch was cut. Both changes touch the same lines.

The resolution keeps both changes:

- `upgradePlan` takes `previousPlanId` and sends it to the API.
- The `plan_upgraded` event now has a `previous_plan_id` property, so the funnel can tell an upgrade from a downgrade.

No other file changes. The checks of the original PR pass on the merged result.
EOF
printf 'bun test v1.3.4 (d3a1f0c2)\n\nsrc/billing/upgrade.test.ts:\n(pass) upgradePlan sends previousPlanId [1.20ms]\n(pass) upgradePlan captures plan_upgraded [0.88ms]\n\n 16 pass\n 0 fail\nRan 16 tests across 6 files. [231.00ms]\n' >"$w/tail.txt"
test_result web $id pass "$w/tail.txt" "$(($(rt 13 6) + 360))" "$(($(rt 13 6) + 381))"

# 3. Comment on an existing issue.
item web issue-311-checkout-timeout comment github-issues medium 311 "$(($(rt 12 4) + 200))" pending '{}' \
	"Comment on #311: checkout page hangs on slow connections" <<'EOF'
This looks like the cause of the reports in this issue.

Error tracking shows a `NetworkError: Failed to fetch` group on `/checkout`: 83 events from 41 users in the last 7 days. 79% of them are on mobile Safari. The call `POST /orders` has no timeout and no retry, so a slow connection leaves the button in the loading state.

Session recordings show the same pattern. In 5 of 8 recordings the customer presses "Place order" two or three times. This can create duplicate orders if the first request does reach the API.

A timeout of 15 seconds, one retry with the same idempotency key, and an error message under the button would fix both problems. I can open a pull request for this if you want.
EOF

# 4. Issue from error tracking: a rising TypeError.
item api typeerror-invoice-total-null issue signals-scout-error-tracking high "" "$(($(rt 13 7) + 280))" pending '{}' \
	"TypeError in calculateInvoiceTotal: cannot read properties of null (reading 'amount')" <<'EOF'
## Summary

A `TypeError` in `calculateInvoiceTotal` is rising. It first appeared after the release `v2.14.0` and now fires about 40 times an hour. 61 customers hit it in the last 3 days, and they cannot download their invoice.

| Day | Events | Users |
| --- | ---: | ---: |
| 3 days ago | 212 | 14 |
| 2 days ago | 604 | 29 |
| Yesterday | 947 | 47 |
| Today (so far) | 388 | 31 |

## Cause

`invoice.discount` is `null` for invoices from the legacy import (about 9% of the invoices). The code in `src/billing/total.ts` reads `invoice.discount.amount` without a check. Before `v2.14.0` the field had a default of `{ amount: 0 }`, and the release removed it.

## Suggested fix

Read the value with a default: `invoice.discount?.amount ?? 0`. Add a test with an invoice that has no discount.

## Links

- Error tracking group: PostHog project 12346, issue "TypeError: Cannot read properties of null"
- Stack trace top frame: `src/billing/total.ts:58`
EOF

# 5. Submitted: issue, open.
item web pricing-lcp-regression issue signals-scout-web-vitals medium 471 "$(($(rt 10 1) + 200))" submitted \
	"$(jq -nc --arg a "$(iso $(($(rt 10 1) + 7200)))" --arg b "$(iso $(($(rt 10 1) + 3600)))" '{url: "https://github.com/acme/web/issues/471", decided_at: $b, submitted_at: $a, gh_state: "open", gh_state_at: $a, synced_at: $b}')" \
	"Largest Contentful Paint on /pricing is 4.1 s at the 75th percentile" <<'EOF'
The 75th percentile of LCP on `/pricing` rose from 2.3 s to 4.1 s over the last 5 days. Other pages did not change. The hero image is the LCP element. It loads at 1.8 MB and has no `fetchpriority`.
EOF
# 6. Submitted: PR, open (the one that the CI update follows).
item web track-plan-upgraded-event pr instrumentation-gaps medium 482 "$(($(rt 11 5) + 200))" submitted \
	"$(jq -nc --arg a "$(iso $(($(rt 11 5) + 5400)))" --arg b "$(iso $(($(rt 11 5) + 3600)))" '{url: "https://github.com/acme/web/pull/482", decided_at: $b, submitted_at: $a, gh_state: "open", gh_state_at: $a, synced_at: $b}')" \
	"Capture plan_upgraded on the billing page" <<'EOF'
Adds a `plan_upgraded` event to `upgradePlan`.
EOF
# 7. Submitted: PR, merged.
item web signup-completed-event pr instrumentation-gaps low 468 "$(($(rt 8 5) + 200))" submitted \
	"$(jq -nc --arg a "$(iso $(($(rt 8 5) + 5400)))" --arg m "$(iso $(($(rt 8 5) + 86400)))" --arg b "$(iso $(($(rt 8 5) + 3600)))" '{url: "https://github.com/acme/web/pull/468", decided_at: $b, submitted_at: $a, gh_state: "merged", gh_state_at: $m, synced_at: $m}')" \
	"Capture signup_completed after the email check" <<'EOF'
Adds a `signup_completed` event after the email check.
EOF
# 8. Submitted: issue, closed (not planned).
item api healthcheck-log-noise issue signals-scout-logs low 233 "$(($(rt 9 1) + 200))" submitted \
	"$(jq -nc --arg a "$(iso $(($(rt 9 1) + 5400)))" --arg c "$(iso $(($(rt 9 1) + 50000)))" --arg b "$(iso $(($(rt 9 1) + 3600)))" '{url: "https://github.com/acme/api/issues/233", decided_at: $b, submitted_at: $a, gh_state: "closed", gh_state_reason: "not_planned", gh_state_at: $c, synced_at: $c}')" \
	"The health check writes 40% of all log lines" <<'EOF'
The route `GET /healthz` writes one info line per call. It makes 40% of all log lines of the service.
EOF
# 9. Rejected, with a reason.
item web resize-observer-loop-spike issue signals-scout-error-tracking low "" "$(($(rt 9 0) + 200))" rejected \
	"$(jq -nc --arg b "$(iso $(($(rt 9 0) + 7200)))" '{decided_at: $b, reject_reason: "Known browser noise. The PostHog project already filters this error."}')" \
	"Spike of ResizeObserver loop errors on /dashboard" <<'EOF'
The error "ResizeObserver loop completed with undelivered notifications" rose to 1,200 events a day on `/dashboard`.
EOF
# 10. Stale: older than stale_days.
item api slow-reports-query issue signals-scout-logs medium "" "$((now - 45 * 86400))" stale \
	"$(jq -nc --arg a "$(iso $((now - 15 * 86400)))" '{stale_at: $a}')" \
	"Query for /v1/reports takes 2.8 s at the 95th percentile" <<'EOF'
The slow-query log shows `SELECT ... FROM report_rows` with no index on `account_id`. It runs about 600 times a day.
EOF

# --- runs and health -------------------------------------------------------------
declare -A good fails
RANDOM=7
summary_of() {
	case $1 in
	signals-scout-error-tracking) echo "Checked the open error groups. No new group above the alert limit." ;;
	signals-scout-web-vitals) echo "Checked 9 pages. All are inside the budget." ;;
	signals-scout-product-analytics) echo "Checked 4 funnels. No drop above 5 points." ;;
	signals-scout-session-replay) echo "Watched 24 sessions. No pattern of rage clicks." ;;
	signals-scout-logs) echo "Read the error logs of the last 12 hours. Nothing new." ;;
	github-issues) echo "Checked the open issues. No new issue from a trusted author." ;;
	instrumentation-gaps) echo "Checked 6 code paths. All have an event or a log line." ;;
	coolify) echo "Checked 2 linked apps. Both are healthy." ;;
	*) echo "Checked the Warden pull requests. No follow-up needed." ;;
	esac
}
# fnd <fingerprint> <action> <severity> <title> [number] [url]
fnd() { jq -nc --arg f "$1" --arg a "$2" --arg s "$3" --arg t "$4" --arg n "${5:-}" '[{fingerprint: $f, action: $a, severity: $s, title: $t, number: ($n | tonumber? // null), url: null}]'; }
findings_for() {
	case "$1|$2|$3" in
	13\|web\|instrumentation-gaps) fnd checkout-submit-missing-event pending medium "Capture checkout_submitted when a customer places an order" ;;
	13\|web\|warden-ci) fnd ci-482-merge-conflict pending-pr-update low "Resolve the merge conflict in PR #482" 482 ;;
	12\|web\|github-issues) fnd issue-311-checkout-timeout pending-comment medium "Comment on #311: checkout page hangs on slow connections" 311 ;;
	13\|web\|signals-scout-error-tracking) fnd resize-observer-loop-spike skipped-dup low "Spike of ResizeObserver loop errors on /dashboard" ;;
	9\|web\|signals-scout-error-tracking) fnd resize-observer-loop-spike pending-issue low "Spike of ResizeObserver loop errors on /dashboard" ;;
	10\|web\|signals-scout-web-vitals) fnd pricing-lcp-regression pending-issue medium "Largest Contentful Paint on /pricing is 4.1 s at the 75th percentile" ;;
	11\|web\|instrumentation-gaps) fnd track-plan-upgraded-event pending medium "Capture plan_upgraded on the billing page" ;;
	8\|web\|instrumentation-gaps) fnd signup-completed-event pending low "Capture signup_completed after the email check" ;;
	13\|api\|signals-scout-error-tracking) fnd typeerror-invoice-total-null pending-issue high "TypeError in calculateInvoiceTotal: cannot read properties of null (reading 'amount')" ;;
	9\|api\|signals-scout-logs) fnd healthcheck-log-noise pending-issue low "The health check writes 40% of all log lines" ;;
	*) echo '[]' ;;
	esac
}
record() { # cycle slot project scout
	local c=$1 slot=$2 p=$3 s=$4 start dur cost turns status=ok err= sum fnd mode=prs
	start=$(rt "$c" "$slot")
	dur=$((70 + RANDOM % 280))
	cost="0.$(printf '%02d' $((12 + RANDOM % 48)))"
	turns=$((6 + RANDOM % 34))
	sum=$(summary_of "$s")
	fnd=$(findings_for "$c" "$p" "$s")
	[[ $p != mobile ]] || mode=dry
	if [[ $p == web && $s == signals-scout-session-replay && $c -ge 12 ]]; then
		status=error
		err="agent exited with code 1: API rate limit reached (429). The scout will try again in the next cycle."
		cost=0.04
		sum=
		fails[$p/$s]=$((${fails[$p/$s]:-0} + 1))
	elif [[ $s == warden-ci && $fnd == '[]' ]]; then
		status=skipped
		err="no Warden pull request needs a follow-up"
		cost=0
		turns=0
		sum=
	else
		good[$p/$s]=$(iso $((start + dur)))
		fails[$p/$s]=0
	fi
	[[ $fnd == '[]' ]] || sum="Found 1 item. Saved it for review."
	jq -nc --arg id "$(stamp "$start")-$p-$s" --arg st "$(iso "$start")" --arg en "$(iso $((start + dur)))" --arg p "$p" --arg s "$s" --arg mode "$mode" \
		--arg status "$status" --arg err "$err" --arg sum "$sum" --argjson turns "$turns" --argjson cost "$cost" --argjson f "$fnd" \
		'{id: $id, started: $st, ended: $en, project: $p, scout: $s, mode: $mode, status: $status,
		  error: (if $err == "" then null else $err end), summary: (if $sum == "" then null else $sum end),
		  turns: $turns, cost_usd: $cost, findings: $f}' >>"$S/runs.jsonl"
}
web=(signals-scout-error-tracking signals-scout-web-vitals signals-scout-product-analytics signals-scout-session-replay github-issues instrumentation-gaps warden-ci)
api=(signals-scout-error-tracking signals-scout-logs instrumentation-gaps coolify warden-ci)
for c in $(seq 0 13); do
	slot=0
	for s in "${web[@]}"; do record "$c" $slot web "$s"; slot=$((slot + 1)); done
	for s in "${api[@]}"; do record "$c" $slot api "$s"; slot=$((slot + 1)); done
	if ((c <= 10)); then
		record "$c" 12 mobile signals-scout-error-tracking
		record "$c" 13 mobile signals-scout-product-analytics
	fi
done
# Mobile is paused: its last runs are 3 days old, and it keeps no failure count.
for k in "${!good[@]}"; do
	jq -n --arg k "$k" --arg g "${good[$k]}" --argjson f "${fails[$k]:-0}" --arg at "$(iso $((now - 3 * 3600)))" \
		'{($k): {fails: $f, last_good: $g, last_exit: (if $f > 0 then 1 else 0 end), last_at: $at}}'
done | jq -s 'add' >"$S/health.json"
echo "Demo state written to $out"
