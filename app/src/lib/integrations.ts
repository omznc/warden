export type IntegrationId = "hermes" | "posthog-events" | "github" | "claude" | "sentry" | "coolify" | "posthog-keys";

export type Integration = { id: IntegrationId; title: string; text: string; keys: readonly string[] };

// keys: the fixed secret keys of the integration. The PostHog API keys are a list that grows, so they have no fixed key.
export const INTEGRATIONS: readonly Integration[] = [
	{ id: "hermes", title: "Hermes", text: "Warden sends notices to Hermes, which forwards them to Telegram: failed runs, the daily cost cap and the weekly summary.", keys: ["HERMES_WEBHOOK_SECRET"] },
	{ id: "posthog-events", title: "PostHog events", text: "Warden sends product events about its own runs and items to a PostHog project. Without a token nothing is sent.", keys: ["WARDEN_POSTHOG_TOKEN", "WARDEN_POSTHOG_HOST"] },
	{ id: "github", title: "GitHub", text: "Scouts read the repositories and open issues and pull requests with this token. It must reach every project repository.", keys: ["GH_TOKEN"] },
	{ id: "claude", title: "Claude", text: "The agent of each scout needs one of these credentials to run.", keys: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] },
	{ id: "sentry", title: "Sentry", text: "Scouts of a project with a Sentry connection read the errors of that project with this token.", keys: ["SENTRY_TOKEN"] },
	{ id: "coolify", title: "Coolify", text: "Scouts read the deployments, status, settings and logs of linked Coolify apps. Warden only sends GET requests and never changes anything on Coolify.", keys: [] },
	{ id: "posthog-keys", title: "PostHog API keys", text: "Scouts read the data of a project with a personal API key. Each project names the key it uses.", keys: [] },
];

export const integrationById = (id: string): Integration | undefined => INTEGRATIONS.find((i) => i.id === id);
