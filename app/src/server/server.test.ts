import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "@/components/markdown";
import type { Env } from "./env";
import { checkRequest, requireSession } from "./guard";
import { stateDir } from "./paths";
import { COOKIE, createSession, SESSION_DAYS, sessionCookie, sessionKey, verifySession } from "./session";
import { CHALLENGE_TTL_MS, deletePasskey, issueChallenge, passkeyLogin, passkeyRows, readPasskeys, registerPasskey, registrationOptions, relyingParty, takeChallenge, updateCounter } from "./passkeys";
import { ACTION_LABELS, actionGroup } from "@/lib/format";
import { isSecretKey, pickKeyEnv, secretValueError } from "@/lib/secrets";
import { buildProject, createProject, removeProject } from "./connections";
import { saveSecret, secretRows } from "./secrets";
import { integrationsView, requestNotifyTest, setUrl } from "./integrations";
import { notifyResultText, TEST_WAIT_MS, urlError } from "@/lib/settings";
import { guardedCheck, resetLimiter, signOutEverywhere } from "./limiter";
import { ConflictError, rejectDays, setRejectDays, writeMetaChecked } from "./store";
import { createHash } from "node:crypto";
import { decide, editItem, itemCreatedMs, itemDetail, scoutHealth, setStaleDays, listItems, loadProjects, projectSettings, readTestResult, startRun, updateProject } from "./store";
import { findingsView, overviewView, projectView, runView } from "./views";
import { findingState, ghLabel, parseGh } from "@/lib/gh";
import { TestsCard } from "@/components/tests-card";
import { createElement } from "react";
import { CoolifyLine } from "@/components/coolify-panel";
import { coolifyKey, coolifyNameError, coolifyUrlError } from "@/lib/coolify";
import { coolifyInstances } from "./coolify-settings";
import { coolifyView, removeCoolify, saveCoolify } from "./coolify";
import { rawProjects } from "./store";

const root = mkdtempSync(join(tmpdir(), "warden-ui-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const env: Env = {
	stateRoot: join(root, "state"),
	projectsFile: join(root, "projects.json"),
	inboxRoot: join(root, "inbox"),
	testsRoot: join(root, "tests"),
	intervalHours: 12,
	maxTurns: 60,
	user: "admin",
	password: "pw",
	sessionSecret: "",
	wardenUrl: "",
	mode: "dry",
};

function meta(id: string, extra: Record<string, unknown> = {}) {
	const dir = join(env.stateRoot, "web", "pending", id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "meta.json"), JSON.stringify({ kind: "pr", fingerprint: id, project: "web", scout: "github-issues", title: "t", body: "b", status: "pending", ...extra }));
	return join(dir, "meta.json");
}

beforeEach(() => {
	resetLimiter();
	for (const dir of [env.stateRoot, env.inboxRoot, env.testsRoot]) rmSync(dir, { recursive: true, force: true });
	mkdirSync(env.stateRoot, { recursive: true });
	mkdirSync(env.inboxRoot, { recursive: true });
	writeFileSync(env.projectsFile, JSON.stringify([{ name: "web", repo: "o/r", scouts: ["github-issues"] }]));
});

const req = (method: string, headers: Record<string, string> = {}) => new Request("http://warden.test/x", { method, headers });

describe("session", () => {
	test("a signed cookie verifies, a changed or expired one does not", () => {
		const now = 1_000_000;
		const token = createSession(env, now);
		expect(verifySession(token, env, now + 1000)).toBe(true);
		expect(verifySession(`${token}x`, env, now)).toBe(false);
		expect(verifySession(token, { ...env, sessionSecret: "other" }, now)).toBe(false);
		expect(verifySession(token, { ...env, password: "" }, now)).toBe(false);
		expect(verifySession(token, env, now + SESSION_DAYS * 86_400_000 + 1)).toBe(false);
	});

	test("a server function call without a session is rejected", () => {
		expect(() => requireSession(req("POST"), env)).toThrow();
		expect(() => requireSession(req("POST", { cookie: `${COOKIE}=garbage` }), env)).toThrow();
		expect(() => requireSession(req("POST", { cookie: `${COOKIE}=${createSession(env)}` }), env)).not.toThrow();
	});
});

describe("request guard", () => {
	test("a mutation from a foreign origin gets 403", async () => {
		const bad = checkRequest(req("POST", { host: "warden.test", origin: "http://evil.example" }), env);
		expect(bad?.status).toBe(403);
		expect(checkRequest(req("POST", { host: "warden.test" }), env)?.status).toBe(403);
		expect(checkRequest(req("POST", { host: "warden.test", origin: "http://warden.test" }), env)).toBeNull();
	});

	test("health needs no password, every other route gets 503 without one", () => {
		const open = { ...env, password: "" };
		expect(checkRequest(new Request("http://warden.test/health"), open)?.status).toBe(200);
		expect(checkRequest(req("GET"), open)?.status).toBe(503);
	});
});

describe("paths", () => {
	test.each(["../etc", "a/b", "A", "", ".", "a..b", "-x"])("refuses %p", (bad) => {
		expect(() => stateDir(env.stateRoot, bad)).toThrow();
	});
	test("accepts a strict name", () => {
		expect(stateDir(env.stateRoot, "web", "pending", "8c1e2a9f")).toContain("8c1e2a9f");
	});
});

