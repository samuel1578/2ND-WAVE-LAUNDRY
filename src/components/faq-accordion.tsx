"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { BrandedText } from "@/lib/brand-highlight";

type FaqItem = { q: string; a: string; glow?: string };

const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 250;

const finePointer = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

export function FaqAccordion({
  items,
  firstOpen = true,
}: {
  items: FaqItem[];
  firstOpen?: boolean;
}) {
  const [pinned, setPinned] = useState<number | null>(
    firstOpen && items.length ? 0 : null,
  );
  const [hovered, setHovered] = useState<number | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };

  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const handleEnter = (index: number) => {
    if (!finePointer()) return;
    clearTimers();
    openTimer.current = setTimeout(() => setHovered(index), HOVER_OPEN_MS);
  };

  const handleLeave = () => {
    if (!finePointer()) return;
    clearTimers();
    closeTimer.current = setTimeout(() => setHovered(null), HOVER_CLOSE_MS);
  };

  const toggle = (index: number) => {
    clearTimers();
    setHovered(null);
    setPinned((current) =>
      current === index && (hovered ?? current) === index
        ? null
        : index,
    );
  };

  const active = hovered ?? pinned;

  return (
    <div className="faq-list">
      {items.map((item, i) => (
        <details
          key={item.q}
          open={active === i}
          onMouseEnter={() => handleEnter(i)}
          onMouseLeave={handleLeave}
        >
          <summary
            onClick={(event) => {
              event.preventDefault();
              toggle(i);
            }}
          >
            {item.q}
            <Plus size={20} aria-hidden="true" />
          </summary>
          <p>
            <BrandedText text={item.a} legacy={item.glow} />
          </p>
        </details>
      ))}
    </div>
  );
}
