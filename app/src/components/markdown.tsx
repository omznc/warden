import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

export function safeHref(href: string | undefined): string | null {
	try {
		const u = new URL(String(href));
		return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
	} catch {
		return null;
	}
}

type AnchorProps = ComponentProps<"a">;

function Link({ href, children }: AnchorProps) {
	const ok = safeHref(href);
	if (!ok) return <span>{children}</span>;
	return (
		<a href={ok} target="_blank" rel="noopener noreferrer nofollow">
			{children}
		</a>
	);
}

// Images in the text become links, so the page never loads a file from another site.
function Image({ src, alt }: ComponentProps<"img">) {
	const ok = safeHref(typeof src === "string" ? src : undefined);
	const label = alt || ok || "image";
	return ok ? (
		<a href={ok} target="_blank" rel="noopener noreferrer nofollow">
			{label}
		</a>
	) : (
		<span>{label}</span>
	);
}

export function Markdown({ children }: { children: string }) {
	return (
		<div className="md text-[13px] leading-5 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded-sm [&_code]:border [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_h1]:mt-4 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2 [&_ul]:ml-5 [&_ul]:list-disc [&>:first-child]:mt-0">
			<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} skipHtml components={{ a: Link, img: Image }}>
				{children}
			</ReactMarkdown>
		</div>
	);
}