describe("decisions", () => {
	test("approve flips meta.json, once", () => {
		const path = meta("abc1");
		decide("abc1", undefined, "approve", undefined, env);
		expect(JSON.parse(readFileSync(path, "utf8")).status).toBe("approved");
		expect(() => decide("abc1", undefined, "reject", undefined, env)).toThrow();
	});

	test("reject keeps the reason, an error item can be approved again", () => {
		const path = meta("abc2");
		decide("abc2", undefined, "reject", "  wrong place ", env);
		expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ status: "rejected", reject_reason: "wrong place" });
		const failed = meta("abc3", { status: "error", error: "push failed" });
		decide("abc3", undefined, "approve", undefined, env);
		expect(JSON.parse(readFileSync(failed, "utf8"))).toMatchObject({ status: "approved", error: null });
	});

	test("a stale item, or an old pending item, cannot be approved; the age ignores the edit time", () => {
		const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
		const message = "This item is older than 30 days. Ask for a new run.";
		meta("old1", { created: old });
		expect(() => decide("old1", undefined, "approve", undefined, env)).toThrow(message);
		meta("old2", { status: "stale", created: old });
		expect(() => decide("old2", undefined, "approve", undefined, env)).toThrow(message);
		meta("old3", { created: old, edited_at: new Date().toISOString() });
		expect(() => decide("old3", undefined, "approve", undefined, env)).toThrow(message);
		writeFileSync(join(env.stateRoot, "settings.json"), JSON.stringify({ stale_days: 60 }));
		expect(decide("old1", undefined, "approve", undefined, env).status).toBe("approved");
		expect(itemCreatedMs("/nonexistent", "x-20261103090000", undefined)).toBe(Date.UTC(2026, 10, 3, 9, 0, 0));
		expect(setStaleDays(7, env)).toBe(7);
		expect(() => setStaleDays(0, env)).toThrow();
	});

	test("the health file gives failures and the last good run; wrong values count as missing", () => {
		writeFileSync(join(env.stateRoot, "health.json"), JSON.stringify({ "web/github-issues": { fails: 3, last_good: "2026-11-01T10:00:00Z" }, "web/x": { fails: "no", last_good: "bad" } }));
		expect(scoutHealth("web", "github-issues", env)).toEqual({ fails: 3, lastGood: "2026-11-01T10:00:00Z" });
		expect(scoutHealth("web", "x", env)).toEqual({ fails: 0, lastGood: null });
		expect(projectView("web", env)?.scouts[0]).toMatchObject({ fails: 3 });
	});

	test("a traversal id finds nothing", () => {
		expect(() => decide("../abc1", undefined, "approve", undefined, env)).toThrow();
	});

	test("a bad or unknown id gives null, so the page can answer 404", () => {
		meta("abc9");
		expect(itemDetail("abc9", undefined, env)?.id).toBe("abc9");
		for (const id of ["../abc9", "ABC", "nope"]) expect(itemDetail(id, undefined, env)).toBeNull();
		expect(runView("../x", env)).toBeNull();
		expect(runView("20260101T000000Z-none", env)).toBeNull();
	});
});

describe("run requests and settings", () => {
	test("startRun is idempotent and checks the scout", () => {
		expect(startRun("web", "github-issues", env)).toBe("requested");
		const file = join(env.stateRoot, "requests", "web__github-issues.json");
		const first = readFileSync(file, "utf8");
		expect(startRun("web", "github-issues", env)).toBe("requested");
		expect(readFileSync(file, "utf8")).toBe(first);
		mkdirSync(join(env.stateRoot, "running"), { recursive: true });
		writeFileSync(join(env.stateRoot, "running", "web__github-issues.json"), "{}");
		rmSync(file);
		expect(startRun("web", "github-issues", env)).toBe("running");
		expect(existsSync(file)).toBe(false);
		expect(() => startRun("web", "nope", env)).toThrow();
		expect(() => startRun("nope", "github-issues", env)).toThrow();
	});

	test("updateProject merges, and dry clears auto-submit", () => {
		writeFileSync(join(env.stateRoot, "settings.json"), JSON.stringify({ projects: { web: { auto_submit_prs: true, keep: 1 } } }));
		expect(projectSettings("web", { ...env, mode: "prs" })).toEqual({ mode: "prs", autoSubmit: true });
		updateProject("web", "issues", true, env);
		expect(JSON.parse(readFileSync(join(env.stateRoot, "settings.json"), "utf8")).projects.web).toEqual({ keep: 1, mode: "issues", auto_submit: true });
		expect(updateProject("web", "dry", true, env)).toEqual({ mode: "dry", autoSubmit: false });
	});
});

