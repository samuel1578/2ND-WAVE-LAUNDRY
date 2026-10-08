"use client";
import { ThemeProvider } from "next-themes";
import { LazyMotion, domAnimation, MotionConfig } from "motion/react";
import { type ReactNode } from "react";
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      storageKey="2nd-wave-theme"
    >
      <LazyMotion features={domAnimation} strict>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </LazyMotion>
    </ThemeProvider>
  );
}
