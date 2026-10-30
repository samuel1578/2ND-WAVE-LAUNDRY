import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toContent, toFaq, toGallery, toPromotion } from "@/lib/website/types";
export const dynamic="force-dynamic";
const NO_STORE={"Cache-Control":"private, no-store, max-age=0"} as const;
export async function GET(request:Request) {
  const admin=await getCurrentAdmin();
  if(!admin)return NextResponse.json({code:"unauthenticated"},{status:401,headers:NO_STORE});
  const contentModule=new URL(request.url).searchParams.get("module")??"";
  const permission=contentModule==="media"?"media.manage":contentModule==="settings"?"settings.manage":"content.manage";
  if(!hasPermission(admin.role,permission))return NextResponse.json({code:"permission_denied"},{status:403,headers:NO_STORE});
  try {
    const db=createSupabaseAdminClient();
    if(contentModule==="settings") {
      const [site,booking]=await Promise.all([db.from("public_site_settings").select("business_email,phone,whatsapp,instagram,tiktok,facebook,newsletter_visible,version").eq("id",true).single(),db.from("booking_settings").select("accept_public_bookings,pickup_start,pickup_end,express_cutoff,version").eq("id",true).single()]);
      if(site.error||booking.error)throw Error();
      return NextResponse.json({settings:{email:site.data.business_email,phone:site.data.phone,whatsapp:site.data.whatsapp,instagram:site.data.instagram,tiktok:site.data.tiktok,facebook:site.data.facebook,newsletter:site.data.newsletter_visible,acceptBookings:booking.data.accept_public_bookings,start:String(booking.data.pickup_start).slice(0,5),end:String(booking.data.pickup_end).slice(0,5),cutoff:String(booking.data.express_cutoff).slice(0,5),version:site.data.version,bookingVersion:booking.data.version}},{headers:NO_STORE});
    }
    if(contentModule==="media") {
      const {data,error}=await db.from("website_gallery_media").select("id,public_url,name,alt,caption,source,permission,archived,version").order("created_at",{ascending:false});
      if(error)throw Error();
      return NextResponse.json({items:(data??[]).map(row=>({id:row.id,src:row.public_url,name:row.name,alt:row.alt,caption:row.caption,source:row.source,permission:row.permission,uses:[],archived:row.archived,version:row.version}))},{headers:NO_STORE});
    }
    if(contentModule==="services") {
      const {data,error}=await db.from("services").select("id,slug,title,summary,public_body,public_image,public_alt,kind,bookable,active,sort_order,version").order("sort_order");
      if(error)throw Error();
      return NextResponse.json({items:(data??[]).map(r=>({id:r.slug,module:"Services",title:r.title,slug:r.slug,summary:r.summary,body:r.public_body,image:r.public_image,alt:r.public_alt,status:r.active?"Published":"Archived",sort:r.sort_order,version:r.version,extra:{kind:r.kind,bookable:String(r.bookable),active:String(r.active)},published:r.active?{title:r.title,slug:r.slug,summary:r.summary,body:r.public_body,image:r.public_image,alt:r.public_alt}:undefined}))},{headers:NO_STORE});
    }
    if(contentModule==="locations") {
      const {data,error}=await db.from("branches").select("id,slug,title,label,phone,public_map_url,public_hours,sort_order,version").eq("active",true).order("sort_order");
      if(error)throw Error();
      return NextResponse.json({items:(data??[]).map(r=>({id:r.id,slug:r.slug,section:"",name:r.title,label:r.label,phone:r.phone,map:r.public_map_url,hours:Array.isArray(r.public_hours)&&r.public_hours.length?r.public_hours:[],order:r.sort_order,version:r.version}))},{headers:NO_STORE});
    }
    if(contentModule==="gallery") {
      const [galleryResult, mediaResult] = await Promise.all([
        db.from("website_content").select("id,record_key,payload,published,sort_order,version").eq("module","gallery").order("sort_order"),
        db.from("website_gallery_media").select("id,public_url,name,alt,caption,source,permission,archived"),
      ]);
      if(galleryResult.error || mediaResult.error)throw Error();
      const mediaById = Object.fromEntries((mediaResult.data ?? []).map(media => [media.id, media]));
      return NextResponse.json({items:(galleryResult.data??[]).map(row=>{
        const media = mediaById[String(row.payload.media_id ?? "")];
        return toGallery({id:row.id,key:row.record_key,module:"gallery",payload:row.payload,published:row.published,sort_order:row.sort_order,version:row.version},media ? {[media.id]:media} : {});
      })},{headers:NO_STORE});
    }
    if(!["faq","blog","promotion"].includes(contentModule))return NextResponse.json({code:"not_found"},{status:404,headers:NO_STORE});
    const {data,error}=await db.from("website_content").select("id,module,record_key,payload,published,sort_order,version").eq("module",contentModule).order("sort_order");
    if(error)throw Error();
    const items=(data??[]).map(row=>{
      const base={id:row.record_key,key:row.record_key,module:row.module,payload:row.payload,published:row.published,sort_order:row.sort_order,version:row.version};
      if (contentModule === "blog") return toContent(base);
      if (contentModule === "faq") return toFaq({ ...base, id: row.record_key });
      return toPromotion(base);
    });
    return NextResponse.json({items},{headers:NO_STORE});
  } catch {
    return NextResponse.json({code:"unavailable",message:"Website data is unavailable."},{status:503,headers:NO_STORE});
  }
}