describe("integrations settings", () => {
	const file = () => join(env.stateRoot, "settings.json");

	test("urlError accepts http and https URLs and refuses the rest", () => {
		expect(urlError("")).toBeNull();
		expect(urlError("https://hermes.example.com/hook?a=1")).toBeNull();
		expect(urlError("http://hermes:8644/webhooks/warden")).toBeNull();
		for (const bad of ["ftp://x.example/", "javascript:alert(1)", "https://u:p@x.example/", "https://x.example/a b", "x.example", `https://${"a".repeat(500)}.example/`]) expect(urlError(bad)).not.toBeNull();
	});

	test("setUrl merges into a fresh read, trims, and an empty text removes the key", async () => {
		writeFileSync(file(), JSON.stringify({ stale_days: 9, projects: { web: { mode: "prs" } } }));
		await setUrl("hermes_webhook_url", " https://h.example/hook ", "pw", env, 0);
		writeFileSync(file(), JSON.stringify({ ...JSON.parse(readFileSync(file(), "utf8")), daily_cost_cap_usd: 5 }));
		await setUrl("warden_url", "https://w.example", "pw", env, 0);
		expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({ stale_days: 9, projects: { web: { mode: "prs" } }, hermes_webhook_url: "https://h.example/hook", daily_cost_cap_usd: 5, warden_url: "https://w.example" });
		await setUrl("hermes_webhook_url", "", "pw", env, 0);
		expect(JSON.parse(readFileSync(file(), "utf8")).hermes_webhook_url).toBeUndefined();
		await expect(setUrl("warden_url", "javascript:alert(1)", "pw", env, 0)).rejects.toThrow();
		expect(JSON.parse(readFileSync(file(), "utf8")).warden_url).toBe("https://w.example");
	});

	test("a URL save with a wrong password changes nothing, and the failures count toward the lock", async () => {
		resetLimiter();
		writeFileSync(file(), JSON.stringify({ hermes_webhook_url: "https://h.example/hook" }));
		await expect(setUrl("hermes_webhook_url", "https://evil.example/", "bad", env, 0)).rejects.toThrow("Wrong password.");
		expect(JSON.parse(readFileSync(file(), "utf8")).hermes_webhook_url).toBe("https://h.example/hook");
		for (let i = 0; i < 4; i++) await expect(setUrl("warden_url", "https://w.example", "bad", env, 0)).rejects.toThrow("Wrong password.");
		await expect(setUrl("warden_url", "https://w.example", "pw", env, 0)).rejects.toThrow(/Too many failed attempts/);
		resetLimiter();
	});

	test("the view ignores a bad URL in the file and reads only ok, status and time from the test result", () => {
		writeFileSync(file(), JSON.stringify({ hermes_webhook_url: "javascript:x", warden_url: "https://w.example" }));
		writeFileSync(join(env.stateRoot, "notify-test.json"), JSON.stringify({ ok: false, status: "401", at: "2026-11-03T10:00:00Z", body: "SECRET BODY" }));
		const v = integrationsView(env);
		expect(v.hermesUrl).toBeNull();
		expect(v.wardenUrl).toBe("https://w.example");
		expect(v.test.result).toEqual({ ok: false, status: "401", at: "2026-11-03T10:00:00Z" });
		writeFileSync(join(env.stateRoot, "notify-test.json"), JSON.stringify({ ok: true, status: "<script>" }));
		expect(integrationsView(env).test.result).toBeNull();
		expect(notifyResultText({ ok: false, status: "401" })).toBe("The webhook answered HTTP 401.");
	});

	test("a test request needs the password, is one file, and a dead file is replaced", async () => {
		resetLimiter();
		const path = join(env.stateRoot, "requests", "notify-test.json");
		rmSync(path, { force: true });
		await expect(requestNotifyTest("bad", env, 0)).rejects.toThrow("Wrong password.");
		expect(existsSync(path)).toBe(false);
		await requestNotifyTest("pw", env, 0);
		const first = readFileSync(path, "utf8");
		await requestNotifyTest("pw", env, 0);
		expect(readFileSync(path, "utf8")).toBe(first);
		expect(integrationsView(env).test.requested).toBe(true);
		await requestNotifyTest("pw", env, 0, Date.now() + TEST_WAIT_MS + 1000);
		expect(readFileSync(path, "utf8")).not.toBe(first);
		resetLimiter();
	});

	test("the Hermes secret goes through the secrets inbox, and the key is allowed", async () => {
		expect(isSecretKey("HERMES_WEBHOOK_SECRET")).toBe(true);
		expect(isSecretKey("HERMES_WEBHOOK_URL")).toBe(false);
		await saveSecret({ key: "HERMES_WEBHOOK_SECRET", value: "hermes-secret-value-1", password: "pw" }, env, 0);
		expect(JSON.parse(readFileSync(join(env.inboxRoot, "HERMES_WEBHOOK_SECRET.json"), "utf8")).value).toBe("hermes-secret-value-1");
		expect(secretRows(env).find((r) => r.key === "HERMES_WEBHOOK_SECRET")).not.toHaveProperty("value");
	});

	test("rejectDays has a default, a range and merges", () => {
		expect(rejectDays(env)).toBe(30);
		expect(setRejectDays(0, env)).toBe(0);
		expect(() => setRejectDays(-1, env)).toThrow();
		expect(() => setRejectDays(1.5, env)).toThrow();
	});
});

describe("markdown", () => {
	test("script tags, javascript links and images are made safe", () => {
		const html = renderToStaticMarkup(
			Markdown({ children: "<script>alert(1)</script>\n\n[bad](javascript:alert(1)) [ok](https://example.com)\n\n![x](https://t.example/p.png)\n\n<img src=x onerror=alert(1)>" }),
		);
		expect(html).not.toContain("<script");
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("<img");
		expect(html).not.toContain("onerror");
		expect(html).toContain('href="https://example.com/"');
		expect(html).toContain('rel="noopener noreferrer nofollow"');
		expect(html).toContain('href="https://t.example/p.png"');
	});
});

