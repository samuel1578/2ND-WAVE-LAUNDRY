"use client";
import { useEffect, useLayoutEffect, useState } from "react";

export type HeroMode = "animated" | "static";

const STATIC_QUERY = "(prefers-reduced-motion: reduce)";

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useHeroMode(): HeroMode {
  const [mode, setMode] = useState<HeroMode>("animated");

  useIsoLayoutEffect(() => {
    const apply = () =>
      setMode(window.matchMedia(STATIC_QUERY).matches ? "static" : "animated");
    apply();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => apply();
    reduced.addEventListener("change", onChange);
    window.addEventListener("orientationchange", onChange);
    return () => {
      reduced.removeEventListener("change", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, []);

  return mode;
}
