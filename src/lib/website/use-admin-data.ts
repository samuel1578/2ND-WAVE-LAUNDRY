"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { demoMode } from "@/lib/demo-mode";

export function useAdminWebsiteData<T>(module: string, demoItems: T[]) {
  const [items, setItems] = useState<T[]>(() => (demoMode ? demoItems : []));
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    if (demoMode) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/website?module=${encodeURIComponent(module)}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "Your administrator role does not allow this module."
            : "Website data could not be loaded.",
        );
      }
      const body = await response.json();
      if (!Array.isArray(body.items)) {
        throw new Error("Website data could not be loaded.");
      }
      if (!controller.signal.aborted) setItems(body.items);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setItems([]);
        setError((cause as Error).message || "Website data could not be loaded.");
      }
    } finally {
      if (!controller.signal.aborted && request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }, [module]);

  useEffect(() => {
    void refetch();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [refetch]);

  return { items, loading, error, setItems, refetch };
}
