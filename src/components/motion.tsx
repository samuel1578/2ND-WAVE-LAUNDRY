"use client";
import { m, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";
export function Reveal({
  children,
  className = "",
  delay = 0,
  x = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  x?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <m.div
      className={className}
      initial={false}
      whileInView={{ opacity: [0.82, 1], y: reduced ? 0 : [16, 0], x: reduced ? 0 : [x, 0] }}
      viewport={{ once: false, amount: 0.08 }}
      transition={{
        duration: reduced ? 0 : 0.55,
        delay: Math.min(delay, 0.2),
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </m.div>
  );
}
export function ScrollImage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], ["-3%", "3%"]);
  return (
    <div ref={ref} className="scroll-image">
      <m.div style={{ y: reduced ? 0 : y }}>{children}</m.div>
    </div>
  );
}
