"use client";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";

const SOURCES = {
  dark: "/logo-animated.mp4",
  light: "/logos-animated.mp4",
} as const;

type SourceKey = keyof typeof SOURCES;

export function LogoVideoHero() {
  const { resolvedTheme } = useTheme();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [failed, setFailed] = useState(false);
  const key: SourceKey =
    resolvedTheme === "light" && !failed ? "light" : "dark";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!mounted || !video) return;
    const resume = () => {
      video.play().catch(() => {});
    };
    if (video.readyState >= 1) resume();
    else video.addEventListener("loadedmetadata", resume, { once: true });
    return () => video.removeEventListener("loadedmetadata", resume);
  }, [mounted, key]);

  if (!mounted) return <div className="logo-video__slot" aria-hidden="true" />;

  return (
    <video
      ref={videoRef}
      className="logo-video__media"
      src={SOURCES[key]}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
      onError={() => setFailed(true)}
    />
  );
}
