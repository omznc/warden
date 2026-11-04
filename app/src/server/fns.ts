import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { coolifyView, removeCoolify, saveCoolify } from "./coolify";
import { connectionsView, createProject, editProject, projectListView, removeProject, requestDiscovery, setEnabled } from "./connections";
import { env } from "./env";
import { integrationsView, requestNotifyTest, setUrl } from "./integrations";
import { signOutEverywhere } from "./limiter";
import { NAME } from "./paths";
import { deletePasskey, passkeyRows, registerPasskey, registrationOptions, relyingParty } from "./passkeys";
import { saveSecret, secretRows } from "./secrets";
import { costView, decide, editItem, itemDetail, listItems, rejectDays, setCostCap, setRejectDays, setStaleDays, staleDays, startRun, updateProject } from "./store";
import { findingsView, overviewView, projectView, runsView, runView, shellView } from "./views";

const name = z.string().regex(NAME).max(200);
const filters = z.object({ project: z.string().optional(), scout: z.string().optional(), severity: z.string().optional(), action: z.string().optional(), gh: z.enum(["open", "merged", "closed"]).optional(), q: z.string().max(200).optional() });

export const getShell = createServerFn().handler(async () => shellView());
export const getOverview = createServerFn().handler(async () => overviewView());

export const listReview = createServerFn()
	.validator(z.object({ status: z.enum(["pending", "approved", "submitted", "rejected", "stale", "error"]) }))
	.handler(async ({ data }) => listItems().filter((i) => i.status === data.status || (data.status === "approved" && i.status === "submitting")));

export const getItem = createServerFn()
	.validator(z.object({ id: z.string().max(200), project: z.string().max(200).optional() }))
	.handler(async ({ data }) => {
		return itemDetail(data.id, data.project);
	});

export const decideItem = createServerFn({ method: "POST" })
	.validator(z.object({ id: name, project: name.optional(), action: z.enum(["approve", "reject"]), reason: z.string().max(500).optional() }))
	.handler(async ({ data }) => {
		const meta = decide(data.id, data.project, data.action, data.reason);
		return { status: meta.status };
	});

export const editItemFn = createServerFn({ method: "POST" })
	.validator(z.object({ id: name, project: name.optional(), title: z.string().max(1000), body: z.string().max(200_000) }))
	.handler(async ({ data }) => {
		const meta = editItem(data.id, data.project, data.title, data.body);
		return { editedAt: meta.edited_at ?? null };
	});

export const getCost = createServerFn().handler(async () => costView());

export const saveCap = createServerFn({ method: "POST" })
	.validator(z.object({ cap: z.number().nullable() }))
	.handler(async ({ data }) => ({ cap: setCostCap(data.cap) }));

export const getStale = createServerFn().handler(async () => ({ days: staleDays() }));

export const saveStale = createServerFn({ method: "POST" })
	.validator(z.object({ days: z.number() }))
	.handler(async ({ data }) => ({ days: setStaleDays(data.days) }));

export const signOutEverywhereFn = createServerFn({ method: "POST" })
	.validator(z.object({ password: z.string().max(500) }))
	.handler(async ({ data }) => signOutEverywhere(data.password, env()));

export const getPasskeys = createServerFn().handler(async () => ({ available: relyingParty(env()) !== null, passkeys: passkeyRows(env()) }));

export const passkeyOptionsFn = createServerFn({ method: "POST" })
	.validator(z.object({ password: z.string().max(500) }))
	// The options are plain JSON, but the library type holds BufferSource, which the serializer refuses. So send a string.
	.handler(async ({ data }) => JSON.stringify(await registrationOptions(data.password, env())));

export const passkeyAddFn = createServerFn({ method: "POST" })
	.validator(z.object({ password: z.string().max(500), name: z.string().max(60), response: z.object({ id: z.string().max(1024) }).passthrough() }))
	.handler(async ({ data }) => registerPasskey({ ...data, response: data.response as never }, env()));

export const passkeyDeleteFn = createServerFn({ method: "POST" })
	.validator(z.object({ password: z.string().max(500), id: z.string().max(1024) }))
	.handler(async ({ data }) => deletePasskey(data, env()));

export const getRejectDays = createServerFn().handler(async () => ({ days: rejectDays() }));

export const saveRejectDays = createServerFn({ method: "POST" })
	.validator(z.object({ days: z.number() }))
	.handler(async ({ data }) => ({ days: setRejectDays(data.days) }));

