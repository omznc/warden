export type Env = {
	stateRoot: string;
	projectsFile: string;
	inboxRoot: string;
	testsRoot: string;
	intervalHours: number;
	maxTurns: number;
	user: string;
	password: string;
	sessionSecret: string;
	mode: "dry" | "issues" | "prs";
};

// Read at call time, so a test can change process.env.
export function env(): Env {
	const mode = process.env.MODE;
	return {
		stateRoot: process.env.STATE_ROOT || "/state",
		projectsFile: process.env.PROJECTS_FILE || "/app/projects.json",
		inboxRoot: process.env.INBOX_ROOT || "/inbox",
		testsRoot: process.env.TESTS_ROOT || "/tests-out",
		intervalHours: Number(process.env.INTERVAL_HOURS) || 12,
		maxTurns: Number(process.env.MAX_TURNS) || 60,
		user: process.env.WARDEN_USER || "admin",
		password: process.env.WARDEN_PASSWORD ?? "",
		sessionSecret: process.env.WARDEN_SESSION_SECRET ?? "",
		mode: mode === "issues" || mode === "prs" ? mode : "dry",
	};
}
