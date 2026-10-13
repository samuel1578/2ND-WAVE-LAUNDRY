"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export function ScrollToTop() {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;

    // Preserve deliberate section links while starting page navigations at
    // the destination's hero.
    if (!window.location.hash) window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
