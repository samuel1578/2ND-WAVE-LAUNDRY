"use client";
import { Fragment, useMemo } from "react";
import { m, useReducedMotion } from "motion/react";
import { brandHighlights, splitHighlighted } from "@/lib/brand-highlight";

export function BrandGlowText({
  text,
  children,
  highlights = brandHighlights,
  animate = true,
  className,
}: {
  text?: string;
  children?: React.ReactNode;
  highlights?: readonly string[];
  animate?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const source =
    typeof text === "string"
      ? text
      : typeof children === "string"
        ? children
        : "";
  const parts = useMemo(
    () => (source ? splitHighlighted(source, highlights) : []),
    [source, highlights],
  );
  if (!source) return <>{children}</>;
  return (
    <>
      {parts.map((part, index) => {
        const key = `${part.text}-${index}`;
        if (!part.match) return <Fragment key={key}>{part.text}</Fragment>;
        if (!animate || reduced)
          return (
            <span
              key={key}
              className={`brand-glow${className ? ` ${className}` : ""}`}
            >
              {part.text}
            </span>
          );
        return (
          <m.span
            key={key}
            className={`brand-glow${className ? ` ${className}` : ""}`}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: false }}
            transition={{ duration: 0.5 }}
          >
            {part.text}
          </m.span>
        );
      })}
    </>
  );
}