describe("edit before approve", () => {
	test("edit changes title and body and sets edited_at", () => {
		const path = meta("ed01");
		const now = new Date("2026-11-03T10:00:00Z");
		editItem("ed01", undefined, "  New title ", "New body", env, now);
		expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ title: "New title", body: "New body", edited_at: now.toISOString(), status: "pending" });
	});

	test("edit refuses a non-pending item, an empty title or body, and a long body", () => {
		meta("ed02", { status: "approved" });
		expect(() => editItem("ed02", undefined, "t", "b", env)).toThrow("approved");
		meta("ed03");
		expect(() => editItem("ed03", undefined, "  ", "b", env)).toThrow();
		expect(() => editItem("ed03", undefined, "t", " ", env)).toThrow();
		expect(() => editItem("ed03", undefined, "t", "x".repeat(60_001), env)).toThrow();
	});
});

describe("secrets inbox", () => {
	const value = "ghp_exampleexample1234";

	test("a write creates the inbox file with mode 600 and the answer has no value", async () => {
		const answer = await saveSecret({ key: "GH_TOKEN", value, password: "pw" }, env, 0);
		expect(JSON.stringify(answer)).not.toContain(value);
		const file = join(env.inboxRoot, "GH_TOKEN.json");
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ value });
	});

	test("a wrong password, a disallowed key and a bad value are refused without the value in the error", async () => {
		const errors: string[] = [];
		for (const input of [
			{ key: "GH_TOKEN", value, password: "nope" },
			{ key: "ANTHROPIC_BASE_URL", value, password: "pw" },
			{ key: "GH_TOKEN", value: "has space inside", password: "pw" },
			{ key: "GH_TOKEN", value: "short", password: "pw" },
		]) {
			const err = await saveSecret(input, env, 0).catch((x: Error) => x);
			expect(err).toBeInstanceOf(Error);
			errors.push((err as Error).message);
		}
		expect(errors.join()).not.toContain(value);
		expect(existsSync(join(env.inboxRoot, "GH_TOKEN.json"))).toBe(false);
		expect(existsSync(join(env.inboxRoot, "ANTHROPIC_BASE_URL.json"))).toBe(false);
	});

	test("clear needs a key set in Warden", async () => {
		await expect(saveSecret({ key: "GH_TOKEN", clear: true, password: "pw" }, env, 0)).rejects.toThrow();
		writeFileSync(join(env.inboxRoot, "status.json"), JSON.stringify({ GH_TOKEN: { source: "ui", state: "ok" } }));
		await saveSecret({ key: "GH_TOKEN", clear: true, password: "pw" }, env, 0);
		expect(JSON.parse(readFileSync(join(env.inboxRoot, "GH_TOKEN.json"), "utf8"))).toMatchObject({ clear: true });
	});

	test("value rules", () => {
		expect(secretValueError("12345678")).toBeNull();
		expect(isSecretKey("WARDEN_POSTHOG_TOKEN") && isSecretKey("WARDEN_POSTHOG_HOST") && !isSecretKey("WARDEN_PASSWORD")).toBe(true);
		expect(secretValueError("a\nbcdefghi")).not.toBeNull();
		for (const bad of ['ab"cdefgh', "ab\\cdefgh", "ab\u0001cdefgh", "ab\u007fcdefgh"]) expect(secretValueError(bad)).not.toBeNull();
	});
});

describe("skipped runs", () => {
	test("a skipped run is not an attention item and the cell is not late", () => {
		const started = new Date(Date.now() - 20 * 3_600_000).toISOString();
		writeFileSync(join(env.stateRoot, "runs.jsonl"), `${JSON.stringify({ started, project: "web", scout: "github-issues", status: "skipped", error: "daily cost cap reached", findings: [] })}\n`);
		const o = overviewView(env);
		expect(o.attention).toEqual([]);
		expect(o.projects[0].cells[0].state).toBe("skipped");
	});
});

describe("test results", () => {
	test("the card renders output as escaped text", () => {
		const result = { status: "fail", reason: null, command: "bun test <x>", started: null, ended: null, exit_code: 1, output_tail: "<script>alert(1)</script> **bold**" } as const;
		const html = renderToStaticMarkup(TestsCard({ result }));
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("**bold**");
	});

	test("the reader drops unknown status and clips the output", () => {
		const dir = join(env.testsRoot, "results", "web");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "ab12.json"), JSON.stringify({ status: "bogus" }));
		expect(readTestResult("web", "ab12", env)).toBeNull();
		writeFileSync(join(dir, "ab12.json"), JSON.stringify({ status: "pass", output_tail: "x".repeat(50_000) }));
		expect(readTestResult("web", "ab12", env)?.output_tail.length).toBe(20_000);
		expect(readTestResult("../x", "ab12", env)).toBeNull();
	});
});

