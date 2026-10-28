"use server";
import { headers } from "next/headers";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import type { ContentItem, FaqItem, GalleryPlacement, LocationRecord, PromotionRecord, Settings } from "@/lib/contracts";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { writeFaqs, writeGallery, writeContent, writePromotion, writeSettings, writeLocation, writeService, writeMedia } from "./repository";
import type { MediaAsset } from "@/lib/contracts";

async function actor(permission: "content.manage" | "media.manage" | "settings.manage") {
  const admin = await getCurrentAdmin();
  if (!admin) throw new Error("Sign in with an administrator account.");
  if (!hasPermission(admin.role, permission)) throw new Error("Your administrator role does not allow this action.");
  const h = await headers();
  const origin = checkRequestOrigin({ origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), siteUrl: process.env.SITE_URL });
  if (!origin.ok) throw new Error("This request could not be verified.");
  return admin;
}
export async function saveLiveFaqs(items: FaqItem[]) {
  const admin = await actor("content.manage");
  if (!Array.isArray(items) || items.length > 500) throw new Error("FAQ collection is invalid.");
  return writeFaqs(admin.userId, items);
}
export async function saveLiveGallery(items: GalleryPlacement[]) {
  const admin = await actor("content.manage");
  if (!Array.isArray(items) || items.length > 200) throw new Error("Gallery is too large.");
  return writeGallery(admin.userId, items);
}
export async function saveLiveContent(item: ContentItem, action: "draft"|"publish"|"archive"|"unpublish") {
  const admin = await actor("content.manage");
  if (!item || item.module !== "Blog" || item.body.length > 50000) throw new Error("Article is invalid.");
  return writeContent(admin.userId,item,action);
}
export async function saveLivePromotion(item: PromotionRecord) {
  const admin = await actor("content.manage");
  if (!item || JSON.stringify(item).length > 20000) throw new Error("Promotion is invalid.");
  return writePromotion(admin.userId,item);
}
export async function saveLiveSettings(settings: Settings) {
  const admin=await actor("settings.manage");
  if (!settings || JSON.stringify(settings).length>5000) throw new Error("Settings are invalid.");
  return writeSettings(admin.userId,settings);
}
export async function saveLiveLocation(location: LocationRecord) {
  const admin=await actor("content.manage");
  if (!location || location.hours.length>14) throw new Error("Branch is invalid.");
  return writeLocation(admin.userId,location);
}
export async function saveLiveMedia(asset: MediaAsset, expectedVersion?: number) {
  const admin=await actor("media.manage");
  if(!asset || !asset.src.startsWith("https://") || asset.alt.length>1000 || asset.name.length>255) throw new Error("Marketing media is invalid.");
  return writeMedia(admin.userId,asset,expectedVersion);
}
export async function saveLiveService(item: ContentItem) {
  const admin=await actor("content.manage");
  if (!item || item.module!=="Services" || item.body.length>50000) throw new Error("Service is invalid.");
  return writeService(admin.userId,item);
}
