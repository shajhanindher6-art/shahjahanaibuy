# Responsive & accessibility QA — wave 2 (2026-11-10)

Scope: homepage, /deals, /dashboard (incl. settings + API keys),
/extension, /events, /help, /admin/fact-check, /admin/merchants —
the files owned by this wave. S3#22 (touch targets) + S4#5
(accessibility/responsive) as far as those files reach.

## How this was checked — read this first

**Code inspection only. No live browser render was run.**
This wave cannot run `next dev` / `next build` and has no live
browser, so there is NO mobile / tablet / desktop visual check
behind the matrix below: no viewport screenshots, no tap-target
measurement, no screen-reader pass, no RTL render. What was
checked is the source: heading counts (`grep '<h1'`), touch-target
heights (Tailwind classes), table usage, and the RTL `dir` wiring.
The coordinator's central build + a real device/browser pass still
needs to confirm the visual side. Anything marked "code-checked"
below means exactly that.

## Heading check — exactly one h1 per rendered page

| Page | h1 count (rendered) | Source |
| --- | --- | --- |
| `/` (homepage) | 1 | `components/home/hero-copy.tsx` renders the only h1; `app/page.tsx` itself has none. |
| `/deals` | 1 | "Smart Deal Finder". |
| `/dashboard` | 1 | "Welcome back, …". |
| `/dashboard/settings` | 1 | "Settings" (the `!settings` branch has its own h1, but the two branches are mutually exclusive). |
| `/dashboard/api-keys` | 1 | "API keys" (signed-in and guest branches each have one, mutually exclusive). |
| `/extension` | 1 | "SmartBuy Browser Extension". |
| `/events` | 1 | "Seasonal events". |
| `/help` | 1 | "Help Center". |
| `/admin/fact-check` | 1 | "Deal Fact-Checking" (the "Access Denied" branch has its own h1, mutually exclusive). |
| `/admin/merchants` | 1 | "Verified Merchants" (same branch pattern as fact-check). |

No page in scope renders two h1s at once. Section headings below
the h1 are h2/h3 in source order on the pages checked.

## Touch targets ≥ 44px

Fixed in this wave (all `min-h-[44px]` on the control itself):

- `/deals`: category filter pills + "Featured Only" pill (were
  `py-2`, ≈33px); coupon "Copy code" button; deal-card "View Deal"
  button; event links row (new).
- `/admin/fact-check`: "Create check" button; subject-type
  `<select>` is `h-11` (44px).
- `/admin/merchants`: "Record facts" / "Verify merchant" /
  "Remove verification" buttons.
- `/dashboard/api-keys`: "Create key", scope toggle buttons,
  "Copy key", "I've saved it", "Revoke" buttons.
- `/events`: per-event CTA links.

Still below 44px in owned files (known, not fixed — changing the
shared `Button` sizes would touch every page, which is a
coordinator decision):

- `Button size="sm"` (`h-9`, 36px) still used for secondary
  actions, e.g. the fact-check "Pending / All entries" filter
  buttons and the dashboard "Save Changes" flow (`h-10`, 40px).
  The default `Button` is `h-10` (40px) everywhere; only the
  buttons listed above were raised to 44px in this wave.
- Header language/country switchers are `h-8` (32px) — they live
  in `components/region/country-switcher.tsx`, NOT owned by this
  wave, so they are listed here and left alone.

## Tables → cards

- No `<table>` exists in any file owned by this wave except the
  accuracy horizon table inside `components/accuracy/accuracy-dashboard.tsx`,
  which is NOT owned by this wave (its owner mounts it; the table
  itself was left untouched). On narrow screens that table will
  overflow — a card layout for the by-horizon rows is still open.
- `app/admin/page.tsx` has a table — also NOT owned by this wave.
- Dashboard / deals / homepage content in scope is already
  card/div based; nothing was converted because there was nothing
  to convert in the owned files.

## RTL (Arabic, S5#12)

- `app/layout.tsx` sets `dir="rtl"` + `lang="ar"` from the saved
  `sb-language` cookie (server-known language only).
- `app/globals.css` adds the RTL rules: right-aligned body text
  and a mirrored slide-in animation.
- NOT verified visually: no RTL browser render was run (see the
  note at the top). Known gap: switching to Arabic live (header
  switcher) updates `document.documentElement.lang` in the
  RegionProvider but does not set `dir` — the direction flips on
  the next page load, not instantly. The provider file is not
  owned by this wave; the fix is a one-line `dir` set next to the
  existing `lang` set in `components/region/region-provider.tsx`.

## Design-system divergences — unified only within owned files

Unified in this wave's files: new buttons use the shared `Button`
/ `Input` / `Card` components with `min-h-[44px]`; new selects
use the same `h-11` bordered style as the settings selects.

Still divergent (listed, not fixed — each needs its owner's call):

- Raw `<button>` pills on `/deals` (category filters) — kept
  deliberately: they are toggle pills, not `Button` variants, and
  restyling them would change the deals UI.
- Raw `<select>` for subject type on `/admin/fact-check` (the
  settings page uses the Radix `Select`; the admin form uses a
  native select for simplicity).
- Raw `<input type="checkbox">` on `/admin/fact-check`
  (merchant-caution flag) instead of the shared `Switch`.
- Raw `<a>` styled as a button on `/events` (per-event CTA).
- `text-destructive` (dark tint) usages elsewhere were NOT
  migrated to the new `text-destructive-text` token in this wave;
  the token exists (`--destructive-text` + Tailwind
  `text-destructive-text`) and new code in this wave uses it
  (API-keys error text). A sweep of older usages is open.

## Check matrix

| Check | Mobile (~360px) | Tablet (~768px) | Desktop (~1280px) |
| --- | --- | --- | --- |
| Exactly one h1 per page | Code-checked ✓ | Code-checked ✓ | Code-checked ✓ |
| Touch targets ≥ 44px (fixed controls) | Code-checked ✓ | Code-checked ✓ | Code-checked ✓ |
| Touch targets ≥ 44px (all controls) | NOT checked — `size="sm"` / `h-10` buttons remain | NOT checked | NOT checked |
| Layout / overflow visual | NOT checked — no browser | NOT checked | NOT checked |
| RTL layout (Arabic) | NOT checked — no browser | NOT checked | NOT checked |
| Screen reader / focus order | NOT checked | NOT checked | NOT checked |
| Tables → cards | Code-checked ✓ (no tables in owned files) | Code-checked ✓ | Code-checked ✓ |

Bottom line: headings and the fixed touch targets are verified
in source; everything visual — layout, overflow, RTL rendering,
and the remaining sub-44px controls — still needs a real
browser pass by the coordinator.
