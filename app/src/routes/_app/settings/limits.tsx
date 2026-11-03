import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CapForm, DaysForm, PageHead } from "@/components/settings-forms";
import { costQuery, rejectQuery, staleQuery } from "@/lib/queries";

export const Route = createFileRoute("/_app/settings/limits")({
	loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(costQuery()), context.queryClient.ensureQueryData(staleQuery()), context.queryClient.ensureQueryData(rejectQuery())]),
	component: LimitsPage,
});

function LimitsPage() {
	const cost = useQuery(costQuery()).data;
	const stale = useQuery(staleQuery()).data;
	const reject = useQuery(rejectQuery()).data;
	if (!cost || !stale || !reject) return null;
	return (
		<>
			<PageHead title="Limits" text="How much Warden spends and how long an item stays open." />
			<CapForm key={String(cost.cap)} cap={cost.cap} />
			<DaysForm
				key={`s${stale.days}`}
				id="stale"
				kind="stale"
				min={1}
				label="Stale after (days)"
				days={stale.days}
				help="A pending item older than this turns stale. Nobody can approve a stale item. The next run makes a new item."
			/>
			<DaysForm
				key={`r${reject.days}`}
				id="reject"
				kind="reject"
				min={0}
				label="Rejected items block for (days)"
				days={reject.days}
				help="Scouts do not make the same finding again for this time after you reject it. Use 0 to allow it at once."
			/>
		</>
	);
}