describe("projects", () => {
	const discovery = {
		updated_at: "2026-11-03T09:00:00Z",
		github: null,
		posthog: [{ key_env: "POSTHOG_API_KEY_WORK", ok: true, region: "eu" as const, projects: [{ id: "7", name: "App" }] }],
		sentry: null,
	};
	const input = { name: "newone", repo: "acme/newone", posthogKeyEnv: "POSTHOG_API_KEY_WORK", posthogProjectId: "7", scouts: ["github-issues"], issueAuthors: ["OWNER"] };

	test("add writes the live file with derived fields and dry mode", () => {
		writeFileSync(join(env.inboxRoot, "discovery.json"), JSON.stringify(discovery));
		createProject(input, env);
		const list = JSON.parse(readFileSync(join(env.stateRoot, "projects.json"), "utf8"));
		expect(list.map((p: { name: string }) => p.name)).toEqual(["web", "newone"]);
		expect(list[1]).toMatchObject({ posthog_ui: "https://eu.posthog.com/project/7", posthog_region: "eu", posthog_project_id: "7" });
		expect(projectSettings("newone", { ...env, mode: "prs" }).mode).toBe("dry");
		expect(() => createProject(input, env)).toThrow("exists");
	});

	test("a bad repo, name or uncovered key is refused", () => {
		writeFileSync(join(env.inboxRoot, "discovery.json"), JSON.stringify(discovery));
		const d = null;
		expect(() => createProject({ ...input, repo: "not a repo" }, env)).toThrow();
		expect(() => createProject({ ...input, repo: "a/b/c" }, env)).toThrow();
		expect(() => createProject({ ...input, name: "Bad Name" }, env)).toThrow();
		expect(() => createProject({ ...input, posthogProjectId: "999" }, env)).toThrow();
		expect(() => buildProject({ ...input, posthogKeyEnv: "OTHER" }, null, d)).toThrow();
	});

	test("remove keeps the state folder", () => {
		meta("keep1");
		removeProject("web", "web", env);
		expect(loadProjects(env)).toEqual([]);
		expect(existsSync(join(env.stateRoot, "web", "pending", "keep1", "meta.json"))).toBe(true);
		expect(() => removeProject("web", "wrong", env)).toThrow();
	});

	test("key reuse picks the key other projects use", () => {
		expect(pickKeyEnv(["A", "B"], ["B"])).toBe("B");
		expect(pickKeyEnv(["A", "B"], [])).toBe("A");
		expect(pickKeyEnv([], ["B"])).toBeNull();
	});

	test("an item list still works for a pr-update", () => {
		meta("up01", { kind: "pr-update", number: 12 });
		expect(listItems(env)[0].kind).toBe("pr-update");
	});
});

describe("failure limiter", () => {
	test("5 failures lock every password check, even a right one, with a minutes message", async () => {
		for (let i = 0; i < 5; i++) await expect(saveSecret({ key: "GH_TOKEN", value: "v".repeat(20), password: "bad" }, env, 0)).rejects.toThrow("Wrong password.");
		await expect(saveSecret({ key: "GH_TOKEN", value: "v".repeat(20), password: "pw" }, env, 0)).rejects.toThrow(/Too many failed attempts\. Try again in 10 min\./);
		await expect(guardedCheck(() => true, 0)).rejects.toThrow("Too many failed attempts");
		await expect(guardedCheck(() => true, 0, Date.now() + 601_000)).resolves.toBe(true);
	});

	test("failures older than 10 minutes do not count", async () => {
		const t = Date.now();
		for (let i = 0; i < 4; i++) await guardedCheck(() => false, 0, t);
		await guardedCheck(() => false, 0, t + 601_000);
		await expect(guardedCheck(() => true, 0, t + 601_000)).resolves.toBe(true);
	});
});

describe("session generation", () => {
	test("sign out everywhere needs the password and ends old cookies", async () => {
		const old = createSession(env);
		expect(verifySession(old, env)).toBe(true);
		await expect(signOutEverywhere("bad", env, 0)).rejects.toThrow("Wrong password.");
		expect(verifySession(old, env)).toBe(true);
		await signOutEverywhere("pw", env, 0);
		expect(verifySession(old, env)).toBe(false);
		expect(verifySession(createSession(env), env)).toBe(true);
	});

	test("without WARDEN_SESSION_SECRET a cookie signed with sha256(password) fails", () => {
		const forged = createSession({ ...env, sessionSecret: createHash("sha256").update("warden-session:pw").digest("hex") });
		expect(verifySession(forged, env)).toBe(false);
	});
});

describe("session key", () => {
	test("without WARDEN_SESSION_SECRET the key is made once and kept (mode 0600)", () => {
		const first = sessionKey(env);
		expect(first).toHaveLength(64);
		expect(sessionKey(env)).toBe(first);
		expect(statSync(join(env.stateRoot, "ui-session-key.json")).mode & 0o777).toBe(0o600);
		const token = createSession(env);
		expect(verifySession(token, env)).toBe(true);
	});

	test("the env secret wins and writes no file", () => {
		expect(sessionKey({ ...env, sessionSecret: "from-env" })).toBe("from-env");
		expect(existsSync(join(env.stateRoot, "ui-session-key.json"))).toBe(false);
	});

	test("the cookie is SameSite=Lax", () => {
		expect(sessionCookie("v", req("GET"))).toContain("SameSite=Lax");
	});
});

