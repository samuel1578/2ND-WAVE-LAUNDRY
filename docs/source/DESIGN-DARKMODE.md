---
name: Deep Ocean Industrial
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#c0c7d2'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#8a919c'
  outline-variant: '#404751'
  surface-tint: '#99cbff'
  primary: '#99cbff'
  on-primary: '#003355'
  primary-container: '#3796e1'
  on-primary-container: '#002c4a'
  inverse-primary: '#00629e'
  secondary: '#7bd0ff'
  on-secondary: '#00354a'
  secondary-container: '#00a6e0'
  on-secondary-container: '#00374d'
  tertiary: '#4ae176'
  on-tertiary: '#003915'
  tertiary-container: '#00a74b'
  on-tertiary-container: '#003111'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#cfe5ff'
  primary-fixed-dim: '#99cbff'
  on-primary-fixed: '#001d34'
  on-primary-fixed-variant: '#004a78'
  secondary-fixed: '#c4e7ff'
  secondary-fixed-dim: '#7bd0ff'
  on-secondary-fixed: '#001e2c'
  on-secondary-fixed-variant: '#004c69'
  tertiary-fixed: '#6bff8f'
  tertiary-fixed-dim: '#4ae176'
  on-tertiary-fixed: '#002109'
  on-tertiary-fixed-variant: '#005321'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  margin: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system establishes an ultra-refined, mission-critical admin console experience tailored for high-volume commercial laundry operations, fleet routing, and multi-facility logistics. 

### Visual Direction & Aesthetics
- **Style Archetype:** Modern Corporate & Technical Utility with ambient depth. Precision slate surfaces, crisp structural boundary lines, and luminous oceanic accents create an environment of hyper-focus and situational clarity.
- **Tone & Mood:** Operative, industrial, reliable, surgical, and vigilant. It avoids frivolous decoration in favor of clear data hierarchy, high-contrast operational status readouts, and tactile interactive elements.
- **Target Persona:** Plant managers, dispatch operators, facility admins, and route logistics coordinators who interact with real-time operational feeds for hours at a time. The deep navy canvas reduces ocular fatigue while neon accents signal actionable alerts instantly.

## Colors

The palette is engineered around dark slate-navy architecture with calibrated luminance tiers that establish clear depth, spatial organization, and instant situational awareness.

### Canvas & Surfaces
- **Canvas Base:** `#0B132B` (deep abyssal navy foundation) and `#0F172A` (application viewport substrate).
- **Surface Level 1 (Base Container):** `#162032` (structural backings, inset panels, sub-navigation).
- **Surface Level 2 (Elevated Cards/Tables):** `#1E293B` (primary data containers, cards, interactive panels).
- **Surface Level 3 (Overlays/Popovers):** `#24344D` (dialogs, active states, contextual dropdowns).

### Brand & Operational Blue
- **Primary Brand Blue:** `#0B80CA` (primary actions, active navigation anchors, strong interactive states).
- **Vibrant Accent Blue:** `#38BDF8` (focus rings, live telemetry indicators, secondary action accents, hyper-visible highlights).

### Borders & Structural Hairlines
- **Crisp Outer Stroke:** `#334155` (primary surface perimeter lines, table headers, form inputs).
- **Subtle Inner Stroke:** `#2D3D54` (nested grid dividers, cell separators, grouped toolbar boundaries).

### Typography Tones
- **Primary Text:** `#F8FAFC` (high-clarity headers, active metrics, critical table values).
- **Secondary / Supporting:** `#94A3B8` (labels, inactive states, column titles, descriptive copy).
- **Muted / Inactive:** `#64748B` (breadcrumbs, empty states, structural metadata, timestamps).

### Operational Status Palette
- **Pending / Attention:** `#F59E0B` text on `rgba(245, 158, 11, 0.12)` background with `#78350F` border.
- **Processing / Active Wave:** `#38BDF8` text on `rgba(56, 189, 248, 0.12)` background with `#0369A1` border.
- **Ready / Delivered / Active:** `#22C55E` text on `rgba(34, 197, 94, 0.12)` background with `#15803D` border.
- **Failed / Alert:** `#EF4444` text on `rgba(239, 68, 68, 0.12)` background with `#991B1B` border.

## Typography

The typography scale utilizes **Plus Jakarta Sans** uniformly to reinforce structural clarity, high data legibility, and geometric modernity across wide monitors and mobile operational tablets.

- **Numerics & Tabular Figures:** Enable `font-variant-numeric: tabular-nums` across all administrative data tables, metric tiles, telemetry outputs, order IDs, and timestamp columns to prevent optical jitter during live socket updates.
- **Visual Weight Rules:** Use semibold (`600`) and bold (`700`) sparingly for primary figures, critical labels, and interactive states. Body prose, standard metadata, and secondary columns remain strictly regular (`400`) to maintain an uncluttered visual hierarchy.
- **Micro-Copy & Badges:** `label-sm` is explicitly styled with slight tracking (`0.05em`) and uppercase transformation for status pills, logistics batch markers, and telemetry tags.

## Layout & Spacing

The portal layout adheres to a strict 12-column administrative grid system built to accommodate real-time logistics monitoring, data grids, and batch dispatch management.

### Responsive Breakpoints & Grids
- **Desktop (≥ 1280px):** 12-column fluid grid, 24px (`1.5rem`) gutter, 32px (`2rem`) outer canvas margins. Features a fixed 260px administrative navigation sidebar alongside a persistent real-time telemetry toolbar.
- **Tablet / Workstation (768px - 1279px):** 8-column layout, 16px (`1rem`) gutter, 24px (`1.5rem`) outer margin. The primary sidebar collapses to an icon-rail (72px), expanding operational dashboard card space.
- **Mobile Handheld (< 768px):** 4-column single-stack layout, 12px (`0.75rem`) gutter, 16px (`1rem`) margin. Floating or off-canvas drawer navigation ensures critical batch operations remain immediately actionable.

