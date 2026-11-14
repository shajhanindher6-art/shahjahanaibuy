# Recommender — canonical path (Master Tool Integration, S2-7)

**Decision (2026-11-14): the canonical general-purpose recommender is
`services/personal-assistant.ts`.** It is wired to the most live surfaces:

| Module | Live surfaces (call sites) |
|---|---|
| `services/personal-assistant.ts` — **CANONICAL** | Deal Finder widget (`POST /api/v1/deal-finder` via `services/chat.ts`), dashboard chat (`POST /api/v1/chat/messages` via `services/chat.ts`), guided quiz + budget finder (`enrichProducts` via `services/guided-finder.ts`), AI-engine provider routing (`recommendAssistant` / `buyWaitAssistant` via `services/ai-engine/providers.ts`) |
| `services/ai-recommendations.ts` — specialized | Personalized history/wishlist/views feed: `GET /api/v1/recommendations`, smart-deals (`services/smart-deals.ts`), AI-engine provider routing |
| `services/alternative-recommender.ts` — specialized | Vector-similarity surfaces: budget alternatives (`/api/v1/products/[slug]/budget-alternative`), shopping digest (`/api/v1/dashboard/digest`) |

## Why this one

`personal-assistant.ts` is the only one of the three consumed by other
tools' engines (guided-finder's candidate enrichment) as well as by
user-facing chat surfaces, and its `recommendAssistant` /
`buyWaitAssistant` are the functions the AI-engine provider layer routes
recommendation requests to. It is the general "recommend something for
this query" path; the other two answer narrower questions.

## Why the other two are not delegated or marked legacy

Delegation is not safe — each does a job the canonical one does not:

- `ai-recommendations.ts` (`getRecommendations`) seeds from a user's own
  search history, wishlist, product views, preferences and dismissals
  (with a personalization opt-out path). Routing it through the
  assistant would change what `/api/v1/recommendations` returns.
- `alternative-recommender.ts` matches by cosine similarity against
  product embeddings with documented bars (≥ 0.95 for a "95%+ match"
  claim, ≥ 0.80 "similar" for digest picks) and a budget filter. Routing
  it through the assistant would change what the budget-alternative and
  digest routes return.

Both stay live as specialized recommenders. No fourth recommender may be
added; a new recommendation need must extend one of these three, with the
choice recorded here.

## Related decision — merchant reliability (S2-7)

The same "one canonical, named supporting dimensions" pattern already
exists for merchant reliability in
`services/canonical-merchant-reliability.ts`: the POLICY scorer
(`services/merchant-reliability.ts`) is canonical for the "merchant
reliability" label (compare page, admin provider-health panel, admin
data-quality dashboard), while the SYNC scorer
(`services/merchant-reliability-score.ts`) is a supporting dimension used
only by deal ranking (`services/ai-deals.ts`, −10 on scored `low`). No
third scorer; no surface calls the wrong one.