describe("passkeys", () => {
	const stored = { id: "cred1", publicKey: "AQID", counter: 3, transports: ["internal"], name: "Laptop", created: "2026-11-04T10:00:00.000Z" };
	const file = () => join(env.stateRoot, "ui-passkeys.json");

	test("the store reads, writes with mode 0600 and updates the counter", () => {
		expect(readPasskeys(env)).toEqual([]);
		writeFileSync(file(), JSON.stringify({ credentials: [stored, { id: 5 }] }));
		expect(readPasskeys(env)).toEqual([stored]);
		updateCounter(env, "cred1", 9);
		expect(readPasskeys(env)[0].counter).toBe(9);
		expect(statSync(file()).mode & 0o777).toBe(0o600);
		expect(passkeyRows(env)).toEqual([{ id: "cred1", name: "Laptop", created: stored.created }]);
	});

	test("the RP ID comes from WARDEN_URL only", () => {
		expect(relyingParty({ ...env, wardenUrl: "https://warden.example.com/x" })).toEqual({ rpID: "warden.example.com", origin: "https://warden.example.com" });
		expect(relyingParty({ ...env, wardenUrl: "" })?.rpID).toBe("localhost");
		expect(relyingParty({ ...env, wardenUrl: "http://warden.example.com" })).toBeNull();
		expect(relyingParty({ ...env, wardenUrl: "https://127.0.0.1" })).toBeNull();
		expect(relyingParty({ ...env, wardenUrl: "not a url" })).toBeNull();
	});

	test("a challenge works once and expires after 5 minutes", () => {
		const t = Date.now();
		issueChallenge("login", "c1", t);
		expect(takeChallenge("login", "c1", t + 1000)).toBe(true);
		expect(takeChallenge("login", "c1", t + 1000)).toBe(false);
		issueChallenge("login", "c2", t);
		expect(takeChallenge("login", "c2", t + CHALLENGE_TTL_MS + 1)).toBe(false);
		issueChallenge("register", "c3", t);
		expect(takeChallenge("login", "c3", t)).toBe(false);
		expect(takeChallenge("register", "c3", t)).toBe(false);
	});

	test("register and delete refuse a wrong password and change nothing", async () => {
		writeFileSync(file(), JSON.stringify({ credentials: [stored] }));
		await expect(registrationOptions("bad", env, 0)).rejects.toThrow("Wrong password.");
		await expect(registerPasskey({ password: "bad", name: "x", response: { id: "n" } as never }, env, 0)).rejects.toThrow("Wrong password.");
		await expect(deletePasskey({ password: "bad", id: "cred1" }, env, 0)).rejects.toThrow("Wrong password.");
		expect(readPasskeys(env)).toHaveLength(1);
		expect(await deletePasskey({ password: "pw", id: "cred1" }, env, 0)).toEqual([]);
	});

	test("a login with an unknown credential fails and counts as a failure", async () => {
		for (let i = 0; i < 5; i++) expect(await passkeyLogin({ id: "none" } as never, env, 0)).toBe(false);
		await expect(passkeyLogin({ id: "none" } as never, env, 0)).rejects.toThrow("Too many failed attempts");
	});
});

describe("state races", () => {
	test("approve refuses when the runner changed the status in between", () => {
		const path = meta("race1");
		const seen = JSON.parse(readFileSync(path, "utf8"));
		writeFileSync(path, JSON.stringify({ ...seen, status: "submitting" }));
		const dir = join(env.stateRoot, "web", "pending", "race1");
		expect(() => writeMetaChecked(dir, seen, { ...seen, status: "approved" })).toThrow(ConflictError);
		expect(JSON.parse(readFileSync(path, "utf8")).status).toBe("submitting");
	});

	test("an edit refuses when edited_at changed after the read", () => {
		const path = meta("race2");
		const seen = JSON.parse(readFileSync(path, "utf8"));
		writeFileSync(path, JSON.stringify({ ...seen, edited_at: "2026-11-03T10:00:00Z" }));
		const dir = join(env.stateRoot, "web", "pending", "race2");
		expect(() => writeMetaChecked(dir, seen, { ...seen, title: "stale" })).toThrow("This item changed. Reload the page.");
	});

	test("a project save keeps keys another writer added to settings.json", () => {
		writeFileSync(join(env.stateRoot, "settings.json"), JSON.stringify({ other: 1, projects: { web: { mode: "dry", extra: true } } }));
		updateProject("web", "issues", false, env);
		const s = JSON.parse(readFileSync(join(env.stateRoot, "settings.json"), "utf8"));
		expect(s.other).toBe(1);
		expect(s.projects.web.extra).toBe(true);
	});

	test("submitting items cannot be approved, rejected or edited", () => {
		meta("sub1", { status: "submitting" });
		expect(() => decide("sub1", undefined, "approve", undefined, env)).toThrow("submitting");
		expect(() => decide("sub1", undefined, "reject", undefined, env)).toThrow("submitting");
		expect(() => editItem("sub1", undefined, "t", "b", env)).toThrow("submitting");
	});
});

