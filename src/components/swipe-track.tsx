"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function SwipeTrack({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const [count, setCount] = useState(0);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const update = () => {
      const total = el.children.length;
      setCount(total);
      if (total < 2 || el.scrollWidth <= el.clientWidth) {
        setActive(0);
        return;
      }
      const ratio = el.scrollLeft / (el.scrollWidth - el.clientWidth);
      setActive(Math.round(ratio * (total - 1)));
    };

    update();
    const onScroll = () => {
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        update();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <div className="swipe-track">
      <div
        className={`swipe-track__viewport ${className}`.trim()}
        ref={viewportRef}
      >
        {children}
      </div>
      {count > 1 && (
        <div className="swipe-track__dots" aria-hidden="true">
          {Array.from({ length: count }, (_, i) => (
            <i key={i} className={i === active ? "is-active" : ""} />
          ))}
        </div>
      )}
    </div>
  );
}
