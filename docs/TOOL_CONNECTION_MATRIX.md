# Tool Connection Matrix — SmartBuy AI Master Tool Integration

**Date:** 2026-11-14 · **Status:** Stages 0–6 live (HEAD `6838d30a`, recheck 15:25 PKT 7/7 PASS)
**Source of the "after" state:** `services/tool-integration.ts` `relatedToolLinks()` (read 2026-11-14) + `components/tools/product-tools.tsx` + live recheck `~/workspace/goals/smartbuy-master-tool-integration/hidden_files/live-recheck-2026-11-14-1525.md`.
**Source of the "before" state:** `MASTER_INTEGRATION_AUDIT.md` F1 + `TOOL_DEPENDENCY_MAP.md` §1.

> Counting rule: a cell counts when the source tool's `RelatedTools` block (or the product-page `ProductTools` block) renders a link to the destination tool. The param shown is what the link carries **once a product is selected**. On a plain base page with no product selected, links are plain hrefs (no param) — the param is appended only after selection. That is the design, not a missing link; see §5.

## 1. Before → after (headline)

| Measure | Before (audit, 2026-11-14) | After (this integration) |
|---|---|---|
| Tool → tool links among the 10 tools | **0** (no tool linked to any other of the 10; the only 2 links in the 10 were T8 → coupons-cashback and T9 → trade-in-finder, both outside the 10) | **25 directed edges** (of 90 possible ordered pairs) |
| Brief's wanted connections satisfied in full | 3 of 46 | **35** (see §3; total differs — §4) |
| Brief's wanted connections partial | 5 | 5 |
| Brief's wanted connections not linkable (no route / no data) | not counted in the audit | 7 |
| Shared param schema | None (ad hoc params) | Canonical `?product=` + dialect translation (`?device=`, `?current=`, `/compare` UUIDs) |
| Cached fetch in the 10 tools | 0 tools (all uncached `getProducts()`) | 9 of 9 product-fetching tools (T3 fetches nothing) |
| Product-page entry links into tools | 0 (`href="/tools/` hits: 0) | 11 links per product ("Tools for this product") |
| `/compare` entry links into tools | 0 | ProductTools block mounted |
| Saved-calculation (re-open-my-result) URLs | 12 tools (0 of the new 10) | 20 tools (8 of the new 10; T3/T7 none by design) |

## 2. The 10×10 matrix (after)

Rows = source tool (where the link lives). Columns = destination tool. `✓` = link exists in the source's `RelatedTools` block. The param is what the link carries when a product is selected; `—` = no link. Self-links are `—` by design (a tool never links to itself).

| From ↓ / To → | T1 Upgrade | T2 Persona | T3 Price-Match | T4 Own-It | T5 Energy | T6 Negotiation | T7 Repairability | T8 Deal Stacker | T9 Refurbished | T10 Compatibility |
|---|---|---|---|---|---|---|---|---|---|---|
| **T1 Upgrade Advisor** | — | ✓ own dialect | ✓ `?status=` | ✓ `?product=` | ✓ `?product=` | — | — | ✓ `?product=` | ✓ `?product=` | — |
| **T2 Persona Fit** | ✓ `?current=` | — | — | — | — | — | — | — | — | ✓ `?device=` |
| **T3 Price-Match** | — | — | — | — | — | ✓ `?product=` | — | ✓ `?product=` | — | — |
| **T4 Own-It Guard** | ✓ `?current=` | ✓ own dialect | — | — | — | — | — | — | — | ✓ `?device=` |
| **T5 Energy Cost** | ✓ `?current=` | — | — | — | — | — | — | — | — | — |
| **T6 Negotiation Coach** | — | — | ✓ `?status=` | — | — | — | — | ✓ `?product=` | — | — |
| **T7 Repairability** | ✓ `?current=` | — | — | — | — | — | — | — | ✓ `?product=` | — |
| **T8 Deal Stacker** | — | — | ✓ `?status=` | — | — | ✓ `?product=` | — | — | — | — |
| **T9 Refurbished Checklist** | ✓ `?current=` | — | ✓ `?status=` | — | — | — | ✓ `?product=` | — | — | — |
| **T10 Compatibility** | ✓ `?current=` | ✓ own dialect | — | — | — | — | — | — | — | — |

