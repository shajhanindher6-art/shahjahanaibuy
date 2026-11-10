# SmartBuy AI — Design System

**Date:** 10 November 2026 (Section 4 item 1 — design system + brand consistency)
**Source of truth for tokens:** `app/globals.css` (`:root` / `.dark` CSS variables) +
`tailwind.config.ts` (Tailwind theme extension). This document describes
them; it does not replace them — change a token in `globals.css`, then
update this file.

## 1. Color tokens

All colors are HSL CSS variables, consumed through Tailwind (`bg-primary`,
`text-muted-foreground`, …). Hex values below are the nearest Tailwind
palette equivalents, for designers — the HSL value is authoritative.

### Light mode (`:root`)

| Token | HSL | ≈ Hex | Used for |
|---|---|---|---|
| `--background` | 0 0% 100% | #ffffff | Page background |
| `--foreground` | 222 47% 11% | #0f172a | Body text |
| `--card` / `--card-foreground` | 0 0% 100% / 222 47% 11% | #ffffff / #0f172a | Card surfaces + text |
| `--popover` / `--popover-foreground` | 0 0% 100% / 222 47% 11% | #ffffff / #0f172a | Popovers, dropdowns |
| `--primary` | 221 83% 53% | #2563eb | Primary buttons, links, accents |
| `--primary-foreground` | 210 40% 98% | #f8fafc | Text on primary |
| `--secondary` | 210 40% 96% | #f1f5f9 | Secondary buttons |
| `--secondary-foreground` | 222 47% 11% | #0f172a | Text on secondary |
| `--muted` | 210 40% 96% | #f1f5f9 | Muted surfaces, icon chips |
| `--muted-foreground` | 215 16% 47% | #64748b | Secondary text, descriptions |
| `--accent` | 210 40% 94% | #e9eff7 | Hover surfaces |
| `--accent-foreground` | 222 47% 11% | #0f172a | Text on accent |
| `--destructive` | 0 72% 51% | #dc2626 | Errors, destructive buttons |
| `--destructive-foreground` | 210 40% 98% | #f8fafc | Text on destructive |
| `--success` | 142 71% 45% | #22c55e | Success states, check icons |
| `--success-foreground` | 222 47% 11% | #0f172a | Text on success |
| `--warning` | 38 92% 50% | #f59e0b | Warnings, stars |
| `--warning-foreground` | 222 47% 11% | #0f172a | Text on warning |
| `--border` / `--input` | 214 32% 91% | #e2e8f0 | Borders, input borders |
| `--ring` | 221 83% 53% | #2563eb | Focus rings |
| `--chart-1…5` | blue / green / amber / purple / pink | — | Charts (recharts) |

### Dark mode (`.dark`)

