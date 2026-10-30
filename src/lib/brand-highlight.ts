export const brandHighlights = [
  "2nd Wave Laundry Services",
  "2nd Wave Laundry",
  "2nd Wave",
] as const;

export function createHighlightPattern(highlights: readonly string[]): RegExp {
  const escaped = [...highlights]
    .sort((a, b) => b.length - a.length)
    .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(${escaped.join("|")})`, "gi");
}

export type HighlightPart = { text: string; match: boolean };

export function splitHighlighted(
  text: string,
  highlights: readonly string[] = brandHighlights,
): HighlightPart[] {
  if (!text) return [];
  const pattern = createHighlightPattern(highlights);
  const matches = new Set(highlights.map((item) => item.toLowerCase()));
  const parts: HighlightPart[] = [];
  let lastIndex = 0;
  for (const found of text.matchAll(pattern)) {
    const index = found.index ?? 0;
    const value = found[0];
    if (index > lastIndex)
      parts.push({ text: text.slice(lastIndex, index), match: false });
    parts.push({ text: value, match: matches.has(value.toLowerCase()) });
    lastIndex = index + value.length;
  }
  if (lastIndex < text.length)
    parts.push({ text: text.slice(lastIndex), match: false });
  return parts;
}

export function splitBranded(text: string, legacy?: string): HighlightPart[] {
  const token = /\[\[brand\]\]([\s\S]*?)\[\[\/brand\]\]/gi;
  const parts: HighlightPart[] = [];
  let lastIndex = 0;
  for (const found of text.matchAll(token)) {
    const index = found.index ?? 0;
    if (index > lastIndex) {
      parts.push(
        ...splitHighlighted(
          text.slice(lastIndex, index),
          legacy ? [...brandHighlights, legacy] : brandHighlights,
        ),
      );
    }
    parts.push({ text: found[1], match: true });
    lastIndex = index + found[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(
      ...splitHighlighted(
        text.slice(lastIndex),
        legacy ? [...brandHighlights, legacy] : brandHighlights,
      ),
    );
  }
  return parts;
}

export function BrandedText({
  text,
  legacy,
}: {
  text: string;
  legacy?: string;
}): ReactNode {
  return (
    createElement(
      Fragment,
      null,
      ...splitBranded(text, legacy).map((part, index) =>
        createElement(
          Fragment,
          { key: index },
          part.match
            ? createElement("span", { className: "brand-glow" }, part.text)
            : part.text,
        ),
      ),
    )
  );
}
import { createElement, Fragment, type ReactNode } from "react";