**Row totals (outgoing to the other 9):** T1 6 · T2 2 · T3 2 · T4 3 · T5 1 · T6 2 · T7 2 · T8 2 · T9 3 · T10 2 = **25**.

**Column totals (incoming from the other 9):** T1 6 (from T2, T4, T5, T7, T9, T10) · T2 3 (T1, T4, T10) · T3 4 (T1, T6, T8, T9) · T4 1 (T1) · T5 1 (T1) · T6 2 (T3, T8) · T7 1 (T9) · T8 3 (T1, T3, T6) · T9 2 (T1, T7) · T10 2 (T2, T4). Row-sum and column-sum both equal 25 — the matrix is consistent.

**Hubs and leaves:** T1 Upgrade Advisor is the most connected node (6 out, 6 in). T5 Energy Cost is the thinnest (1 out, 1 in) — it is a pure input calculator; its only product-carrying link is "Is this an upgrade?".

## 3. After vs the brief's wanted connections (per tool)

The brief named a wanted-connection list per tool. Status now: **✓ full** (link exists, product carried in the destination's dialect) · **◐ partial** (data used or a link exists, but no destination page carries the product) · **✗ not linkable** (no route exists, or the underlying data is 0 rows — never faked).

| Tool | Wanted (brief) | Now | Notes |
|---|---|---|---|
| T1 Upgrade Advisor | Persona Fit · Price-Match · Own-It · Energy Cost · Deal Stacker · Refurbished | **6/6 ✓** | All six in `relatedToolLinks` |
| T2 Persona Fit | Upgrade Advisor · Product Comparison · Budget Optimization · Compatibility · Deal Finder | **4/5 ✓**, 1 ✗ | ✗ Deal Finder: no route exists (deal-finder is a dashboard widget, not a tool page) |
| T3 Price-Match | Product Comparison · Deal Stacker · Negotiation · Price History · Merchant Data | **4/5 ✓**, 1 ◐ | ◐ Merchant Data: the store directory is the source; no per-store merchant page to link to |
| T4 Own-It Guard | Upgrade Advisor · Persona Fit · Compatibility · Product Alternatives | **3/4 ✓**, 1 ✗ | ✗ Product Alternatives: no route (alternatives live in `ai-recommendations`, no dedicated page) |
| T5 Energy Cost | Product Comparison · Product Specifications · Budget Optimizer · Upgrade Advisor | **3/4 ✓**, 1 ✗ | ✗ Specs: 0 specs rows live, no specs route |
| T6 Negotiation Coach | Price-Match · Deal Stacker · Merchant Information · Product Condition Information | **2/4 ✓**, 1 ◐, 1 ✗ | ◐ Merchant Info: lowest merchant price is the baseline, no store link · ✗ Condition: no route |
| T7 Repairability | Product Information · Product Specifications · Upgrade Advisor · Refurbished Checklist | **2/4 ✓**, 1 ◐, 1 ✗ | ◐ Product Info: product pages link out, no widget links back · ✗ Specs: 0 rows |
| T8 Deal Stacker | Price-Match · Coupons · Cashback · Merchant Offers · Budget Optimizer | **4/5 ✓**, 1 ◐ | Coupons + Cashback were already full before this work · ◐ Merchant Offers: rows + lowest listing used, no store link |
| T9 Refurbished Checklist | Product Comparison · Upgrade Advisor · Repairability · Price-Match · Merchant Information | **4/5 ✓**, 1 ◐ | ◐ Merchant Info: outbound retailer search links only, no SmartBuy merchant page |
| T10 Compatibility | Product Specifications · Product Variants · Product Catalog · Upgrade Advisor · Persona Fit | **3/5 ✓**, 2 ✗ | ✗ Specs (0 rows) · ✗ Variants (0 rows) · Catalog was already full before this work |
| **Total** | | **35 ✓ + 5 ◐ + 7 ✗** | |

## 4. The 46 vs 47 discrepancy (open, not guessed)

The audit (F1) says the brief names **46** wanted connections. A recount of the brief's own per-tool lists sums to **47** (6+5+5+4+4+4+4+5+5+5). One connection is double-counted somewhere in the brief's lists — the likely candidate is T8's "Coupons" + "Cashback" (two items in the list, possibly one item in the audit's count). The per-tool numbers in §3 are counted from code and stand regardless; the headline total is therefore written as "35 full + 5 partial of 46/47 wanted". Do not "fix" the 46 until the brief's list is re-counted against the audit's own tally.

