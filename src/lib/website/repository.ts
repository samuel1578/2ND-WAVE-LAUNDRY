import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ContentItem, FaqItem, GalleryPlacement, LocationRecord, MediaAsset, PromotionRecord, Settings } from "@/lib/contracts";
import { defaultSettings, toContent, toFaq, toGallery, toPromotion, type PublicSettings } from "./types";

const fail = (message = "The website content service is unavailable."): never => { throw new Error(message); };
type RpcContentRow = { id: string; key: string; payload: Record<string, unknown>; published: boolean; sort_order: number; version: number };
type GalleryRelation = { id: string; public_url: string; name: string; alt: string; caption: string; source: string; permission: string; archived: boolean };
type GalleryRow = { id: string; record_key: string; payload: Record<string, unknown>; published: boolean; sort_order: number; version: number; website_gallery_media: GalleryRelation | null };
type MediaRow = { id: string; public_url: string; name: string; alt: string; caption: string; source: string; permission: string; archived: boolean; version: number };
const mapSettings = (row: Record<string, unknown> | null): PublicSettings => row ? {
  email: String(row.business_email ?? ""), phone: String(row.phone), whatsapp: String(row.whatsapp), instagram: String(row.instagram), tiktok: String(row.tiktok), facebook: String(row.facebook), newsletter: Boolean(row.newsletter_visible),
  acceptBookings: Boolean(row.accept_public_bookings ?? true), start: String(row.pickup_start ?? "07:00").slice(0,5), end: String(row.pickup_end ?? "17:00").slice(0,5), cutoff: String(row.express_cutoff ?? "11:00").slice(0,5), version: Number(row.version ?? 1),
} : defaultSettings;
export async function readPublicSettings(): Promise<PublicSettings> {
  const client = createSupabaseAdminClient();
  const [site, booking] = await Promise.all([
    client.from("public_site_settings").select("business_email,phone,whatsapp,instagram,tiktok,facebook,newsletter_visible,version").eq("id", true).maybeSingle(),
    client.from("booking_settings").select("accept_public_bookings,pickup_start,pickup_end,express_cutoff,version").eq("id", true).maybeSingle(),
  ]);
  if (site.error || booking.error || !site.data || !booking.data) return fail();
  return mapSettings({ ...site.data, ...booking.data, version: site.data.version });
}
export async function readPublicContent(module: string) {
  const client = createSupabaseAdminClient();
  const { data, error } = await client.from("website_content").select("id,module,record_key,payload,published,sort_order,version").eq("module", module).eq("published", true).order("sort_order", { ascending: true });
  if (error || !Array.isArray(data)) return fail();
  return data as unknown as Array<{ id: string; module: string; record_key: string; payload: Record<string, unknown>; published: boolean; sort_order: number; version: number }>;
}
export async function readPublicGallery() {
  const client = createSupabaseAdminClient();
  const { data, error } = await client.from("website_content").select("id,record_key,payload,published,sort_order,version,website_gallery_media(id,public_url,name,alt,caption,source,permission,archived)").eq("module", "gallery").eq("published", true).order("sort_order", { ascending: true });
  if (error || !Array.isArray(data)) return fail();
  return (data as unknown as GalleryRow[]).map(r => toGallery({ id: r.id, key: r.record_key, module: "gallery", payload: r.payload, published: r.published, sort_order: r.sort_order, version: r.version }, r.website_gallery_media && !r.website_gallery_media.archived ? { [r.website_gallery_media.id]: r.website_gallery_media } : {})).filter(row => row.visible && row.asset);
}
export async function readAdminContent() {
  const client = createSupabaseAdminClient();
  const { data, error } = await client.from("website_content").select("id,module,record_key,payload,published,sort_order,version").order("sort_order", { ascending: true });
  if (error || !Array.isArray(data)) return fail();
  return data as unknown as Array<{id:string;module:string;record_key:string;payload:Record<string,unknown>;published:boolean;sort_order:number;version:number}>;
}
export async function readAdminMedia(): Promise<MediaAsset[]> {
  const client = createSupabaseAdminClient();
  const { data, error } = await client.from("website_gallery_media").select("id,storage_path,public_url,name,alt,caption,source,permission,archived,version").order("created_at", { ascending: false });
  if (error || !Array.isArray(data)) return fail();
  return (data as unknown as MediaRow[]).map(r => ({ id:r.id, src:r.public_url, name:r.name, alt:r.alt, caption:r.caption, source:r.source, permission:r.permission, uses:[], archived:r.archived, version:r.version }));
}
export async function writeFaqs(actor: string, items: FaqItem[]) {
  const client=createSupabaseAdminClient();
  const rows=items.map((f,i)=>({key:f.id,payload:{question:f.question,answer:f.answer,glow:f.glow,enabled:f.enabled},published:true,sort_order:i+1}));
  const expected=Object.fromEntries(items.map(f=>[f.id,f.version]));
  const {data,error}=await client.rpc("website_content_replace",{p_actor:actor,p_module:"faq",p_items:rows,p_expected_versions:expected});
  if(error?.code==="40001") {
    const current=await client.from("website_content").select("id,record_key,payload,published,sort_order,version").eq("module","faq").order("sort_order");
    if(!current.error && Array.isArray(current.data) && current.data.length===rows.length) {
      const matches=current.data.every((row, i) => {
        const wanted=rows[i];
        return row.record_key===wanted.key
          && row.published===wanted.published
          && row.sort_order===wanted.sort_order
          && JSON.stringify(row.payload)===JSON.stringify(wanted.payload);
      });
      if(matches) {
        return current.data.map(r=>toFaq({id:r.record_key,key:r.record_key,module:"faq",payload:r.payload as Record<string,unknown>,published:r.published,sort_order:r.sort_order,version:r.version}));
      }
    }
    return fail("FAQs changed while editing. The latest saved version is different; reload the page before trying again.");
  }
  if(error)return fail(error.code==="55P03"?"Another website content save is still finishing. Wait a few seconds and retry.":`FAQs could not be saved. ${error.message ?? ""}`.trim());
  return (data as RpcContentRow[]).map(r=>toFaq({id:r.key,key:r.key,module:"faq",payload:r.payload,published:r.published,sort_order:r.sort_order,version:r.version}));
}
export async function writeGallery(actor:string, items:GalleryPlacement[]) {
  const client=createSupabaseAdminClient();
  const rows=items.map((g,i)=>({key:g.id,payload:{media_id:g.mediaId,alt:g.alt,caption:g.caption},published:g.visible,sort_order:i+1}));
  const expected=Object.fromEntries(items.map(g=>[g.id,g.version]));
  const {data,error}=await client.rpc("website_content_replace",{p_actor:actor,p_module:"gallery",p_items:rows,p_expected_versions:expected});
  if(error)return fail(error.code==="40001"?"Gallery changed while editing.":`Gallery could not be saved. ${error.message ?? ""}`.trim());
  return (data as RpcContentRow[]).map(r=>({id:r.key,mediaId:String(r.payload.media_id ?? ""),alt:String(r.payload.alt ?? ""),caption:String(r.payload.caption ?? ""),order:r.sort_order,visible:r.published,version:r.version}));
}
export async function writeContent(actor:string,item:ContentItem,action:"draft"|"publish"|"archive"|"unpublish") {
  const client=createSupabaseAdminClient();
  const published=action==="publish" || (action==="draft" && !!item.published);
  const payload={title:item.title,slug:item.slug,summary:item.summary,body:item.body,image:item.image,alt:item.alt,extra:item.extra,status:action==="archive"?"Archived":published?"Published":"Draft"};
  const {data,error}=await client.rpc("website_content_upsert",{p_actor:actor,p_module:"blog",p_key:item.slug,p_payload:payload,p_published:published,p_sort_order:item.sort,p_expected_version:item.version||null});
  if(error)return fail(error.code==="40001"?"Article changed while editing. Reload and try again.":"Article could not be saved.");
  return toContent({id:data.id,key:data.key,module:"blog",payload:data.payload,published:data.published,sort_order:data.sort_order,version:data.version});
}
export async function writePromotion(actor:string,item:PromotionRecord) {
  const client=createSupabaseAdminClient();
  const payload={...item};
  const isPublished=item.enabled && item.yearConfirmed && ["active","scheduled"].includes(item.status);
  const {data,error}=await client.rpc("website_content_upsert",{p_actor:actor,p_module:"promotion",p_key:item.id||crypto.randomUUID(),p_payload:payload,p_published:isPublished,p_sort_order:item.priority,p_expected_version:item.version||null});
  if(error)return fail("Promotion could not be saved.");
  return toPromotion({id:data.id,key:data.key,module:"promotion",payload:data.payload,published:data.published,sort_order:data.sort_order,version:data.version});
}
export async function writeSettings(actor:string,settings:Settings) {
  const client=createSupabaseAdminClient();
  const {data,error}=await client.rpc("phase6_settings_update",{p_actor:actor,p_site_version:settings.version,p_booking_version:settings.version,p_settings:{business_email:settings.email,phone:settings.phone,whatsapp:settings.whatsapp,instagram:settings.instagram,tiktok:settings.tiktok,facebook:settings.facebook,newsletter_visible:settings.newsletter,pickup_start:settings.start,pickup_end:settings.end,express_cutoff:settings.cutoff,accept_public_bookings:settings.acceptBookings}});
  if(error)return fail("Settings could not be saved. Reload the latest values and try again.");
  return mapSettings(data);
}
export async function writeLocation(actor:string,location:LocationRecord) {
  const client=createSupabaseAdminClient();
  const {data,error}=await client.rpc("website_branch_update",{p_actor:actor,p_id:location.id,p_expected_version:location.version,p_title:location.name,p_label:location.label,p_phone:location.phone,p_map_url:location.map,p_public_hours:location.hours,p_sort_order:location.order});
  if(error)return fail("Branch changed or could not be saved. Reload and try again.");
  return {...location,id:data.id,slug:data.slug,name:data.title,label:data.label,phone:data.phone,map:data.map_url,hours:data.hours,order:data.sort_order,version:data.version};
}
export async function writeService(actor:string,item:ContentItem) {
  const client=createSupabaseAdminClient();
  const {data,error}=await client.rpc("website_service_update",{p_actor:actor,p_slug:item.slug,p_expected_version:item.version,p_title:item.title,p_summary:item.summary,p_body:item.body,p_image:item.image,p_alt:item.alt,p_sort_order:item.sort});
  if(error)return fail("Service changed or could not be saved. Reload and try again.");
  return {...item,id:data.slug,version:data.version,published:{title:data.title,slug:data.slug,summary:data.summary,body:data.body,image:data.image,alt:data.alt}};
}
export async function writeMedia(actor:string,asset:MediaAsset,expectedVersion?:number) {
  const client=createSupabaseAdminClient();
  const id=asset.id||crypto.randomUUID();
  const {data,error}=await client.rpc("website_media_upsert",{p_actor:actor,p_id:id,p_storage_path:asset.src.split("/").slice(-2).join("/"),p_public_url:asset.src,p_name:asset.name,p_alt:asset.alt,p_caption:asset.caption,p_source:asset.source,p_permission:asset.permission,p_archived:asset.archived,p_expected_version:expectedVersion ?? null});
  if(error)return fail("Media could not be saved.");
  return {...asset,id:data.id,version:data.version};
}
export async function deleteBlog(actor:string,item:ContentItem) {
  const client=createSupabaseAdminClient();
  if(item.published)return fail("Unpublish this article before deleting it.");
  const {error}=await client.rpc("website_content_upsert",{p_actor:actor,p_module:"blog",p_key:item.slug,p_payload:{...item,deleted:true},p_published:false,p_sort_order:item.sort,p_expected_version:item.version});
  if(error)return fail("Article could not be removed.");
}
