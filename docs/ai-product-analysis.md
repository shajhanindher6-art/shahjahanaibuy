# AI Product Analysis — SmartBuy AI (Section 19)

**Last updated:** 2026-11-13 (Section 19, Phase 9 — describes the finished built state)
**Code:** `services/ai-summary.ts`, `services/ai-deals.ts`, `services/ai-comparison.ts`,
`services/review-summary.ts`, `components/ai/transparency-block.tsx`,
`lib/ai-source-label.ts`, `services/merchant-reliability.ts`,
`services/comparison-suitability.ts`.

> Live data reality, verified 13 Nov 2026: the catalogue has **10 products**,
> **0 reviews**, **0 spec rows**, **4 recorded price points per product** (Amazon
> only), prices last recorded **2 November 2026** (stale). Every analysis below is
> built to say that out loud rather than fill the gap. Nothing in this document
> invents a review, a spec, or a price.

## AI summary (`services/ai-summary.ts`)

The summary is a deterministic template over recorded rows (product, reviews,
attributes, variants, price history). It is cached in `product_metadata`
(7-day expiry) and served through the `ai-summary` engine adapter.

### Honest fallbacks (Phase 0, §12 #15)

The audit found three invented claims with zero evidence. All three are replaced:

| Before (invented) | Now (honest) |
|---|---|
| Pros: "from a reputable brand" when no brand was recorded | A missing brand is simply omitted — never filled in with a reputation claim |
| Pros: "Product meets quality standards" when nothing at all was known | When there are no reviews, no specs and no price signal, the pro is: "Not enough data to assess quality — no reviews or specifications recorded for this product" |
| Cons: "No significant drawbacks identified from available data" even when the available data was literally nothing | The cons say what was actually checked and name the gap when no reviews exist |

