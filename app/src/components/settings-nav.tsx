import { Link, useNavigate } from "@tanstack/react-router";
import { SIDE_LINK, SideHeading } from "@/components/settings-layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTEGRATIONS } from "@/lib/integrations";
import { useNarrow } from "@/lib/use-narrow";

type Item = { href: string; label: string; exact?: boolean };
type Group = { heading: string; items: Item[] };

export const SETTINGS_GROUPS: Group[] = [
	{
		heading: "Warden",
		items: [
			{ href: "/settings", label: "General", exact: true },
			{ href: "/settings/limits", label: "Limits" },
		],
	},
	{
		heading: "Integrations",
		items: [{ href: "/settings/integrations", label: "Overview", exact: true }, ...INTEGRATIONS.map((i) => ({ href: `/settings/integrations/${i.id}`, label: i.title }))],
	},
	{ heading: "Security", items: [{ href: "/settings/security", label: "Session" }] },
];

// Router links need a literal route. The hrefs above come from this one list, so the cast is safe.
function ItemLink({ item }: { item: Item }) {
	const id = item.href.split("/")[3];
	return id ? (
		<Link {...SIDE_LINK} to="/settings/integrations/$id" params={{ id }}>
			{item.label}
		</Link>
	) : (
		<Link {...SIDE_LINK} to={item.href as "/settings"} activeOptions={{ exact: item.exact ?? false }}>
			{item.label}
		</Link>
	);
}

function NarrowNav({ current }: { current: string }) {
	const navigate = useNavigate();
	const options = SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => ({ value: i.href, label: g.heading === "Integrations" ? `${g.heading}: ${i.label}` : i.label })));
	return (
		<Select value={current} items={options} onValueChange={(v) => navigate({ to: String(v) as "/settings" })}>
			<SelectTrigger aria-label="Settings section" className="h-9 w-full bg-card">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((o) => (
					<SelectItem key={o.value} value={o.value}>
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function SettingsNav({ pathname }: { pathname: string }) {
	const narrow = useNarrow();
	if (narrow) return <NarrowNav current={pathname.replace(/\/$/, "") || "/settings"} />;
	return (
		<nav aria-label="Settings" className="space-y-1">
			{SETTINGS_GROUPS.map((g, i) => (
				<div key={g.heading} className="space-y-1">
					<SideHeading first={i === 0}>{g.heading}</SideHeading>
					{g.items.map((item) => (
						<ItemLink key={item.href} item={item} />
					))}
				</div>
			))}
		</nav>
	);
}