Same token names; values change: background `222 47% 7%` (≈ #0a1120),
card `222 47% 10%`, primary `217 91% 60%` (#3b82f6) with dark
primary-foreground `222 47% 11%`, muted-foreground `215 20% 65%`,
destructive `0 63% 31%` (#7f1d1d) with white text, success/warning
unchanged with dark foregrounds (see §5).

### Rules

- Never hardcode a hex color in a component — use a token
  (`bg-card`, `text-muted-foreground`, `border-border`, …). The
  exceptions are the AI Glass dashboard (`glass-card` in
  `globals.css`) and one-off chart colors, both documented where
  they live.
- Never use a token pair that fails contrast (see §5).

## 2. Type scale

- **Font:** Inter (`next/font/google`, `--font-inter`), system-ui fallback.
- **Scale:** Tailwind defaults — `text-xs` 12px, `text-sm` 14px,
  `text-base` 16px, `text-lg` 18px, `text-xl` 20px, `text-2xl` 24px,
  `text-3xl` 30px. Body is `text-base`; card titles `text-lg` /
  `text-2xl`; page titles `text-3xl`; section headings `text-2xl`.
- **Weights:** normal 400, medium 500 (buttons, nav), semibold 600
  (titles), bold 700 (page titles, wordmark).
- `font-feature-settings: 'rlig' 1, 'calt' 1` on `body`.

## 3. Spacing & radius

- **Spacing:** Tailwind's 4px scale (`p-4` = 16px, `gap-3` = 12px, …).
  Page container: `container mx-auto px-3 sm:px-4`, max `2xl: 1400px`.
  Header height: `h-16` (64px).
- **Radius:** `--radius: 0.5rem` → `rounded-lg` 8px, `rounded-md` 6px,
  `rounded-sm` 4px. Pills/badges use `rounded-full`. Cards use
  `rounded-lg` (via the `Card` component); dialogs `rounded-lg`.

## 4. Motion (Section 4 item 3)

One easing, one duration scale — for the whole site:

- **Easing (the only one):** `cubic-bezier(0.4, 0, 0.2, 1)`
  (`--motion-easing-standard`, Tailwind `ease-motion-standard`).
- **Duration scale:** fast `150ms`, base `200ms`, slow `300ms`,
  page `400ms` (`--motion-duration-*`, Tailwind
  `duration-motion-fast/base/slow/page`).
- **Animations:** `animate-fade-in` (400ms, page/section entrance),
  `animate-slide-in-right` (300ms), `animate-shimmer` (1.2s,
  skeleton), accordion open/close (200ms). All use the standard
  easing — the old per-animation `ease-out` values were unified
  2026-11-10 (visually near-identical).
- **Page transitions:** `components/layout/page-transition.tsx`
  replays `animate-fade-in` on every route change (keyed by
  pathname; same-page query changes do not replay it).
- **Reduced motion:** `app/globals.css` forces all animation /
  transition durations to ~0.01ms and `scroll-behavior: auto` under
  `prefers-reduced-motion: reduce`. Components that animate also
  carry `motion-reduce:animate-none` (dashboard pattern).
- **Rule:** never invent a new easing curve or duration in new code.
  Hover lifts (`hover:-translate-y-1`), button presses and tab
  transitions stay inside this scale.

## 5. Dark mode + contrast audit (Section 4 item 4)

- **Theme toggle:** `components/ui/theme-toggle.tsx` (Sun/Moon,
  `next-themes`) is in the site header
  (`components/layout/site-header.tsx`) on every page ≥360px wide,
  and in the mobile menu below that. Preference is saved by
  `next-themes` in localStorage (`theme` key, `system` default) —
  no cookie, no server state. The `.dark` class strategy is set in
  `tailwind.config.ts` (`darkMode: ['class']`).
- **Contrast audit** (computed 2026-11-10 from the token HSL values,
  WCAG 2.1 AA: normal text ≥ 4.5:1, large text ≥ 3:1):

| Pair | Light | Dark | Verdict |
|---|---|---|---|
| foreground on background | 17.90 | 18.35 | Pass |
| muted-foreground on background | 4.72 | 7.47 | Pass (light is close to the line — do not lighten it further) |
| primary-foreground on primary | 4.96 | 4.93 | Pass |
| destructive-foreground on destructive | **4.83** | 9.43 | Pass — light was 3.61 before the 2026-11-10 fix (red darkened `0 84% 60%` → `0 72% 51%`) |
| success-foreground on success | **~5.9** | **~5.9** | Pass — was 2.30 (white on green) before the fix (foreground → dark `222 47% 11%`) |
| warning-foreground on warning | **~7.0** | **~7.0** | Pass — was 2.14 (white on amber) before the fix (foreground → dark) |

- **Fixed 2026-11-10** (`app/globals.css`): light destructive
  `0 84% 60%` → `0 72% 51%`; success/warning foregrounds white →
  dark in both modes. Safe: `bg-success`/`bg-warning` and
  `text-*-foreground` had zero usages outside the token
  definitions, so no rendered component changed except the
  destructive button/badge red (slightly darker).
- **Known remaining issue (wave 2):** in dark mode,
  `text-destructive` on tinted `bg-destructive/10` backgrounds
  (auth error boxes) is low contrast — the dark destructive
  (`0 63% 31%`) is a *background* red, not a text red. Fix needs a
  separate `--destructive-text` token; not hacked in this wave.
- **Minor:** the header theme toggle hides below 360px viewport
  width (header width budget at 320px). It is still reachable via
  the mobile menu. Revisit if the header is redesigned.

## 6. Component audit (Section 4 item 1)

One button, one card, one badge — everywhere. Audit date 2026-11-10.

| Component | File | Variants | Imported by |
|---|---|---|---|
| `Button` | `components/ui/button.tsx` | 6 variants (default, destructive, outline, secondary, ghost, link) × 4 sizes (default, sm, lg, icon) | 62 files |
| `Card` (+ Header/Content/Footer/Title/Description) | `components/ui/card.tsx` | — (`rounded-lg border bg-card text-card-foreground shadow-sm`) | 79 files |
| `Badge` | `components/ui/badge.tsx` | 4 variants (default, secondary, destructive, outline) | 54 files |
| `EmptyState` | `components/ui/empty-state.tsx` | — (icon + eyebrow + title + description + action) | compare, dashboard, deals, tracking, wishlists, … |

**Divergences found (not unified in this wave — listed for wave 2):**

1. **Raw `<button>` elements** in 21 files outside `components/ui/`
   (e.g. compare remove-product buttons, dashboard chat icon
   buttons, deals page buttons, a text-link retry in wishlists).
   Mostly icon-only or text-link buttons. Wave 2: replace with
   `Button variant="ghost" size="icon"` / `variant="link"`.
2. **Custom card-like divs** with `rounded-* border bg-card …
   shadow-sm` instead of `Card`: `components/layout/auth-shell.tsx`,
   `components/accuracy/accuracy-dashboard.tsx`. Wave 2: swap to
   `Card` (no visual change — same classes).
3. **Custom badge-like pills** (`rounded-full … text-xs`) instead
   of `Badge`: blog tag chips (`app/blog/page.tsx`,
   `app/blog/[slug]/page.tsx`), product-card discount overlay
   (`components/products/product-card.tsx`), the price-prediction
   badge (`components/products/price-prediction-badge.tsx`,
   color-coded by prediction — needs a new `Badge` variant or a
   documented exception), AI chat suggestion chips
   (`components/chat/ai-deal-finder-widget.tsx`,
   `components/dashboard/ai-chat-panel.tsx`), category-inflation
   pill (`components/category-inflation.tsx`). Wave 2: unify the
   plain ones; the color-coded prediction pill needs a design
   decision first (it encodes meaning in color, not just style).
4. **Custom empty-state markup** still exists in a few places
   (dashboard sections that predate `EmptyState`). Wave 2: migrate
   to `EmptyState` with the three-part pattern (§7).

**Unification done in this wave:** the new PWA install prompt
(`components/pwa/install-prompt.tsx`) uses `Card` + `Button`
instead of a hand-rolled card div.

## 7. Empty & error states (Section 4 item 6)

Shared component: `components/ui/empty-state.tsx`. Every empty /
error state follows the same three parts:

1. **What happened** — `eyebrow` + `title` ("No reviews yet",
   "Page not found").
2. **Why** — `description`, honest only. Never claim data exists
   when it does not ("No listings" — never "Out of stock" for zero
   listings; "No reviews yet" — never an invented summary).
3. **Next step** — `action` (a Button/Link: browse, retry, sign in,
   go home).

Pages: `app/not-found.tsx` (404, router back button —
`javascript:` hrefs are banned by the CSP), `app/error.tsx`
(500, try again / go home — copy no longer claims "our team has
been notified", because Sentry delivery is unverified),
`app/global-error.tsx` (root-layout failure, inline styles only,
try again / go home), `app/offline/page.tsx` (served by the
service worker when a navigation fails offline — see
`docs/pwa.md`).

## 8. SEO / hreflang (Section 2 item 13)

`app/layout.tsx` metadata sets `alternates.languages` with
`x-default` + one entry per supported UI language (en, ur, de, fr,
es, it, pt, tr — `lib/i18n.ts` dictionaries /
`lib/region.ts SUPPORTED_LANGUAGES`). There are **no localized
routes** — language is client-side (cookie/localStorage) — so every
alternate points at the same canonical URL rather than inventing
`/de/` … paths. The `x-default` entry is the useful signal;
per-language URLs need localized routes first (wave 2). The
dynamic `/products/[slug]` page inherits this map and should set
its own per-product alternates in its `generateMetadata` (wave 2).
