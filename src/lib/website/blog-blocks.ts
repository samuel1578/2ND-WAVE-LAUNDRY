import type {
  BlogContentBlock,
  BlogImageAlign,
  BlogImageBlock,
  BlogImageSize,
  BlogTextBlock,
  BlogTextStyle,
  BlogTextMark,
  BlogTextSegment,
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
export const BLOG_FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48] as const;
export const BLOG_FONT_FAMILIES = ["Arial", "Georgia", "Inter", "Times New Roman", "Verdana"] as const;
const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

export function isBlogFontSize(value: unknown): value is BlogTextMark["fontSize"] {
  return typeof value === "number" && (BLOG_FONT_SIZES as readonly number[]).includes(value);
}
export function isBlogFontFamily(value: unknown): value is NonNullable<BlogTextMark["fontFamily"]> {
  return typeof value === "string" && (BLOG_FONT_FAMILIES as readonly string[]).includes(value);
}
export function isSafeBlogColor(value: unknown): value is string {
  return typeof value === "string" && SAFE_COLOR.test(value);
}
export function safeBlogLink(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}
export function normalizeBlogMarks(value: unknown): BlogTextMark | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const marks: BlogTextMark = {};
  for (const key of ["bold", "italic", "underline", "strike"] as const) {
    if (input[key] === true) marks[key] = true;
  }
  if (isBlogFontSize(input.fontSize)) marks.fontSize = input.fontSize;
  if (isSafeBlogColor(input.color)) marks.color = input.color.toUpperCase();
  if (isSafeBlogColor(input.highlight)) marks.highlight = input.highlight.toUpperCase();
  if (isBlogFontFamily(input.fontFamily)) marks.fontFamily = input.fontFamily;
  if (safeBlogLink(input.link)) marks.link = input.link;
  return Object.keys(marks).length ? marks : undefined;
}
export function normalizeBlogSegments(value: unknown): BlogTextSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const segments = value.flatMap((entry): BlogTextSegment[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.text !== "string") return [];
    const marks = normalizeBlogMarks(item.marks);
    return [{ text: item.text, ...(marks ? { marks } : {}) }];
  });
  return segments.length ? segments : undefined;
}
export function isValidBlogSegments(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const item = entry as Record<string, unknown>;
    if (typeof item.text !== "string") return false;
    if (item.marks === undefined) return true;
    if (!item.marks || typeof item.marks !== "object" || Array.isArray(item.marks)) return false;
    const marks = item.marks as Record<string, unknown>;
    return Object.entries(marks).every(([key, mark]) => (
      ["bold", "italic", "underline", "strike"].includes(key)
        ? mark === true
        : key === "fontSize" ? isBlogFontSize(mark)
          : key === "fontFamily" ? isBlogFontFamily(mark)
            : key === "color" || key === "highlight" ? isSafeBlogColor(mark)
              : key === "link" ? safeBlogLink(mark)
                : false
    ));
  });
}

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
      const segments = normalizeBlogSegments(block.segments);
      return [
        {
          type: "text",
          text: block.text,
          order,
          ...(isBlogTextStyle(block.style) ? { style: block.style } : {}),
          ...(segments ? { segments } : {}),
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