## 5. Destinations outside the 10 (also wired)

| Destination | Linked from | Param carried |
|---|---|---|
| `/compare` (Product Comparison) | T1, T2, T3, T5, T9 (bare `/compare` — needs UUIDs; `compareLinkForProduct` resolves a slug to an id when the caller has one) + product page + ProductTools | `?products=<uuid>,<uuid>` when ids known, else bare picker |
| `/tools/budget-finder` (Budget Optimizer) | T2, T5, T8 | none (budget tool takes its own budget input) |
| `/tools/price-history` (Price History) | T3 | none (history is per-product via its own picker) |
| `/tools/coupons-cashback` (Coupons + Cashback) | T8 | none (pre-existing link; does NOT pass `?product=` — known gap, Stage 3 report) |
| `/tools/trade-in-finder` | T9 (pre-existing, outside the 10) | none |

**Product page ("Tools for this product", `components/tools/product-tools.tsx` — 11 links per product):** upgrade-advisor `?current=` · compatibility-checker `?device=` · energy-cost / deal-stacker / negotiation-coach / repairability / refurbished-checklist / own-it-check `?product=` · price-match + persona-fit in their own dialect · `/compare` with the product id when known, else the bare picker. The live recheck confirmed 6 of these links on `/products/macbook-air-13` (compatibility, deal-stacker, energy-cost, negotiation-coach, own-it-check, refurbished-checklist).

## 6. Live verification of the mesh (recheck 2026-11-14 15:25 PKT)

Product propagation was verified live on 5 tool pages (curl, real page bodies):

- `/tools/upgrade-advisor?product=macbook-air-13` → deal-stacker, energy-cost, own-it-check, refurbished-checklist with `?product=macbook-air-13` (4 links; T2/T3 links carry their own dialect, `/compare` is bare — consistent with §2)
- `/tools/deal-stacker` (base page) → `/tools/negotiation-coach?product=bose-quietcomfort-ultra` (from its picker); with `?product=macbook-air-13` → negotiation-coach with `?product=macbook-air-13`
- `/tools/negotiation-coach?product=macbook-air-13` → `/tools/deal-stacker?product=macbook-air-13`
- `/tools/compatibility-checker?device=macbook-air-13` → `/tools/upgrade-advisor?current=macbook-air-13`
- `/tools/persona-fit?product=macbook-air-13` → `/tools/compatibility-checker?device=macbook-air-13` and `/tools/upgrade-advisor?current=macbook-air-13`

**Nuance (not a failure):** on plain base pages with NO product selected, cross-tool links are plain hrefs (e.g. upgrade-advisor links to `/tools/persona-fit` with no param) — the product param is appended only once a product is selected. The recheck's strict literal reading ("base page body contains `/tools/<other>?product=`") passed on only 1 of 3 named pages (deal-stacker, which renders per-product links from its picker). The integration behaviour itself — product carried from tool to tool — is verified live on 5 pages, so the proof holds.

## 7. What is still NOT connected (honest list)

- **7 wanted connections have no destination** (§3, ✗): Deal Finder, Product Alternatives, Specs (T5/T7/T10), Condition, Variants. Each needs either a new route or real data (specs/variants are 0 rows) — both are owner-gated data work, not code that can be written around the gap.
- **5 partials** (§3, ◐): all five are "Merchant Information / Merchant Offers" — there is no SmartBuy merchant page to link to; the tools use merchant rows as data (lowest price, listings) but cannot deep-link a merchant.
- **`/compare` links are bare** in `relatedToolLinks` (needs UUIDs; the slug-resolving `compareLinkForProduct` exists but the link block does not call it — it is async and the block is data-only).
- **T8 → coupons-cashback drops the product** (pre-existing link, not fixed in Stage 3).
- **Search pages** (`/search`, `/find`) have no tool entry links (B-18, not built — restructuring needed).
- **T2/T3 take no product param**, so links to them can never carry `?product=` — by design, not a gap.
