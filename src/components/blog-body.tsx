import { Fragment } from "react";
import { Picture } from "@/components/ui";
import { BrandText } from "@/components/brand-text";
import type {
    BlogContentBlock,
    BlogImageBlock,
    BlogTextStyle,
} from "@/lib/contracts";
import { normalizeBlogBlocks } from "@/lib/website/blog-blocks";

function Lines({ text }: { text: string }) {
    const lines = text.split("\n");
    return (
        <>
            {lines.map((line, index) => (
                <Fragment key={index}>
                    {index > 0 && <br />}
                    <BrandText text={line} />
                </Fragment>
            ))}
        </>
    );
}

function ImageBlock({ block, blockKey }: { block: BlogImageBlock; blockKey: string }) {
    const align = block.align ?? "center";
    const size = block.size ?? "full";
    return (
        <figure
            className={`blog-content__image blog-figure blog-figure--${align} blog-figure--${size}`}
            key={blockKey}
        >
            <Picture
                photo={block.src ? { src: block.src, alt: block.alt } : undefined}
                sizes="(max-width: 700px) 100vw, 760px"
            />
            {block.caption.trim() && <figcaption>{block.caption}</figcaption>}
        </figure>
    );
}

type Row =
    | { kind: "text"; style: Exclude<BlogTextStyle, "bulleted" | "numbered">; text: string; key: string }
    | { kind: "image"; block: BlogImageBlock; key: string }
    | { kind: "list"; ordered: boolean; items: { text: string; key: string }[]; key: string };

function buildRows(blocks: BlogContentBlock[]): Row[] {
    const rows: Row[] = [];
    blocks.forEach((block, index) => {
        if (block.type === "image") {
            rows.push({ kind: "image", block, key: `image-${index}` });
            return;
        }
        const style = block.style ?? "paragraph";
        if (style === "bulleted" || style === "numbered") {
            const ordered = style === "numbered";
            const previous = rows[rows.length - 1];
            const item = { text: block.text, key: `text-${index}` };
            if (previous && previous.kind === "list" && previous.ordered === ordered) {
                previous.items.push(item);
            } else {
                rows.push({ kind: "list", ordered, items: [item], key: `list-${index}` });
            }
            return;
        }
        rows.push({ kind: "text", style, text: block.text, key: `text-${index}` });
    });
    return rows;
}

/**
 * Single renderer for the article body, shared by the admin preview and the
 * public article page so both apply the same block, alignment and size rules.
 */
export function BlogBody({
    body,
    contentBlocks,
}: {
    body: string;
    contentBlocks?: BlogContentBlock[];
}) {
    const normalized = normalizeBlogBlocks(contentBlocks);
    const blocks: BlogContentBlock[] = normalized ?? body
        .split(/\n{2,}/)
        .map((text, index) => ({ type: "text", text, order: index + 1 }));

    return (
        <div className="blog-content">
            {buildRows(blocks).map((row) => {
                if (row.kind === "image") {
                    return <ImageBlock block={row.block} blockKey={row.key} key={row.key} />;
                }
                if (row.kind === "list") {
                    const items = row.items.map((item) => (
                        <li key={item.key}>
                            {item.text.trim() ? <Lines text={item.text} /> : <br />}
                        </li>
                    ));
                    return row.ordered ? (
                        <ol key={row.key}>{items}</ol>
                    ) : (
                        <ul key={row.key}>{items}</ul>
                    );
                }
                if (row.style === "heading2") {
                    return (
                        <h2 key={row.key}>
                            {row.text.trim() ? <Lines text={row.text} /> : <br />}
                        </h2>
                    );
                }
                if (row.style === "heading3") {
                    return (
                        <h3 key={row.key}>
                            {row.text.trim() ? <Lines text={row.text} /> : <br />}
                        </h3>
                    );
                }
                return (
                    <Fragment key={row.key}>
                        {row.text.split(/\n{2,}/).map((paragraph, index) => (
                            <p key={`${row.key}-${index}`}>
                                {paragraph.trim() ? <Lines text={paragraph} /> : <br />}
                            </p>
                        ))}
                    </Fragment>
                );
            })}
        </div>
    );
}