### Component Rhythm & Inset Rules
- Maintain an 8px base rhythm (`0.5rem`).
- Internal padding for dense administrative cards: `space-lg` (`1.5rem`) for section wrappers, `space-md` (`1rem`) for individual data tiles.
- Tight actionable clusters (search bars, filter chips, button pairs) enforce consistent `space-sm` (`0.5rem`) spacing.

## Elevation & Depth

This design system rejects deep, muddy drop shadows in favor of a layered **Tonal Surface System** paired with **Crisp Structural Borders** and subtle, controlled ambient blue glow effects.

### Layered Architecture
- **Layer 0 (Canvas):** `#0B132B` creates infinite negative depth.
- **Layer 1 (Inset Wells & Sub-panels):** `#162032` bound with a single `#2D3D54` hairline border (`1px solid`).
- **Layer 2 (Standard Surface Cards & Data Grids):** `#1E293B` raised with an outer border of `#334155` and a refined ambient shadow: `box-shadow: 0 4px 20px -2px rgba(11, 19, 43, 0.7)`.
- **Layer 3 (Modals, Overlays, Context Menus):** `#24344D` backed with a subtle secondary glow: `box-shadow: 0 12px 32px -4px rgba(2, 6, 23, 0.85), 0 0 0 1px #38BDF833`.

### Interactive Highlights
- Cards and interactive items gain a crisp border transition on hover: transitioning from `#334155` to `#38BDF8` with a micro ambient bloom `0 0 12px rgba(56, 189, 248, 0.15)`.

## Shapes

The portal implements an uncompromising **8px base border radius (`rounded-md` / level 2)** across standard interactive elements and operational cards to achieve an engineered, dependable enterprise instrument aesthetic.

- **Primary Interactive Elements (Buttons, Inputs, Selects):** Uniform `8px` (`0.5rem`) corner radius.
- **Cards, Panels, and Data Grids:** `12px` to `16px` (`rounded-lg` to `rounded-xl`) outer radius, with any nested interior panels maintaining an internal `8px` radius to ensure concentric geometry.
- **Chips, Badges, and Micro Tags:** Strictly `9999px` (pill format) to visually differentiate status indicators from rectangular interactive buttons and input modules.

## Components

### Buttons
- **Primary:** Filled `#0B80CA` background, `#F8FAFC` label, `8px` border radius, `0 2px 4px rgba(0, 0, 0, 0.2)` shadow. Hover state brightens to `#0E92E6` with a subtle `#38BDF8` rim bloom.
- **Secondary / Ghost:** Transparent background with a `1px solid #334155` border, `#94A3B8` text. Hover shifts background to `#1E293B`, border to `#38BDF8`, and text to `#F8FAFC`.
- **Destructive:** Background `rgba(239, 68, 68, 0.12)`, border `1px solid #EF4444`, text `#F87171`. Hover fills background with `#EF4444`, text turning to `#FFFFFF`.

### Status Badges & Chips
Pill-shaped containers (`border-radius: 9999px`), padding `4px 10px`, font `label-sm`.
- **Pending (Amber):** Background `rgba(245, 158, 11, 0.12)`, text `#FBBF24`, border `1px solid rgba(245, 158, 11, 0.4)`. Includes a static amber 6px dot indicator.
- **Processing (Blue):** Background `rgba(56, 189, 248, 0.12)`, text `#38BDF8`, border `1px solid rgba(56, 189, 248, 0.4)`. Dot pulsates subtly.
- **Ready / Completed (Green):** Background `rgba(34, 197, 94, 0.12)`, text `#4ADE80`, border `1px solid rgba(34, 197, 94, 0.4)`. Solid green 6px dot indicator.

### Input Fields & Selectors
- **Background:** `#162032` (recessed depth).
- **Border:** `1px solid #334155`.
- **Typography:** `#F8FAFC` value text with `#64748B` placeholder text.
- **Focus State:** Border shifts cleanly to `#38BDF8` with an outer ring `0 0 0 2px rgba(56, 189, 248, 0.2)`.

### Checkboxes & Radio Controls
- **Unchecked:** `18px x 18px` container, background `#162032`, border `1.5px solid #334155`, `4px` radius for checkboxes, full circle for radios.
- **Checked:** Background `#0B80CA`, border `#38BDF8`, crisp checkmark icon or radio pip rendered in `#F8FAFC`.

### Administrative Data Tables
- **Container:** Background `#1E293B`, rounded `12px`, border `1px solid #334155`.
- **Header:** Background `#162032`, border-bottom `1px solid #334155`, text `#94A3B8`, font `label-md`, uppercase.
- **Rows:** Alternate row highlighting using `rgba(255, 255, 255, 0.015)`. Border-bottom `1px solid #2D3D54`. Row hover triggers background `#24344D` with immediate pointer feedback.
- **Metrics & KPIs:** Single numeric values rendered with `font-variant-numeric: tabular-nums` in `#F8FAFC` at `headline-md` scale.

### Cards & Metrics Tiles
- **Standard Card:** Background `#1E293B`, border `1px solid #334155`, padding `space-lg`, border radius `12px`.
- **Interactive Metric Card:** Incorporates a top micro-border highlight (`2px solid #0B80CA` or `#38BDF8`) to designate active fleet clusters or live machine telemetry feeds.