# Brand Glow Text — Recreation Guide

> Self-contained spec so another agent can rebuild this feature in any project.
> Source project: Next.js 15 App Router + React 19 + TypeScript + Tailwind v4 + Framer Motion.

## 1. What it does

Certain brand keywords inside plain body copy are rendered as an orange, glowing,
semibold inline highlight (e.g. `Deep Rock`, `Deep Rock Mining Limited`).
Copy stays a plain string — no markup tokens, no `dangerouslySetInnerHTML`,
no post-render DOM mutation. At render time the string is split on a regex and
matched parts become `<span class="brand-glow">`.

Two variants:

| Variant | File in source | Use when |
|---|---|---|
| `BrandText` | `components/ui/BrandText.tsx` | Server/SSR pages. No hooks, static only. |
| `BrandGlowText` | `components/ui/BrandGlowText.tsx` | Client sections. Fade-in on scroll, reduced-motion aware. |

## 2. Keyword list

Approved forms (longest-first ordering matters):

```ts
export const brandHighlights = [
  'Deep Rock Mining Limited',
  'Deep Rock Mining Ltd.',
  'Deep Rock Mining Ltd',
  'Deep Rock Co. Ltd.',
  'Deep Rock Co. Ltd',
  "Deep Rock's",
  'Deep Rock’s',   // typographic apostrophe
  'Deep Rock',
] as const
```

> Gotcha from the source project: the original `defaultBrandHighlights` listed
> only the no-space `DeepRock` spellings while copy used `Deep Rock`, so many
> call sites silently never glowed. Always ship the spaced forms as defaults.
> Matching is case-insensitive (`DEEPROCK MINING LIMITED` still matches).

## 3. Regex builder — `lib/brand-highlight.ts`

```ts
export function createHighlightPattern(highlights: readonly string[]): RegExp {
  const escaped = [...highlights]
    .sort((a, b) => b.length - a.length)          // longest first, so
    .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))  // 'Deep Rock Mining Ltd' wins over 'Deep Rock'

  return new RegExp(`(${escaped.join('|')})`, 'gi') // capture group REQUIRED for String.split
}
```

Rules:
- **Sort longest → shortest.** Otherwise `Deep Rock` matches first and
  `Deep Rock Mining Ltd` renders as glow + plain tail.
- **Regex-escape every literal** (punctuation like `.` and `()` is present).
- **Wrap in a capture group.** `text.split(re)` then returns the matched
  keywords as array elements, interleaved with the plain text.

## 4. Static server renderer — `BrandText`

```tsx
import { Fragment } from 'react'

interface BrandTextProps {
  text?: string
  children?: React.ReactNode
  className?: string
}

export function BrandText({ text, children, className }: BrandTextProps) {
  const source =
    typeof text === 'string' ? text : typeof children === 'string' ? children : ''

  if (!source) return <>{children}</>

  const parts = source.split(/(Deep Rock)/gi)   // or createHighlightPattern(brandHighlights)

  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === 'deep rock' ? (
          <span key={`${part}-${index}`} className={`brand-glow${className ? ` ${className}` : ''}`}>
            {part}
          </span>
        ) : (
          <Fragment key={`${part}-${index}`}>{part}</Fragment>
        ),
      )}
    </>
  )
}
```

Key points:
- **No `'use client'`** — deliberately a server component so it never pulls
  client hooks/libraries into a page. Deterministic server+client → no
  hydration mismatch.
- Non-matching parts are `<Fragment>` (no extra DOM node) → text selection,
  screen readers and wrapping are unchanged.

## 5. Animated client renderer — `BrandGlowText`

