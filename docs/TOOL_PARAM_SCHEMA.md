# Tool Param Schema — canonical product-selection params (DESIGN NOTE)

**Status:** design only — written 2026-11-14, Master Tool Integration Stage 0 (item D-04).
No code implements this yet; Stage 1 builds `services/tool-integration.ts`
(`parseToolParams` / `buildToolUrl`) from it. Nothing in this note changes
any tool's current behaviour: every existing dialect below keeps working
until Stage 1 ships the shared parser, and the translation rules here are
the spec Stage 1 must satisfy.

## 0. Why a canonical schema exists

Today each tool parses its own query string (audit F2): there is no shared
product context, no store, and no shared URL schema. A product picked in
one tool cannot travel to the next without re-picking it, and the dialects
differ per tool. The canonical schema is one model every tool translates
to and from — the tools keep their own public URLs, but cross-tool links
are built from one place.

## 1. The dialects that exist today (read from the tree, 2026-11-14)

| Surface | Param dialect | Parser (today) | Notes |
|---|---|---|---|
| Most tools (T4, T5, T6, T8, T9) | `?product=<slug>` | per-tool `parse*Params` in `lib/own-it-check.ts`, `lib/energy-cost.ts`, `lib/negotiation-coach.ts` (page), `app/tools/deal-stacker/page.tsx`, `app/tools/refurbished-checklist/page.tsx` | Slug is a catalog `products.slug`. Single product. |
| T10 Compatibility Checker | `?device=<slug>&accessory=<slug>` | `parseCompatibilityParams`, `lib/compatibility-checker.ts:75` | Two roles: the device vs the accessory being checked. Same product in both slots is rejected (`same-product`). |
| T1 Upgrade Advisor | `?current=<slug>&successor=<slug>` (+ `?brand=&category=&year=&price=`) | `parseUpgradeAdvisorParams`, `lib/upgrade-advisor.ts:229` | Two roles: owned device vs catalog successor. `year`/`price` are the user's own inputs (purchase year, price paid), not catalog data. |
| T4 Own-It Guard (alt) | `?name=<text>&brand=<text>&gtin=<text>` | `parseOwnItCheckParams`, `lib/own-it-check.ts:281` | Non-catalog query: free-typed product not in the catalog. Max lengths enforced (`OWN_IT_MAX_NAME_LENGTH = 200`, brand 100); over-long name/brand or a GTIN with no digits returns an error, never a fabricated query. |
| T2 Persona Fit Finder | `?persona=<persona>&budget=<number>` | `parsePersonaFitParams`, `lib/persona-fit.ts:221` | No product param: persona + budget are the inputs; products are the ranked output. |
| T3 Price-Match Finder | `?status=<filter>` | `parsePriceMatchFilter`, `lib/price-match-policies.ts` | Filter only (`all` / `yes` / `no` / `limited` / `varies` / `not-recorded`); unknown values read as `all`. No product. |
| `/compare` | `?products=<uuid>,<uuid>[,...]` | `app/compare/page.tsx:366` | Up to 5 product **UUIDs** (internal `products.id`), deduped, comma-separated — not slugs. |
| Saved-calculation share URLs | `/tools/<tool>?<params>` (params sorted by key) | `buildCalculationShareUrl`, `lib/saved-calculations.ts:44` | 12 pure calculator tools only (`SAVED_CALCULATION_TOOLS`); none of the 10 new tools is in the list yet — extending it is Stage 3 (B-05), not Stage 1. |

Conventions shared by the existing parsers (Stage 1 must preserve them):
- Repeated params take the **first** value (`firstParam` helpers everywhere).
- Values are trimmed; an empty string reads as absent (T10: empty `device`/`accessory` → `null`).
- Absent params are **not an error**: the tool renders its empty / picker state
  (T10 tracks this explicitly as `hasQuery`).
- Invalid input returns a human-readable error on the page, never a guessed
  product (T1 year/price errors, T4 length/GTIN errors).

## 2. The canonical model

```ts
/** One product selection, in canonical form. Stage 1 names the real type. */
interface ToolProductSelection {
  /** The primary product, by catalog slug. Always a slug, never a UUID. */
  productSlug: string | null;
  /**
   * A second product, when the tool takes two (T10 device/accessory,
   * T1 current/successor, /compare's list). Null for single-product tools.
   * For /compare this is the list beyond the first (up to 4 more, 5 total).
   */
  secondSlugs: string[];
  /** Which role each slug plays, so translation is unambiguous. */
  roles: { primary: 'product' | 'device' | 'current' | 'successor' | 'accessory'; second?: string };
  /** Non-product params the tool already takes, carried through untouched. */
  passthrough: Record<string, string>;
}
```

Rules:
1. **Slugs are the canonical identity.** Catalog slugs (`products.slug`, unique)
   are stable, human-readable, and already what 5 of the 10 tools use.
   UUIDs are an internal identity and appear only in `/compare` — they are
   translated, never canonicalised.