describe("github state", () => {
	test("parseGh and ghLabel map the runner fields to a badge label", () => {
		expect(parseGh({})).toBeNull();
		expect(parseGh({ gh_state: "bogus" })).toBeNull();
		expect(ghLabel(parseGh({ gh_state: "open" })!)).toBe("Open");
		expect(ghLabel(parseGh({ gh_state: "merged", gh_state_at: "2026-11-03T10:00:00Z" })!)).toBe("Merged");
		expect(ghLabel(parseGh({ gh_state: "closed", gh_state_reason: "completed" })!)).toBe("Closed");
		expect(ghLabel(parseGh({ gh_state: "closed", gh_state_reason: "not_planned" })!)).toBe("Closed (not planned)");
		expect(parseGh({ gh_state: "open", gh_state_at: "junk", synced_at: 5 })).toEqual({ state: "open", reason: null, at: null, syncedAt: null });
	});

	test("findings carry the state of a submitted item and the filter uses it", () => {
		const run = { id: "r1", started: "2026-11-03T09:00:00Z", project: "web", scout: "github-issues", status: "ok", findings: [{ fingerprint: "g1", action: "issue", title: "a" }, { fingerprint: "g2", action: "issue", title: "b" }] };
		writeFileSync(join(env.stateRoot, "runs.jsonl"), `${JSON.stringify(run)}\n`);
		meta("g1", { status: "submitted", gh_state: "merged", synced_at: "2026-11-03T10:00:00Z" });
		meta("g2", { status: "submitted" });
		const all = findingsView({}, 0, env).rows;
		expect(all.find((r) => r.fingerprint === "g1")?.gh?.state).toBe("merged");
		expect(all.find((r) => r.fingerprint === "g2")?.gh).toBeNull();
		expect(findingsView({ gh: "merged" }, 0, env).rows.map((r) => r.fingerprint)).toEqual(["g1"]);
		expect(findingsView({ gh: "open" }, 0, env).rows).toEqual([]);
	});
});

describe("finding badge", () => {
	test("a finding shows the live status of its item, not the action the scout wrote", () => {
		const run = { id: "r2", started: "2026-11-03T09:00:00Z", project: "web", scout: "github-issues", status: "ok", findings: ["p1", "p2", "p3", "p4"].map((fingerprint) => ({ fingerprint, action: "pending", title: fingerprint })) };
		writeFileSync(join(env.stateRoot, "runs.jsonl"), `${JSON.stringify(run)}\n`);
		meta("p1", { status: "pending" });
		meta("p2", { status: "submitting" });
		meta("p3", { status: "submitted", gh_state: "open" });
		meta("p4", { status: "error" });
		const kind = (fp: string) => {
			const row = findingsView({}, 0, env).rows.find((r) => r.fingerprint === fp)!;
			const s = findingState(row);
			return s.kind === "status" ? s.status : s.kind;
		};
		expect(["p1", "p2", "p3", "p4"].map(kind)).toEqual(["action", "submitting", "gh", "error"]);
		expect(findingsView({ action: "pending" }, 0, env).rows.map((r) => r.fingerprint)).toEqual(["p1"]);
	});

	test("several items with one fingerprint: the finding links the newest item", () => {
		const run = { id: "r3", started: "2026-11-03T09:00:00Z", project: "web", scout: "github-issues", status: "ok", findings: [{ fingerprint: "dup1", action: "pending", title: "d" }] };
		writeFileSync(join(env.stateRoot, "runs.jsonl"), `${JSON.stringify(run)}\n`);
		meta("dup1", { fingerprint: "dup1", status: "submitted", gh_state: "closed", created: "2026-10-01T00:00:00Z" });
		meta("dup1-20261103090000", { fingerprint: "dup1", status: "pending", created: "2026-11-03T09:00:00Z" });
		const row = findingsView({}, 0, env).rows.find((r) => r.fingerprint === "dup1")!;
		expect(row.itemId).toBe("dup1-20261103090000");
		expect(row.itemStatus).toBe("pending");
	});
});