Pros are only ever added from evidence: rating ≥ 4 ("High customer satisfaction
(X stars)"), ≥ 50 reviews, a recorded brand ("From established brand: X"), recorded
attributes (up to 5), or a near-low price signal (see the freshness gate below).
The near-low / near-high thresholds were also fixed so a price can no longer be
both "near its lowest" and "near its historical high" at once (the old thresholds
overlapped on narrow ranges, e.g. $999–$1,048).

### Freshness stamp + freshness gate (Phase 2, §12 #16, #20)

- **Freshness stamp:** every returned summary carries `priceAsOf` (the product's
  real `dataFreshness`, never fabricated) and `freshnessNote`
  (`formatVerdictFreshnessNote`). The stamp is attached at **read** time, so a
  cached row generated a week ago is stamped with the product's actual last-check
  date and its stored verdict text is qualified with the staleness.
- **Freshness gate on interpretive verdicts:** "good time to buy" / "near its
  historical high" reason about the *current* price. On a stale (or age-unknown)
  price the verdict is rewritten in the past tense and qualified with the
  staleness ("The current price was near its historical low at the last recorded
  check. …") instead of being stated as if it were current. A visitor must never
  see "Stale price · 10 days old" in one place and an unqualified "good time to
  buy" in another. The same gate applies to the near-low pro, which carries its
  staleness with it ("price last checked N days ago — may be out of date", or
  "price age unknown — may be out of date").
- **Unknown freshness fails closed (§12 #21):** `isPriceStale` no longer returns
  false for unknown freshness; the UI renders an "age unknown" text instead of
  rendering nothing.

## AI deals (`services/ai-deals.ts`)

`getRankedDeals` ranks deals over the `deals` table. Three honesty fixes landed
in Section 19:

### Derived-%-or-null (Phase 0, §12 #24)

A fixed-amount deal used to get a fabricated percentage:
`discountPercentage = (discountValue/100)*10` — a $20-off deal showed a made-up
"2%", and the invented number fed `aiScore` and the featured flag. Now the
percentage is **derived from a real price / compare-at price, or `null`**. Callers
treat `null` as a 0 contribution to `aiScore`, never as a made-up number, and a
null price renders as "price not listed", never a guess.

### Validation + featured gate (Phase 2, §12 #23, #60)

- `scoreDeal` now takes the deal's validation result: `isFeatured` requires
  `aiScore >= 75` **and** `validation.status === 'validated'`. A high score on
  thin or pattern-flagged history is ranked, never featured — no featured flag
  without price evidence.
- The suspicious-claim detectors the audit found disconnected are now wired into
  ranking: `checkDeal` (claimed discount vs 90-day lowest), `detectFakeSale` and
  `checkPriceInflation` feed the validation that gates featuring.
- Stored `deal_rankings` rows are never trusted: `ai_score` / `is_featured` are
  re-scored and re-gated here on every read.

### Value ranking + dedupe (Phase 2, §12 #59, #66)

- The score gained an actual-value term: when a current price and a recorded
  lowest price exist, the gap contributes to `aiScore`, so ranking is no longer
  purely a function of the *claimed* discount.
- `getRankedDeals` dedupes by deal identity (`dedupeByKey`): two identical active
  deals can no longer rank as two separate rows. The same dedupe runs on the
  cached-rows read path.

## AI comparison (`services/ai-comparison.ts`)

`compareProducts` is grounded in real rows — price, rating, availability, history.
No specs are ever invented; with 0 spec rows the comparison says "no specs
recorded". Section 19, Phase 5 (§12 #49–#51, #55, #57) closed the gaps the audit
found:

### Warranty / shipping / seller (code paths, data owner-gated)

- **Warranty:** per-merchant warranty is read from recorded merchant policy data
  (`formatWarranty(policy.warrantyMonths)`); a merchant with no recorded policy
  gets a **null warranty** and the UI renders an honest empty state. There is no
  per-merchant warranty source in the catalogue today — the code path exists, the
  data does not (owner-gated: a verified warranty source).
- **Shipping:** from the recorded `merchant_products.shipping_cost` /
  `shipping_days` — null → honest empty state, never a guessed cost. "Free
  shipping" is the recorded $0 cost, not an assumption.
- **Seller:** no separate marketplace seller name is recorded in the schema, so
  the merchant name is the seller — not an invention.
- **Merchant reliability:** `services/merchant-reliability.ts` scores from recorded
  data only (website + active status); a merchant with too little recorded data
  gets a not-enough-data reliability, never a made-up score. Per-merchant reliability
  *data* (delivery performance, dispute rates) does not exist yet — owner-gated.

### Suitability prose + source labelling

- **Suitability explanations** (`services/comparison-suitability.ts`, §12 #51):
  per-requirement prose is now generated from the recorded comparison data instead
  of the old generic template + price-only badge.
- **Source labelling** (`lib/ai-source-label.ts`, §12 #55): assistant/comparison
  outputs now label their source — verified recorded data vs general knowledge —
  with `verifiedDataRangeLabel`. Product Q&A was already the only surface that
  labelled its answers; the label is now shared.
- **Best choice:** the "Best choice" badge's weights are disclosed (the old opaque
  weighted score is no longer presented without its reasoning), and "Best Value for
  Money" is relabelled honestly — it means lowest price, not quality per dollar
  (§12 #17, #48).

## Review summary (`services/review-summary.ts`)

`getReviewAISummary` builds a plain-language summary from real reviews only:
themes are detected by keyword matching over review titles + content, split by
sentiment (rating ≥ 4 positive, ≤ 2 negative, 3-star neutral and ignored). It is
deliberately transparent and deterministic — no review text is sent to any third
party, and a theme can only be mentioned when at least one real review mentions it.

**0 reviews → null.** The function returns `null` when a product has no reviews, so
callers hide the summary card and show the existing "No reviews yet" empty state.
With 0 reviews live, the review summary is an engine with nothing to summarise —
blocked by **data**, not by code. Seeding fake reviews to fill it is rejected
(Section 19 audit, rejected item 19). Results are cached in memory (SWR, 10 minutes
fresh / 1 hour stale).

## Transparency block

`components/ai/transparency-block.tsx` (§12 #70) is the shared block the audit found
missing: data used, last-updated timestamp, confidence, assumptions, and missing
info — as plain strings only, no invented numbers. It is rendered on the AI
surfaces that used to hide their inputs (ai-summary, ai-deals, comparison,
recommendations). The predictions / buy-vs-wait / forecast-explainer surfaces were
already exemplary and were preserved, not rebuilt.

**Known limitation (honest, not hidden):** a caller with no timestamp passes
`dataTimestamp: null` and the block renders **"Not recorded."** for the timestamp.
The recommendations and comparison TransparencyBlocks currently show "Not recorded"
for the timestamp because **no `generatedAt` exists in those API responses yet**
(verified by grep, 13 Nov 2026: zero `generatedAt` hits in
`app/api/v1/recommendations/route.ts`, `app/api/v1/comparison/route.ts`,
`services/ai-recommendations.ts`, `services/ai-comparison.ts`). Adding it is a
follow-up, not a Section 19 item.

## What is still data-blocked (not a code gap)

- **Review-based analysis** — 0 reviews. The engine exists; the data does not.
- **Spec-based comparison / quality analysis** — 0 spec rows. Comparison says "no
  specs recorded".
- **Per-merchant warranty / reliability / shipping data** — code paths exist (above);
  no verified source exists yet. Owner-gated.
- **Verified coupon liveness** — coupon validity is expiry date only; a code could
  be dead at the merchant and still show "valid". Merchant feeds are owner-gated.
