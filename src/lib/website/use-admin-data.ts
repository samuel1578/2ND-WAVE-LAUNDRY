"use client";
import { useEffect, useState } from "react";
import { demoMode } from "@/lib/demo-mode";
export function useAdminWebsiteData<T>(module:string, demoItems:T[]) {
  const [items,setItems]=useState<T[]>(demoItems);
  const [loading,setLoading]=useState(!demoMode);
  const [error,setError]=useState("");
  useEffect(()=>{
    if(demoMode)return;
    let active=true;
    fetch(`/api/admin/website?module=${encodeURIComponent(module)}`,{cache:"no-store"})
      .then(async response=>{
        if(!response.ok)throw new Error(response.status===403?"Your administrator role does not allow this module.":"Website data could not be loaded.");
        const body=await response.json();
        if(active){setItems(Array.isArray(body.items)?body.items:[]);setError("");}
      })
      .catch(cause=>{if(active){setItems([]);setError((cause as Error).message);}})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[module]);
  return {items,loading,error,setItems};
}