2. **Roles travel with the slug.** A bare `?product=` loses the information
   that T10 needs ("which one is the device?") and T1 needs ("which one do
   I own?"). The parser records the role; the link builder re-emits the
   tool's own dialect.
3. **Unknown slugs are honest, never guessed.** A slug with no catalog row
   resolves to `null` with the tool's existing "not recorded / not found"
   state. The parser never redirects to a different product and never
   invents a slug.
4. **Non-product params are passthrough.** `?target=`, `?watts=`,
   `?persona=`, `?status=` and friends are the tool's own inputs; the
   shared parser carries them through translation unchanged and never
   interprets them.
5. **The free-text T4 dialect stays free-text.** `?name=&brand=&gtin=` is a
   query about a product the user owns that may not be in the catalog; it
   has no slug to canonicalise and must not be forced into one. It
   translates to canonical form as `productSlug: null` + passthrough
   `{ name, brand, gtin }`, and back out unchanged.

## 3. Translation table (the spec Stage 1 implements)

`parseToolParams(tool, searchParams)` returns the canonical model;
`buildToolUrl(tool, selection)` emits the tool's own dialect. One parser,
per-tool translation inside — no tool keeps a private copy of the table.

| From → To | Rule |
|---|---|
| `?product=<slug>` → canonical | `productSlug = <slug>`, `roles.primary = 'product'`, `secondSlugs = []`. |
| Canonical → `?product=<slug>` | Emit `product=<productSlug>`; drop second slugs (single-product tool). |
| T10 `?device=<a>&accessory=<b>` → canonical | `productSlug = <a>` (role `device`), `secondSlugs = [<b>]` (role `accessory`). Either may be absent independently. |
| Canonical → T10 | `device=<productSlug>` + `accessory=<secondSlugs[0]>`; omit whichever is null. If `roles.primary` is `accessory` (user picked the accessory first), swap so the device slot still gets the device. |
| T1 `?current=<a>&successor=<b>` → canonical | `productSlug = <a>` (role `current`), `secondSlugs = [<b>]` (role `successor`). `brand`/`category`/`year`/`price` → passthrough. |
| Canonical → T1 | `current=<productSlug>` + `successor=<secondSlugs[0]>`; passthrough preserved. If the canonical primary's role is `successor` (came from a successor link), emit it as `successor=` and leave `current=` empty — never swap ownership. |
| `/compare ?products=<uuid>,...` → canonical | Resolve each UUID to its slug via the cached product fetch (Stage 1's cached `getProducts` list variant); unresolvable UUIDs are dropped, not guessed. First slug → `productSlug`, rest → `secondSlugs` (max 4). |
| Canonical → `/compare` | Resolve slugs to UUIDs via the same cached fetch; emit `?products=<uuid>,...` (max 5). A slug with no UUID is dropped from the link; if none resolve, emit `/compare` with no param. |
| T4 `?name=&brand=&gtin=` → canonical | `productSlug = null`, passthrough `{ name, brand, gtin }`. |
| Canonical → T4 | If `productSlug` is set, emit `?product=<slug>`; else re-emit the passthrough `name`/`brand`/`gtin` unchanged. |
| T2 `?persona=&budget=`, T3 `?status=` | No product in either direction: canonical `productSlug = null`, everything passthrough. Cross-tool links *into* T2/T3 carry no product; links *out of* them carry nothing (they produce no selection). |

Cross-tool link builders (Stage 1, one per destination, all carrying the
selection): `compareLink`, `compatibilityLink`, `energyCostLink`,
`upgradeAdvisorLink`, `priceMatchLink`, `dealStackerLink`,
`negotiationCoachLink`, `ownItCheckLink`, `repairabilityLink`,
`refurbishedChecklistLink`, `personaFitLink`. Each is a thin wrapper over
`buildToolUrl` with the destination tool's dialect — no new param names.

## 4. What Stage 1 must NOT do

- **No new public param names.** `?product=`, `?device=`, `?accessory=`,
  `?current=`, `?successor=`, `?products=`, `?name=`/`?brand=`/`?gtin=`
  are the whole vocabulary. A new name needs a design note first.
- **No breaking old links.** Every URL a tool emits today must still parse
  to the same selection after Stage 1. Stage 1 adds translation; it does
  not rename any tool's dialect.
- **No slug guessing.** Unknown slug → honest empty state. Unknown UUID on
  `/compare` → dropped from the list. Never a redirect to a "closest" product.
- **No new storage.** Selection travels in the URL only (the existing
  mechanism). `localStorage` stays siloed per feature; `user_preferences`
  wiring is Stage 3 (B-06).
- **No fetch in the parser.** `parseToolParams` is pure string → model.
  UUID↔slug resolution is a separate, cached async step in the service
  (it delegates to the Stage 1 cached fetch, never to a direct Supabase
  call from a tool page).

## 5. Tests Stage 1 must add (from this note)

- Every dialect row in §3, both directions (parse → build round-trip).
- Role preservation: device/accessory and current/successor never swap.
- `/compare` UUID→slug and slug→UUID round-trip (mocked fetch); unknown
  UUID dropped; >5 products truncated to 5.
- Unknown slug → `null` + honest state (no redirect, no guess).
- Passthrough: `?target=`, `?watts=`, `?persona=`, `?status=` survive a
  translation untouched.
- Repeated params take the first value; empty values read as absent.

## 6. Sources (where each fact above was read)

- `lib/price-match-policies.ts` (T3 filter parser), `lib/compatibility-checker.ts:75`
  (`parseCompatibilityParams`), `lib/upgrade-advisor.ts:229`
  (`parseUpgradeAdvisorParams`), `lib/own-it-check.ts:252–281`
  (`parseOwnItCheckParams`, length caps), `lib/energy-cost.ts:75`,
  `lib/persona-fit.ts:221`, `app/compare/page.tsx:366` (`?products=` UUIDs,
  max 5, deduped), `app/tools/deal-stacker/page.tsx:89,165` and
  `app/tools/refurbished-checklist/page.tsx:73,79` (`?product=`),
  `lib/saved-calculations.ts:17,44` (share-URL pattern, 12 tools).
- Audit: `MASTER_INTEGRATION_AUDIT.md` §2 F2 (no shared state; ad-hoc URL
  params), §4.1 B-02 (canonical schema), B-05 (saved-URL extension).
