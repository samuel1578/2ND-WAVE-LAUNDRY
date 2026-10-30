import type { PromotionRecord } from "@/lib/contracts";

export const MARKETING_ASSETS_BUCKET = "marketing-assets";
export const MARKETING_ASSETS_PROMOTIONS_PATH = "promotions/";
export const MAX_PROMOTION_IMAGE_BYTES = 2 * 1024 * 1024;

const imageExtensions = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type PromotionImageMime = keyof typeof imageExtensions;

export function promotionImageBaseUrl(projectUrl: string): string {
  return `${projectUrl.replace(/\/+$/, "")}/storage/v1/object/public/${MARKETING_ASSETS_BUCKET}/${MARKETING_ASSETS_PROMOTIONS_PATH}`;
}

export function promotionImageError(
  item: Pick<PromotionRecord, "imageUrl" | "imageAlt">,
  projectUrl: string,
): string {
  const imageUrl = item.imageUrl?.trim() ?? "";
  const imageAlt = item.imageAlt?.trim() ?? "";
  if (!imageUrl && !imageAlt) return "";
  if (!imageUrl) return "Add an image or clear the image alt text.";
  if (!projectUrl || !imageUrl.startsWith(promotionImageBaseUrl(projectUrl)))
    return "Promotion images must be uploaded to the marketing-assets promotions folder.";
  if (!imageAlt) return "Add alt text for the promotion image.";
  return "";
}

export function detectPromotionImageMime(bytes: Uint8Array): PromotionImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return null;
}

export function promotionImageUploadError(
  file: Pick<File, "name" | "type" | "size">,
  mime: PromotionImageMime | null,
): string {
  if (file.size > MAX_PROMOTION_IMAGE_BYTES)
    return "Promotion images must be 2 MB or smaller.";
  if (!mime || file.type !== mime)
    return "Choose a valid JPEG, PNG or WebP image.";
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const validExtension =
    mime === "image/jpeg"
      ? extension === "jpg" || extension === "jpeg"
      : extension === mime.slice("image/".length);
  if (!validExtension)
    return "The image file extension does not match its contents.";
  return "";
}

export function promotionImageExtension(mime: PromotionImageMime): string {
  return mime === "image/jpeg" ? "jpg" : mime.slice("image/".length);
}
