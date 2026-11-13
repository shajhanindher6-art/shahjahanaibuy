# AI Engine Architecture — SmartBuy AI (Section 19)

**Last updated:** 2026-11-13 (Section 19, Phase 9 — describes the finished built state)
**Status:** deterministic-only. No LLM provider is configured; see "Provider scope decision" below.
**Code:** `services/ai-engine/` (`types.ts`, `registry.ts`, `engine.ts`, `providers.ts`,
`usage.ts`, `retry.ts`, `health-report.ts`, `index.ts`), `lib/config/providers.ts`.

> Every claim in this document was verified by reading the code listed above on
> 13 Nov 2026. Where the code has a known limitation, this document says so instead
> of smoothing it over.

## What the engine is

Before Section 19 there was no engine: 14 deterministic AI services plus 2
live-provider modules were joined only by the `services/index.ts` barrel file and a
static config list in `lib/config/providers.ts`. A new provider meant touching every
caller. Section 19, Phase 1 (§12 #1) added a centralized engine that mirrors the
product-data `ProviderRegistry` pattern (`services/providers/registry.ts`):

- **`AIProvider` adapter interface** (`services/ai-engine/types.ts`) — `key`, `name`,
  `kind` (`'deterministic' | 'live'`), `capabilities`, `description`, `isAvailable()`,
  `availability()`, and an optional `invoke(capability, input)`. Adapters delegate to
  the service function that already exists; they do not reimplement it. Existing
  service APIs and the barrel file's public surface are unchanged.
- **`AIEngineRegistry`** (`services/ai-engine/registry.ts`) — `register` / `unregister` /
  `get` / `getAll` / `getAvailable` / `getByCapability` / `getAvailableByCapability`.
  Registration order is the fallback order for a capability. A re-registration
  overwrites with a warning, like `ProviderRegistry`.
- **`AIEngine`** (`services/ai-engine/engine.ts`) — `invoke(capability, input)` routes
  one call through the registered providers for that capability, in registration order,
  and `validate()` reports live provider-registry validation for the health endpoint.
- **Singleton:** `getAiEngine()` (`services/ai-engine/providers.ts`) builds the engine
  + registry once. `resetAiEngine()` is test-only.

## The 13 registered adapters

`createDefaultAiRegistry()` (`services/ai-engine/providers.ts`) registers 13 adapters
(counted from `registry.register(` calls on 13 Nov 2026 — not 12). Nine are
deterministic (always available, no external call); four are live (key-gated).

| # | Key | Kind | Capabilities | Delegates to |
|---|---|---|---|---|
| 1 | `ai-search` | deterministic | `search` | `services/ai-search.ts` |
| 2 | `ai-summary` | deterministic | `summarize` | `services/ai-summary.ts` |
| 3 | `ai-deals` | deterministic | `rank-deals` | `services/ai-deals.ts` |
| 4 | `ai-comparison` | deterministic | `compare` | `services/ai-comparison.ts` |
| 5 | `ai-predictions` | deterministic | `predict-price-drop` | `services/ai-predictions.ts` |
| 6 | `ai-recommendations` | deterministic | `recommend` | `services/ai-recommendations.ts` |
| 7 | `chat` | deterministic | `chat` | `services/chat.ts` |
| 8 | `personal-assistant` | deterministic | `assist`, `buy-wait` | `services/personal-assistant.ts` |
| 9 | `guided-finder` | deterministic | `guided-picks` | `services/guided-finder.ts` |
| 10 | `serpapi` | live (`SERPAPI_API_KEY`) | `web-search`, `visual-lens` | `services/external-search.ts`, `services/visual-search.ts` |
| 11 | `huggingface-clip` | live (`HF_API_TOKEN`) | `visual-embed` (first) | `services/visual-search.ts` (`embedTextClip`) |
| 12 | `huggingface-minilm` | live (`HF_API_TOKEN`) | `visual-embed` (second) | `services/visual-search.ts` (`embedText`) |
| 13 | `huggingface-caption` | live (`HF_API_TOKEN`) | `visual-caption` | `services/visual-search.ts` (`captionPublicImageUrl`) |

The three Hugging Face adapters have distinct registry keys but share
`usageKey: 'huggingface'`, so calls, latency, the circuit breaker and the
`provider_health` row aggregate per backend, not per adapter.

The 14 capabilities (`AICapability` in `types.ts`): `search`, `web-search`,
`visual-lens`, `visual-caption`, `visual-embed`, `summarize`, `rank-deals`,
`compare`, `predict-price-drop`, `recommend`, `chat`, `assist`, `buy-wait`,
`guided-picks`.

## Fallback chain + `fallbackUsed`

`AIEngine.invoke()` (`services/ai-engine/engine.ts`):

1. Candidates are the registered providers for the capability, in registration order.
   Providers that are unavailable (`isAvailable()` false) or whose in-memory circuit
   is open are skipped without being attempted.
2. Each remaining provider's `invoke()` is tried in order. A `ProviderSkippedError`
   declines without counting as a failure (e.g. CLIP asked to serve when no CLIP
   embeddings exist for the request — the engine falls through to MiniLM). Any other
   throw counts as a failure and the engine moves to the next provider.
3. On success the engine returns an `AIEngineResult` with `fallbackUsed` — true when
   the serving provider was **not** the first candidate tried, whether the earlier
   ones failed, declined, were unavailable, or were circuit-open — plus
   `attemptedProviders` (every provider tried, in order) and `latencyMs` (wall-clock
   of the serving call only). Callers surface it (e.g. `meta.fallbackUsed`) so the UI
   can say which path served the answer.
4. When no provider can serve, the engine throws `NoAiProviderAvailableError`.
   Callers with an honest degraded path (e.g. the ai-search web leg) catch it and
   fall back to the catalog.

Today only `visual-embed` has a real two-provider chain (HF CLIP → HF MiniLM). Every
other capability has one provider; the chain is the design for the next provider,
not a second implementation.

## Retry + circuit breaker

- **Retry** (`services/ai-engine/retry.ts`, §12 #6): `withAiRetry(fn, options)` retries
  only when the failure is retryable — an explicit `retryable: true` flag (the
  `HfResult` convention), HTTP 429/502/503/504, or a network/timeout failure.
  401/403/400 and validation errors are never retried. Defaults: 3 attempts total,
  exponential backoff with a 200 ms base (worst case ≈ 600 ms added). This honours
  the `retryable` flag the audit found no caller honouring (HF 503 previously forced
  the user to retry manually).
- **Circuit breaker** (`services/ai-engine/usage.ts`, §12 #6/#8): the in-memory circuit
  opens after **5 consecutive provider failures** with a **60 s cooldown**, then
  half-opens for one trial call. The threshold deliberately mirrors the durable
  circuit in `services/monitoring.ts` (circuit open at ≥ 5 consecutive failures).
  The engine consults `isAiCircuitOpen` **before** trying a provider, so a provider
  that is already down is not retried into at all.

## Usage, cost, quota and latency tracking

All in `services/ai-engine/usage.ts` (§12 #5, #7, #9, #13). **Storage limitation,
stated in the code header and repeated here: every counter is per-instance
in-memory state.** It resets on deploy / instance recycle and is not shared between
Vercel instances — the same limitation as the existing in-memory rate limits
(`lib/api/middleware.ts`) and the public-API quota fallback (`lib/api-quota.ts`).
Treat the in-memory numbers as a live guardrail, not an audited ledger. Durable
per-user AI usage needs an owner-applied migration for a usage table; **no such
migration is written** (the audit authorises migration files only for duplicate-deal
+ outcomes/032).

- **Per-user daily quota (§12 #13):** `AI_USER_DAILY_QUOTA = 300` calls/day per
  signed-in user across AI routes (one AI call every 2 minutes for 10 hours). The
  quota binds abuse (a scripted loop), not real use. `checkAiUserQuota(userId)`
  checks and increments in one call; over quota the caller answers 429 with
  `resetAt` (next UTC midnight). Anonymous users have no identity to budget, so they
  keep the per-IP per-minute limits as their floor.
- **Tightened anonymous caps (§12 #7):** the quota-spending routes were tightened
  12 Nov 2026 — ai-search 20 → **10/min**, visual-search 10 → **5/min**,
  scan 10 → **5/min** (per IP per minute). The audit found 20 distinct queries/min
  could exhaust a month of SerpAPI free quota in minutes; the caps are the first
  line of defence.
- **Global daily provider budgets (§12 #7):** `PROVIDER_DAILY_BUDGETS` —
  **SerpAPI 5 live calls/day/instance** (≈ 150/month, inside the free plan's
  ~100–250 searches/month band) and **Hugging Face 50 live calls/day/instance**
  (a burst guardrail; HF free inference is rate-limited rather than monthly-capped).
  Cache hits (24 h memory / 7 d DB for SerpAPI) spend nothing and do not count.
  `spendProviderBudget()` returns false when the budget is exhausted and spends
  nothing — callers must then serve the deterministic/catalog fallback with an
  honest "web results unavailable today" label, never call the provider anyway.
- **Latency tracking (§12 #9):** every engine attempt records per-capability latency
  (`recordAiCapabilityCall`); per-provider usage/latency is recorded by the services
  themselves at the actual HTTP call (`recordAiCall` in `external-search.ts` /
  `visual-search.ts`) so engine-routed calls **and** direct callers (admin backfill,
  digest, alternative recommender) are covered without double-counting. The engine
  itself records no per-provider usage.
- **Admin summary:** `getAiUsageSummary()` returns per-provider calls/success/failure/
  avg latency/consecutive failures/circuit state/last-called-at, per-capability
  totals, and the budget states, with the in-memory limitation note attached. It is
  read by the `/admin/ai` page (`app/api/v1/admin/ai/route.ts`).

## `recordProviderHealth` wiring

`recordProviderHealth` (`services/monitoring.ts`) had **zero** live callers, so
`provider_health` was never written. Section 19, Phase 1 (§12 #8) added
`reportAiProviderHealth()` (`services/ai-engine/health-report.ts`): a best-effort
wrapper that never throws and never blocks a response — a missing table, an RLS
denial, or a null client degrades to a `logger.debug`, never an error page.
**Known limitation: the writes are best-effort and may silently fail on anonymous
clients** (no authenticated Supabase client in scope → the call is skipped or the
write fails into the debug log). In-memory usage/latency (`recordAiCall`) needs no
client at all and is unaffected.

Wired call sites (verified by grep, 13 Nov 2026): `services/external-search.ts`
(SerpAPI — it has the client), `app/api/v1/visual-search/route.ts` (HF — the
service has no client in scope, so the route reports from the engine result), and
`lib/workers/processors.ts` (refresh worker). The engine itself writes no durable
health rows, by design (see the `engine.ts` header comment).

## `maxDuration` policy

`maxDuration` (§12 #10) is set to **60 seconds** on the AI routes that do expensive
inline work — verified by grep, 13 Nov 2026:

- `app/api/v1/ai-search/route.ts`, `app/api/v1/visual-search/route.ts`,
  `app/api/v1/scan/route.ts`, `app/api/v1/chat/messages/route.ts`,
  `app/api/v1/forecast/[productId]/route.ts`, `app/api/v1/recommendations/route.ts`,
  `app/api/v1/predictions/[productId]/route.ts`,
  `app/api/v1/predictions/accuracy/route.ts`,
  `app/api/v1/predictions/outcomes/route.ts` — all `export const maxDuration = 60`.

60 s is the platform ceiling the expensive inline AI work runs under; the bulk
catalog re-embedding case that cannot fit in one invocation is documented, not
built — see `docs/ai-background-jobs.md` §6.

## Provider scope decision (deterministic-only)

Phase 0 (§12 #2) **removed the misleading OpenAI `enabled` flag**:
`lib/config/providers.ts` used to set `enabled: Boolean(process.env.OPENAI_API_KEY)`,
but no OpenAI client exists anywhere in the repo — setting the key changed nothing
while the registry claimed an AI provider was active. The flag is now always
`enabled: false` with a comment stating the deterministic-only scope, and the
description reads: "No LLM provider configured — deterministic-only scope; setting
OPENAI_API_KEY enables nothing until a real client is wired (owner decision)".

Consequences, all verified by grep on 13 Nov 2026:

- Every AI answer in this codebase is a deterministic template over recorded data —
  never presented as LLM reasoning. There is no fake LLM client and no fake "model
  version" label anywhere.
- The only `openai` string outside `lib/config/` is a Hugging Face **model name**
  (`openai/clip-vit-base-patch32` in `services/visual-search.ts`), never a client.
- `AIEngine.validate()` reports live providers as `'available-unverified'` on key
  presence **only** — no network probe is ever made, so validation burns zero
  SerpAPI/HF quota. A present key is not proof the provider works; the label says so.
- Adding a real LLM provider (OpenAI / Anthropic / Gemini) is **owner-gated**: it
  needs the owner's provider decision + key (Section 19 audit §1 #5, owner-gated
  item 1). Until then the engine's `kind: 'live'` providers are exactly the two
  that already existed — SerpAPI and Hugging Face Inference.

## What the engine does not do (honest limits)

- **No shared/distributed cache.** The app cache is per-instance in-memory
  (`lib/cache/index.ts`); other Vercel instances can serve stale data up to 5 min
  (1 h for review summaries). Shared cache needs Upstash Redis provisioning
  (owner-gated). Cache *invalidation* for AI keys was fixed in code (§12 #14):
  `invalidateProductCaches` now also clears `ai-summary:<productId>`,
  `prediction:<productId>` and `comparison:<sorted ids>` keys (ai-search and
  deals-ranked stay TTL-bounded by design).
- **No background worker for AI analysis.** All AI analysis is inline in the request
  under the 60 s `maxDuration`. The queue decision is documented in
  `docs/ai-background-jobs.md`: the existing in-process/cron pattern (Vercel-native)
  is kept; BullMQ is not installed and bulk re-embedding genuinely needs Upstash
  Redis + BullMQ (owner-gated).
- **No token tracking.** Token/cost optimisation is not applicable — no LLM exists.
  Cost tracking here means call counts and the daily provider budgets above.
- **In-memory counters are not a ledger** (see "Usage" above). If the owner later
  applies a usage-table migration, `usage.ts` is the module to swap the store in.

## Tests

31 Section 19 test files exist (`tests/section19-*.test.ts(x)`); the engine-specific
ones are `tests/section19-ai-engine.test.ts` and
`tests/section19-provider-registry.test.ts`, plus error-handling and data-accuracy
suites (`tests/section19-ai-error-handling.test.ts`,
`tests/section19-ai-data-accuracy.test.ts`). `docs/section-19-summary.md` for the gate numbers (286 files / 3,425 tests).
