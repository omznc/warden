import { Check, CircleDashed, Clock, Loader, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { type Tone, Pill } from "@/components/badges";
import { formatDuration } from "@/lib/format";
import type { TestResult, TestStatus } from "@/lib/types";

const STATUS: Record<TestStatus, { tone: Tone; label: string; icon: ReactNode }> = {
	pass: { tone: "ok", label: "Pass", icon: <Check aria-hidden /> },
	fail: { tone: "error", label: "Fail", icon: <X aria-hidden /> },
	error: { tone: "error", label: "Error", icon: <TriangleAlert aria-hidden /> },
	running: { tone: "info", label: "Running", icon: <Loader aria-hidden className="animate-spin" /> },
	queued: { tone: "pending", label: "Queued", icon: <Clock aria-hidden /> },
	skipped: { tone: "neutral", label: "Skipped", icon: <CircleDashed aria-hidden /> },
};

function duration(r: TestResult): string | null {
	if (!r.started || !r.ended) return null;
	const ms = Date.parse(r.ended) - Date.parse(r.started);
	return Number.isFinite(ms) && ms >= 0 ? formatDuration(ms) : null;
}

function Facts({ r }: { r: TestResult }) {
	const time = duration(r);
	return (
		<dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
			{time ? <div className="flex gap-1.5"><dt>Duration</dt><dd className="tabular text-foreground">{time}</dd></div> : null}
			{r.exit_code !== null ? <div className="flex gap-1.5"><dt>Exit code</dt><dd className="tabular text-foreground">{r.exit_code}</dd></div> : null}
		</dl>
	);
}

// All text from the result file is untrusted. React escapes it, and it never goes through markdown.
export function TestsCard({ result }: { result: TestResult | null }) {
	const s = result ? STATUS[result.status] : null;
	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<div className="flex items-center justify-between gap-3 border-b px-4 py-3">
				<h2 className="text-sm font-semibold">Tests</h2>
				{s ? <Pill tone={s.tone}>{s.icon}{s.label}</Pill> : <Pill tone="neutral">No test command</Pill>}
			</div>
			{result ? (
				<div className="space-y-2 px-4 py-3">
					{result.reason ? <p className="text-muted-foreground">{result.reason}</p> : null}
					{result.command ? <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">{result.command}</pre> : null}
					<Facts r={result} />
					{result.output_tail ? (
						<details>
							<summary className="cursor-pointer text-xs font-medium">Output (last lines)</summary>
							<pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-2.5 py-2 font-mono text-xs leading-[18px]">{result.output_tail}</pre>
						</details>
					) : null}
				</div>
			) : (
				<p className="px-4 py-3 text-muted-foreground">This project has no test command, or the tests have not started.</p>
			)}
		</div>
	);
}
