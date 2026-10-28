import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { demoMode } from "@/lib/demo-mode";
import { defaultSettings, seededFaqs, seededGallery, seededLocations, seededPromotions, seededServices } from "@/lib/website/types";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "public, no-store, max-age=0" } as const;
export async function GET(request: Request) {
  if (demoMode) {
    const contentModule=new URL(request.url).searchParams.get("module");
    if(contentModule==="settings") return NextResponse.json({settings:defaultSettings},{headers:NO_STORE});
    if(contentModule==="faq") return NextResponse.json({items:seededFaqs.map((f,i)=>({id:f.id,module:"faq",record_key:f.id,payload:{question:f.question,answer:f.answer,glow:f.glow,enabled:f.enabled},published:true,sort_order:i+1,version:1}))},{headers:NO_STORE});
    if(contentModule==="gallery") return NextResponse.json({items:seededGallery.filter(g=>g.asset).map((g,i)=>({id:g.id,mediaId:g.mediaId,src:g.asset!.src,alt:g.alt,caption:g.caption,order:i+1,visible:true,version:1}))},{headers:NO_STORE});
    if(contentModule==="blog") return NextResponse.json({items:[]},{headers:NO_STORE});
    if(contentModule==="promotion") return NextResponse.json({items:seededPromotions},{headers:NO_STORE});
    if(contentModule==="services") return NextResponse.json({items:seededServices},{headers:NO_STORE});
    if(contentModule==="locations") return NextResponse.json({items:seededLocations},{headers:NO_STORE});
    return NextResponse.json({items:[]},{headers:NO_STORE});
  }
  if (!isSupabaseConfigured) return NextResponse.json({ code:"not_configured" },{status:503,headers:NO_STORE});
  const url=new URL(request.url);
  const contentModule=url.searchParams.get("module");
  try {
    const client=createSupabaseAdminClient();
    if (contentModule==="settings") {
      const [site,booking]=await Promise.all([
        client.from("public_site_settings").select("business_email,phone,whatsapp,instagram,tiktok,facebook,newsletter_visible,version").eq("id",true).maybeSingle(),
        client.from("booking_settings").select("accept_public_bookings,pickup_start,pickup_end,express_cutoff").eq("id",true).maybeSingle(),
      ]);
      if(site.error||booking.error||!site.data||!booking.data) throw Error("read failed");
      return NextResponse.json({settings:{email:site.data.business_email,phone:site.data.phone,whatsapp:site.data.whatsapp,instagram:site.data.instagram,tiktok:site.data.tiktok,facebook:site.data.facebook,newsletter:site.data.newsletter_visible,version:site.data.version,acceptBookings:booking.data.accept_public_bookings,start:String(booking.data.pickup_start).slice(0,5),end:String(booking.data.pickup_end).slice(0,5),cutoff:String(booking.data.express_cutoff).slice(0,5)}},{headers:NO_STORE});
    }
    if(contentModule==="gallery") {
      const {data,error}=await client.from("website_content").select("id,record_key,payload,published,sort_order,version,website_gallery_media(id,public_url,name,alt,caption,source,permission,archived)").eq("module","gallery").eq("published",true).order("sort_order");
      if(error)throw Error("read failed");
      const items=(data??[]).flatMap(row=>{
        const media=Array.isArray(row.website_gallery_media) ? row.website_gallery_media[0] : row.website_gallery_media;
        return media && !media.archived ? [{id:row.id,mediaId:row.payload.media_id,src:media.public_url,alt:row.payload.alt,caption:row.payload.caption,order:row.sort_order,visible:row.published,version:row.version}] : [];
      });
      return NextResponse.json({items},{headers:NO_STORE});
    }
    if(!["faq","blog","promotion","services","locations"].includes(contentModule??"")) return NextResponse.json({code:"not_found"},{status:404,headers:NO_STORE});
    if(contentModule==="services") {
      const {data,error}=await client.from("services").select("id,slug,title,summary,public_body,public_image,public_alt,kind,bookable,active,sort_order,version").eq("active",true).order("sort_order");
      if(error)throw Error("read failed");
      return NextResponse.json({items:data??[]},{headers:NO_STORE});
    }
    if(contentModule==="locations") {
      const {data,error}=await client.from("branches").select("id,slug,title,label,phone,public_map_url,public_hours,sort_order,version").eq("active",true).order("sort_order");
      if(error)throw Error("read failed");
      return NextResponse.json({items:data??[]},{headers:NO_STORE});
    }
    const {data,error}=await client.from("website_content").select("id,module,record_key,payload,published,sort_order,version").eq("module",contentModule!).eq("published",true).order("sort_order");
    if(error)throw Error("read failed");
    return NextResponse.json({items:data??[]},{headers:NO_STORE});
  } catch {
    return NextResponse.json({code:"unavailable",message:"Website content is temporarily unavailable."},{status:503,headers:NO_STORE});
  }
}
