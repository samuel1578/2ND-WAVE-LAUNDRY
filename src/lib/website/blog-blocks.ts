import type {
  BlogContentBlock,
  BlogImageAlign,
  BlogImageBlock,
  BlogImageSize,
  BlogTextBlock,
  BlogTextStyle,
} from "@/lib/contracts";

/** Every block style the rich text editor can produce. */
export const BLOG_TEXT_STYLES: readonly BlogTextStyle[] = [
  "paragraph",
  "heading2",
  "heading3",
  "bulleted",
  "numbered",
] as const;

export const BLOG_IMAGE_ALIGNS: readonly BlogImageAlign[] = [
  "left",
  "center",
  "right",
] as const;

export const BLOG_IMAGE_SIZES: readonly BlogImageSize[] = [
  "small",
  "medium",
  "large",
  "full",
] as const;

export function isBlogTextStyle(value: unknown): value is BlogTextStyle {
  return (
    typeof value === "string" &&
    (BLOG_TEXT_STYLES as readonly string[]).includes(value)
  );
}

export function isBlogImageAlign(value: unknown): value is BlogImageAlign {
  return (
    typeof value === "string" &&
    (BLOG_IMAGE_ALIGNS as readonly string[]).includes(value)
  );
}

export function isBlogImageSize(value: unknown): value is BlogImageSize {
  return (
    typeof value === "string" &&
    (BLOG_IMAGE_SIZES as readonly string[]).includes(value)
  );
}

function renumber(blocks: BlogContentBlock[]): BlogContentBlock[] {
  return blocks.map(
    (block, index) => ({ ...block, order: index + 1 }) as BlogContentBlock,
  );
}

/**
 * Validates stored/edited blocks and returns them in reading order. Shared by
 * the admin reader, the public reader and the save path so every consumer
 * interprets style, alignment and display size the same way.
 */
export function normalizeBlogBlocks(
  value: unknown,
): BlogContentBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const blocks = value.flatMap((entry, index): BlogContentBlock[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const block = entry as Record<string, unknown>;
    const numericOrder = Number(block.order);
    const order = Number.isFinite(numericOrder) ? numericOrder : index + 1;
    if (block.type === "text" && typeof block.text === "string") {
      return [
        {
          type: "text",
          text: block.text,
          order,
          ...(isBlogTextStyle(block.style) ? { style: block.style } : {}),
        },
      ];
    }
    if (block.type === "image" && typeof block.src === "string") {
      return [
        {
          type: "image",
          mediaId: typeof block.mediaId === "string" ? block.mediaId : "",
          src: block.src,
          alt: typeof block.alt === "string" ? block.alt : "",
          caption: typeof block.caption === "string" ? block.caption : "",
          order,
          ...(isBlogImageAlign(block.align) ? { align: block.align } : {}),
          ...(isBlogImageSize(block.size) ? { size: block.size } : {}),
        },
      ];
    }
    return [];
  });
  if (!blocks.length) return undefined;
  return renumber(blocks.sort((a, b) => a.order - b.order));
}

export function orderedBlogBlocks(
  blocks: BlogContentBlock[] | undefined,
): BlogContentBlock[] | undefined {
  return normalizeBlogBlocks(blocks);
}

/**
 * Plain-text fallback stored alongside the blocks (used by older readers and
 * search). Image-only articles fall back to their captions/alt text so the
 * mandatory body field is still meaningful instead of empty.
 */
export function blogBodyFromBlocks(
  blocks: BlogContentBlock[] | undefined,
): string {
  if (!blocks?.length) return "";
  const text = blocks
    .filter((block): block is BlogTextBlock => block.type === "text")
    .map((block) => block.text)
    .filter((value) => value.trim())
    .join("\n\n")
    .trim();
  if (text) return text;
  return blocks
    .filter((block): block is BlogImageBlock => block.type === "image")
    .map((block) => (block.caption || block.alt).trim())
    .filter(Boolean)
    .join("\n\n");
}
