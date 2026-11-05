import { Check, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { type Tone, Pill } from "@/components/badges";
import type { ReviewResult } from "@/lib/types";

const VERDICT: Record<ReviewResult["verdict"], { tone: Tone; label: string; icon: ReactNode }> = {
	ok: { tone: "ok", label: "No findings", icon: <Check aria-hidden /> },
	changes: { tone: "pending", label: "Changes advised", icon: <TriangleAlert aria-hidden /> },
	error: { tone: "error", label: "Review failed", icon: <TriangleAlert aria-hidden /> },
};

const SEVERITY_TONE: Record<string, Tone> = { high: "error", medium: "pending", low: "neutral" };

// All text from review.json is untrusted. React escapes it, and it never goes through markdown.
export function ReviewCard({ result }: { result: ReviewResult | null }) {
	if (!result) return null;
	const v = VERDICT[result.verdict];
	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<div className="flex items-center justify-between gap-3 border-b px-4 py-3">
				<h2 className="text-sm font-semibold">Independent review</h2>
				<Pill tone={v.tone}>{v.icon}{v.label}</Pill>
			</div>
			<div className="space-y-2 px-4 py-3">
				{result.summary ? <p className="text-muted-foreground">{result.summary}</p> : null}
				{result.findings.length > 0 ? (
					<ul className="space-y-2">
						{result.findings.map((f, i) => (
							<li key={i} className="space-y-1">
								<div className="flex items-start gap-2">
									<Pill tone={SEVERITY_TONE[f.severity]}>{f.severity}</Pill>
									{/* Wrap a long path only after a slash, not inside a name. */}
									<code className="min-w-0 font-mono text-xs leading-5">
										{f.file.split("/").map((part, j) => (
											<span key={j}>{j > 0 ? <>/<wbr /></> : null}{part}</span>
										))}
										{f.line !== null ? `:${f.line}` : ""}
									</code>
								</div>
								<p className="text-xs text-muted-foreground">{f.summary}</p>
							</li>
						))}
					</ul>
				) : null}
			</div>
		</div>
	);
}
