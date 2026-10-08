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
