import { Picture } from "@/components/ui";
import { BrandText } from "@/components/brand-text";
import type { BlogContentBlock } from "@/lib/contracts";

export function BlogBody({
    body,
    contentBlocks,
}: {
    body: string;
    contentBlocks?: BlogContentBlock[];
}) {
    const blocks: BlogContentBlock[] = contentBlocks?.length
        ? [...contentBlocks].sort((a, b) => a.order - b.order)
        : body
            .split(/\n{2,}/)
            .map((text, index) => ({ type: "text", text, order: index + 1 }));

    return (
        <div className="blog-content">
            {blocks.map((block, index) => {
                if (block.type === "image") {
                    return (
                        <figure className="blog-content__image" key={`image-${block.order}-${index}`}>
                            <Picture
                                photo={block.src ? { src: block.src, alt: block.alt } : undefined}
                                sizes="(max-width: 700px) 100vw, 760px"
                            />
                            {block.caption && <figcaption>{block.caption}</figcaption>}
                        </figure>
                    );
                }
                const paragraphs = block.text.split(/\n{2,}/).filter((paragraph) => paragraph.trim());
                return paragraphs.map((paragraph, paragraphIndex) => (
                    <p key={`text-${block.order}-${index}-${paragraphIndex}`}>
                        <BrandText text={paragraph} />
                    </p>
                ));
            })}
        </div>
    );
}