```tsx
'use client'

import { Fragment, useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { createHighlightPattern, brandHighlights } from '@/lib/brand-highlight'

interface BrandGlowTextProps {
  text?: string
  highlights?: readonly string[]
  animate?: boolean
  className?: string
  children?: React.ReactNode
}

export function BrandGlowText({
  text, children,
  highlights = brandHighlights,
  animate = true,
  className,
}: BrandGlowTextProps) {
  const prefersReducedMotion = useReducedMotion()

  const sourceText =
    typeof text === 'string' ? text
    : typeof children === 'string' ? children
    : ''

  if (!sourceText) {
    return children && typeof children !== 'string' ? <>{children}</> : null
  }

  const pattern = useMemo(() => createHighlightPattern(highlights), [highlights])
  const highlightSet = useMemo(
    () => new Set(highlights.map((i) => i.toLowerCase())),
    [highlights],
  )

  const parts = sourceText.split(pattern)

  return (
    <>
      {parts.map((part, index) => {
        const isHighlighted = highlightSet.has(part.toLowerCase())

        if (!isHighlighted) {
          return <Fragment key={`${part}-${index}`}>{part}</Fragment>
        }

        const classes = `brand-glow inline align-baseline leading-[inherit]${className ? ` ${className}` : ''}`

        if (!animate || prefersReducedMotion) {
          return <span key={`${part}-${index}`} className={classes}>{part}</span>
        }

        return (
          <motion.span
            key={`${part}-${index}`}
            className={classes}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            {part}
          </motion.span>
        )
      })}
    </>
  )
}
```

Key points:
- Highlight membership = **exact (case-insensitive) set equality** against the
  keyword list, not a loose "contains". That's why the longest-first split works.
- Span utilities `inline align-baseline leading-[inherit]` are mandatory —
  they keep the glow on the baseline and preserve natural line wrapping.
- Fade-in is `whileInView` + `viewport={{once:true}}`, fully bypassed when
  `animate=false` or the user prefers reduced motion (falls back to plain `<span>`).

## 6. The CSS — single source of truth

```css
/* brand glow — restrained two-layer halo, same baseline/weight so
   typography hierarchy is preserved. */
.brand-glow {
  color: #f26522;                 /* brand orange — swap for your brand hue */
  font-weight: 600;
  letter-spacing: -0.015em;
  text-shadow:
    0 0 8px  rgba(242, 101, 34, 0.30),
    0 0 18px rgba(242, 101, 34, 0.12);
}
```

Halo recipe: one tight layer (8px @ ~30% alpha) + one wide layer (18px @ ~12%
alpha), both the same hue as `color`. Keep alpha low — it's a halo, not a blur.

## 7. Design rules (do / don't)

**Must:**
- stay on the same baseline as surrounding text
- preserve natural line wrapping
- use the body font (never force the display/heading font)
- stay orange (or your single brand color)

**Do not:**
- `inline-block` + `overflow-hidden`
- vertical transforms / `top` offsets
- `leading-none`
- `display: block` on the span

## 8. Usage

```tsx
// server page
<BrandText text={service.summary} />
<p className="text-graphite"><BrandText text={paragraph} /></p>

// client section
<h2><BrandGlowText text={heading} /></h2>
<p><BrandGlowText text={intro} highlights={myBrandHighlights} /></p>
```

Possessives handle naturally: `Deep Rock's` → `Deep Rock` glows, `'s` stays plain.

## 9. Recreation checklist

1. Keyword list with **spaced** forms, longest first, including apostrophe variants.
2. `createHighlightPattern`: escape → sort longest-first → join `|` → wrap in `()` → flags `gi`.
3. Parser: `text.split(pattern)` → `highlightSet.has(part.toLowerCase())` → `<span>` else `<Fragment>`.
4. CSS class with brand `color`, `font-weight:600`, slight negative tracking, two-layer `text-shadow`.
5. Span carries `inline align-baseline leading-[inherit]`.
6. Two variants: static server (`BrandText`) and animated client (`BrandGlowText`, reduced-motion safe).
7. Wrap only prose/summary/list strings in the components; content stays plain text.

## 10. Porting notes for non-React stacks

The idea is framework-independent:

1. Same regex builder + keyword list.
2. Same `split` + exact-membership test.
3. Escape each segment with your framework's text-escaping (React does it for
   you via JSX children; other stacks must HTML-escape before joining) — **never**
   build the output by string concatenation of unescaped user text.
4. Emit `<span class="brand-glow">` for matches, raw text for the rest.
5. Port the CSS as-is; swap the hue for the target brand.