export const getIntegrations = createServerFn().handler(async () => integrationsView());

export const saveUrlFn = createServerFn({ method: "POST" })
	.validator(z.object({ key: z.enum(["hermes_webhook_url", "warden_url"]), value: z.string().max(2000), password: z.string().max(500) }))
	.handler(async ({ data }) => {
		await setUrl(data.key, data.value, data.password);
		return integrationsView();
	});

export const notifyTestFn = createServerFn({ method: "POST" })
	.validator(z.object({ password: z.string().max(500) }))
	.handler(async ({ data }) => {
		await requestNotifyTest(data.password);
		return integrationsView();
	});

export const getSecrets = createServerFn().handler(async () => secretRows());

// The value is in the request only. The answer and the errors never hold it.
export const saveSecretFn = createServerFn({ method: "POST" })
	.validator(z.object({ key: z.string().max(100), value: z.string().max(2000).optional(), clear: z.boolean().optional(), password: z.string().max(500) }))
	.handler(async ({ data }) => saveSecret(data));

const projectInput = z.object({
	name: z.string().max(200),
	repo: z.string().max(300),
	posthogKeyEnv: z.string().max(100).nullish(),
	posthogProjectId: z.string().max(100).nullish(),
	sentry: z.object({ org: z.string().max(100), project: z.string().max(100) }).nullish(),
	scouts: z.array(z.string().max(100)).max(40),
	notes: z.string().max(5000).optional(),
	testCommand: z.string().max(2000).optional(),
	issueAuthors: z.array(z.string().max(30)).max(8),
	coolify: z.array(z.object({ instance: z.string().max(30), appUuid: z.string().max(64) })).max(10).optional(),
});

export const getProjectList = createServerFn().handler(async () => projectListView());
export const getConnections = createServerFn().handler(async () => connectionsView());
export const createProjectFn = createServerFn({ method: "POST" }).validator(projectInput).handler(async ({ data }) => createProject(data));
export const editProjectFn = createServerFn({ method: "POST" }).validator(projectInput).handler(async ({ data }) => editProject(data));
export const setEnabledFn = createServerFn({ method: "POST" })
	.validator(z.object({ id: name, enabled: z.boolean() }))
	.handler(async ({ data }) => setEnabled(data.id, data.enabled));
export const removeProjectFn = createServerFn({ method: "POST" })
	.validator(z.object({ id: name, confirm: z.string().max(200) }))
	.handler(async ({ data }) => removeProject(data.id, data.confirm));
export const refreshDiscovery = createServerFn({ method: "POST" }).handler(async () => requestDiscovery());

export const getFindings = createServerFn()
	.validator(z.object({ filters, cursor: z.number().int().min(0).default(0) }))
	.handler(async ({ data }) => findingsView(data.filters, data.cursor));

export const getRuns = createServerFn()
	.validator(z.object({ project: z.string().optional(), scout: z.string().optional(), status: z.string().optional() }))
	.handler(async ({ data }) => runsView(data));

export const getRun = createServerFn()
	.validator(z.object({ id: z.string().max(300) }))
	.handler(async ({ data }) => {
		return runView(data.id);
	});

export const getProject = createServerFn()
	.validator(z.object({ id: name }))
	.handler(async ({ data }) => {
		const p = projectView(data.id);
		if (!p) throw new Error("Project not found");
		return p;
	});

export const saveProject = createServerFn({ method: "POST" })
	.validator(z.object({ id: name, mode: z.enum(["dry", "issues", "prs"]), autoSubmit: z.boolean() }))
	.handler(async ({ data }) => updateProject(data.id, data.mode, data.autoSubmit));

export const startRunFn = createServerFn({ method: "POST" })
	.validator(z.object({ project: name, scout: name }))
	.handler(async ({ data }) => ({ state: startRun(data.project, data.scout) }));

export const getCoolify = createServerFn().handler(async () => coolifyView());

// The token is in the request only. The answer and the errors never hold it.
export const saveCoolifyFn = createServerFn({ method: "POST" })
	.validator(z.object({ name: z.string().max(30), url: z.string().max(200), token: z.string().max(2000).optional(), password: z.string().max(500) }))
	.handler(async ({ data }) => saveCoolify(data));

export const removeCoolifyFn = createServerFn({ method: "POST" })
	.validator(z.object({ name: z.string().max(30), password: z.string().max(500) }))
	.handler(async ({ data }) => removeCoolify(data));