describe("coolify", () => {
	const token = "7|" + "t".repeat(40);
	const inboxFile = (key: string) => join(env.inboxRoot, `${key}.json`);

	test("the URL rule accepts a plain https host and refuses http, a path and user info", () => {
		expect(["https://coolify.example.com", "https://coolify.example.com:8443/", "https://10.0.0.5"].map((u) => coolifyUrlError(u))).toEqual([null, null, null]);
		for (const u of ["http://coolify.example.com", "https://coolify.example.com/api", "https://user:pw@coolify.example.com", "ftp://x.example.com", "", "https://a b.example.com"]) expect(coolifyUrlError(u)).not.toBeNull();
		expect(coolifyNameError("home-lab")).toBeNull();
		for (const n of ["", "Home", "a_b", "-a", "a--b", "x".repeat(31)]) expect(coolifyNameError(n)).not.toBeNull();
		expect(isSecretKey(coolifyKey("home-lab"))).toBe(true);
		expect(coolifyKey("home-lab")).toBe("COOLIFY_TOKEN_HOME_LAB");
	});

	test("a save needs the password, writes the URL to settings.json and the token to the inbox only", async () => {
		await expect(saveCoolify({ name: "home", url: "https://c.example.com", token, password: "bad" }, env, 0)).rejects.toThrow("Wrong password.");
		expect(coolifyInstances(env)).toEqual([]);
		await saveCoolify({ name: "home", url: "https://c.example.com/", token, password: "pw" }, env, 0);
		expect(coolifyInstances(env)).toEqual([{ name: "home", url: "https://c.example.com" }]);
		expect(JSON.parse(readFileSync(inboxFile("COOLIFY_TOKEN_HOME"), "utf8")).value).toBe(token);
		expect(statSync(inboxFile("COOLIFY_TOKEN_HOME")).mode & 0o077).toBe(0);
		expect(readFileSync(join(env.stateRoot, "settings.json"), "utf8")).not.toContain("ttttt");
		const view = JSON.stringify(coolifyView(env));
		expect(view).not.toContain("ttttt");
		expect(coolifyView(env)[0]?.token.pending).toBe(true);
	});

	test("a new instance needs a token and a new URL needs the token again", async () => {
		await expect(saveCoolify({ name: "home", url: "https://c.example.com", password: "pw" }, env, 0)).rejects.toThrow("Enter the token.");
		await saveCoolify({ name: "home", url: "https://c.example.com", token, password: "pw" }, env, 0);
		rmSync(inboxFile("COOLIFY_TOKEN_HOME"));
		await saveCoolify({ name: "home", url: "https://c.example.com", password: "pw" }, env, 0);
		expect(existsSync(inboxFile("COOLIFY_TOKEN_HOME"))).toBe(false);
		await expect(saveCoolify({ name: "home", url: "https://evil.example.com", password: "pw" }, env, 0)).rejects.toThrow("A new URL needs the token again.");
		expect(coolifyInstances(env)[0]?.url).toBe("https://c.example.com");
	});

	test("a remove drops the instance and the links of projects", async () => {
		await saveCoolify({ name: "home", url: "https://c.example.com", token, password: "pw" }, env, 0);
		writeFileSync(env.projectsFile, JSON.stringify([{ name: "web", repo: "o/r", scouts: ["coolify"], coolify: [{ instance: "home", app_uuid: "app11111aaaa" }, { instance: "other", app_uuid: "app22222bbbb" }] }]));
		await expect(removeCoolify({ name: "home", password: "bad" }, env, 0)).rejects.toThrow("Wrong password.");
		await removeCoolify({ name: "home", password: "pw" }, env, 0);
		expect(coolifyInstances(env)).toEqual([]);
		expect(rawProjects(env)[0]?.coolify).toEqual([{ instance: "other", app_uuid: "app22222bbbb" }]);
	});

	test("a project links only apps that discovery lists, and keeps the saved links", () => {
		const d = { updated_at: null, github: null, posthog: [], sentry: null, coolify: [{ name: "home", url: "https://c.example.com", ok: true, detail: null, apps: [{ uuid: "app11111aaaa", name: "web", repo: "o/r", fqdn: "", status: "running:healthy", build_pack: null }] }] };
		const input = { name: "web", repo: "o/r", scouts: ["coolify"], issueAuthors: ["OWNER"], coolify: [{ instance: "home", appUuid: "app11111aaaa" }] };
		expect(buildProject(input, null, d).coolify).toEqual([{ instance: "home", app_uuid: "app11111aaaa" }]);
		expect(() => buildProject({ ...input, coolify: [{ instance: "home", appUuid: "app99999zzzz" }] }, null, d)).toThrow(/does not list/);
		expect(() => buildProject({ ...input, coolify: [{ instance: "home", appUuid: "bad uuid" }] }, null, d)).toThrow(/not valid/);
		expect(buildProject({ ...input, coolify: [{ instance: "gone", appUuid: "app77777gggg" }] }, { coolify: [{ instance: "gone", app_uuid: "app77777gggg" }] }, d).coolify).toHaveLength(1);
		expect("coolify" in buildProject({ ...input, coolify: [] }, { coolify: [{ instance: "home", app_uuid: "app11111aaaa" }] }, d)).toBe(false);
	});

	test("the page view shows the state of the token and the app count, never the token", async () => {
		await saveCoolify({ name: "home", url: "https://c.example.com", token, password: "pw" }, env, 0);
		rmSync(inboxFile("COOLIFY_TOKEN_HOME"));
		writeFileSync(join(env.inboxRoot, "status.json"), JSON.stringify({ COOLIFY_TOKEN_HOME: { source: "ui", state: "warn", detail: "This token can write.", updated_at: "2026-11-03T10:00:00Z" } }));
		writeFileSync(join(env.inboxRoot, "discovery.json"), JSON.stringify({ coolify: [{ name: "home", url: "https://c.example.com", ok: true, apps: [{ uuid: "a", name: "web" }, { uuid: "b", name: "api" }] }] }));
		const row = coolifyView(env)[0]!;
		expect(row.apps).toBe(2);
		const html = renderToStaticMarkup(createElement(CoolifyLine, { row }));
		expect(html).toContain("home");
		expect(html).toContain("2 apps");
		expect(html).toContain("This token can write.");
		expect(html).toContain("Works, check the token");
		expect(html).not.toContain("ttttt");
	});
});

describe("finding action labels", () => {
	// Every value that bin/run-scout.sh and bin/submit-approved.sh can write.
	const runnerActions = [
		"issue", "comment", "pr", "pr-update", "pr-update-failed",
		"pending", "pending-issue", "pending-comment", "pending-pr-update",
		"skipped-cap", "skipped-mode", "skipped-dup",
		"blocked-secret", "blocked-path", "blocked-conflict",
		"dry-issue", "dry-comment", "dry-pr", "dry-pr-update",
	];
	test.each(runnerActions)("%s has a label", (a) => {
		expect(ACTION_LABELS[a]).toBeTruthy();
		expect(actionGroup(a)).not.toBe("other");
	});
});
