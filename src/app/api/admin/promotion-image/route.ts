import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseConfig } from "@/lib/supabase/config";
import {
  MARKETING_ASSETS_BUCKET,
  MAX_PROMOTION_IMAGE_BYTES,
  detectPromotionImageMime,
  promotionImageBaseUrl,
  promotionImageExtension,
  promotionImageUploadError,
} from "@/lib/website/promotion-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

function response(body: Record<string, string>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return response({ code: "unauthenticated", message: "Sign in with an administrator account." }, 401);
  if (!hasPermission(admin.role, "content.manage"))
    return response({ code: "permission_denied", message: "Your administrator role does not allow this action." }, 403);

  const origin = checkRequestOrigin({
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    siteUrl: process.env.SITE_URL,
  });
  if (!origin.ok) return response({ code: "invalid_origin", message: "This request could not be verified." }, 403);

  const limit = consumeRateLimit("website_content", admin.userId);
  if (!limit.ok)
    return NextResponse.json(
      { code: "rate_limited", message: "Too many image uploads. Try again shortly." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } },
    );

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return response({ code: "invalid_upload", message: "Choose an image to upload." }, 400);
  }
  const value = form.get("file");
  if (!(value instanceof File))
    return response({ code: "invalid_upload", message: "Choose an image to upload." }, 400);
  if (value.size > MAX_PROMOTION_IMAGE_BYTES)
    return response({ code: "invalid_upload", message: "Promotion images must be 2 MB or smaller." }, 400);

  const bytes = new Uint8Array(await value.arrayBuffer());
  const mime = detectPromotionImageMime(bytes);
  const validationError = promotionImageUploadError(value, mime);
  if (!mime || validationError)
    return response({ code: "invalid_upload", message: validationError || "Choose a valid JPEG, PNG or WebP image." }, 400);
  if (!supabaseConfig.ok)
    return response({ code: "unavailable", message: "Image uploads are unavailable." }, 503);

  const extension = promotionImageExtension(mime);
  const storagePath = `promotions/${randomUUID()}.${extension}`;
  try {
    const client = createSupabaseAdminClient();
    const { error } = await client.storage
      .from(MARKETING_ASSETS_BUCKET)
      .upload(storagePath, bytes, {
        contentType: mime,
        cacheControl: "31536000",
        upsert: false,
      });
    if (error) return response({ code: "upload_failed", message: "The image could not be uploaded." }, 502);
    return NextResponse.json(
      { imageUrl: `${promotionImageBaseUrl(supabaseConfig.url)}${storagePath.replace(/^promotions\//, "")}` },
      { headers: NO_STORE },
    );
  } catch {
    return response({ code: "unavailable", message: "Image uploads are unavailable." }, 503);
  }
}
