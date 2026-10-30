import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;
const BUCKET = "marketing-assets";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

function response(body: Record<string, string>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function detectMime(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return response({ code: "unauthenticated", message: "Sign in with an administrator account." }, 401);
  if (!hasPermission(admin.role, "media.manage")) return response({ code: "permission_denied", message: "Your administrator role does not allow this action." }, 403);
  const origin = checkRequestOrigin({
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    siteUrl: process.env.SITE_URL,
  });
  if (!origin.ok) return response({ code: "invalid_origin", message: "This request could not be verified." }, 403);
  const limit = consumeRateLimit("website_content", admin.userId);
  if (!limit.ok) return response({ code: "rate_limited", message: "Too many uploads. Try again shortly." }, 429);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return response({ code: "invalid_upload", message: "Choose an image to upload." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return response({ code: "invalid_upload", message: "Choose an image to upload." }, 400);
  if (file.size > MAX_BYTES) return response({ code: "invalid_upload", message: "Images must be 4 MB or smaller." }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectMime(bytes);
  if (!mime || file.type !== mime) return response({ code: "invalid_upload", message: "Choose a valid JPEG, PNG or WebP image." }, 400);
  if (!supabaseConfig.ok) return response({ code: "unavailable", message: "Image uploads are unavailable." }, 503);
  const extension = mime === "image/jpeg" ? "jpg" : mime.slice("image/".length);
  const storagePath = `media/${randomUUID()}.${extension}`;
  try {
    const { error } = await createSupabaseAdminClient().storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: mime,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) return response({ code: "upload_failed", message: "The image could not be uploaded." }, 502);
    return NextResponse.json({
      publicUrl: `${supabaseConfig.url.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/${storagePath}`,
    }, { headers: NO_STORE });
  } catch {
    return response({ code: "unavailable", message: "Image uploads are unavailable." }, 503);
  }
}
