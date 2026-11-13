# AI Background Jobs — design & implementation (Section 19, Phase 8, §12 #12)

**Date:** 12 November 2026 | **Status:** implemented (Vercel-native, no new infra)

## Decision (binding, from the coordinator)

Background jobs use the **existing in-process/cron pattern** (Vercel-native, no new infra).
**Do NOT provision Upstash/BullMQ** — that is owner-gated. If inline processing is genuinely
insufficient for a specific analysis, this doc says why and what the owner must provision —
no queue was silently added.

## 1. Which analyses are expensive enough to run async?

| Analysis | Cost per run | Verdict |
|---|---|---|
| **Visual analysis** (BLIP caption + HF embedding + catalog vector match) | Up to 2 HF Inference calls (30s timeout each) + image fetch + 2 catalog RPCs; spends HF quota | **ASYNC — implemented as `ai.analyze`** |
| AI summary / deals ranking / price prediction / comparison / recommendations | Deterministic computation over already-recorded DB rows, in-memory, milliseconds; no provider call | Inline — a job would add latency and failure modes for nothing |
| SerpAPI web search / Lens | One HTTP call, already cached 24h (memory) / 7d (DB); budget-gated | Inline — the cache, not a job, is the quota control |
| AI search (catalog) | DB reads + in-memory scoring, cached 30s/120s | Inline |
| Price refresh (6h cron) | Already a cron-triggered route with step waves; the refresh itself is the background job | Inline in the cron route (unchanged) |

The choice of visual analysis is evidence-based, not preference: it is the only AI work
whose worst case (two 30s HF timeouts back-to-back, plus retries) can approach the 60s
Vercel Hobby serverless cap that `maxDuration` enforces on the AI routes. Everything else
is bounded milliseconds over local data.

## 2. How jobs are triggered

Two triggers, both reusing existing patterns — **no new scheduler was created**:

1. **On-demand (implemented):** `POST /api/v1/admin/ai/jobs` (admin-only via `requireAdmin`,
   10/min per IP). Body: `{ imageUrl?, caption?, limit?, preferClip? }`. It enqueues via
   `enqueueAiVisualAnalysis()` in `services/ai-background-jobs.ts` and reports the real
   outcome (see §4). This mirrors `POST /api/v1/data/refresh`, the existing
   enqueue-from-a-route pattern.
2. **Cron (NOT wired — deliberate):** the single cron-job.org 6h price-refresh job could
   enqueue `ai.analyze` for products whose price changed, so their visual matches stay
   warm. This is **not wired**: every enqueued analysis spends HF budget (50 live
   calls/day/instance), so bulk-enqueueing on refresh would burn the daily budget on
   products nobody scanned. Wiring it needs an owner decision on the HF budget, not code.

No second scheduler exists. The `startScheduledJobs()` minute-sweeper in
`lib/workers/queue.ts` was not extended, and no new cron expression was added anywhere.

## 3. How progress / results are stored

**No new table, no new migration.** The outcome is returned in `JobResult.metadata` and
read back via `getJobResult(jobId)` — the queue's existing last-100-results store
(per-instance, in-memory, like the DLQ). The metadata carries:

```json
{
  "caption": "a red laptop on a desk",
  "mode": "vector-clip",
  "fallbackUsed": false,
  "captionCached": false,
  "embedCached": false,
  "matches": [{ "productId": "…", "slug": "…", "name": "…", "brand": "…", "similarity": 0.91 }]
}
```

Two honest limitations, stated not hidden:

- **Results do not survive a deploy or instance recycle** (in-memory, last 100). A durable
  results table needs an owner-applied migration; none was written in this phase because
  the audit authorises migration files only for duplicate-deal + outcomes/032.
- **Prices are not stored in the job result.** The job returns the match list; the live
  route loads the lowest recorded price at request time, so a stored result can never go
  stale on price.

As a side effect, the caption + embedding land in the §12 #11 visual-search cache
(24h), so the next **live** visual-search request for the same image is a cache hit and
spends no HF budget — the job warms the cache for real users.

## 4. Synchronous today, async when the owner provisions Redis

This is the point most likely to be misread, so it is stated plainly:

- **Today (no `REDIS_URL`, BullMQ not installed):** the queue is the `SynchronousQueue`.
  `enqueueJob()` **awaits** the processor inline, inside the requesting function, under
  that function's `maxDuration` (60s on the admin route). What the job buys today is
  retries with exponential backoff, idempotency dedupe, DLQ on exhaustion, queue
  metrics, and a result record — **not** a separate worker process and **not** freedom
  from the 60s cap. The route therefore reports the real outcome (200 `completed` /
  `failed`) instead of a dishonest 202 `queued`; 202 is returned only when the work
  genuinely has not run yet (BullMQ mode).
- **When the owner provisions Upstash Redis (free tier) + `REDIS_URL` + `npm i bullmq`:**
  the SAME `enqueueJob()` call hands the job to BullMQ, the route returns an honest 202
  `queued`, and a worker runs it outside the request. No code change is needed — the
  queue factory already selects BullMQ when Redis is available (and falls back to
  synchronous when the `bullmq` package is missing). Owner-gated: provisioning,
  `REDIS_URL` in Vercel env, and the install.

## 5. Failure / retry behaviour

Honours the existing `retryable` flag (§12 #6, §1 #55). The queue only retries a job when
the processor **throws**, so the processor maps the flag onto throw-vs-return:

| Failure | `retryable` | Processor does | Queue does |
|---|---|---|---|
| HF 503 (model loading), 429, network/timeout, image-fetch failure | `true` | **throws** | retries, up to `attempts` (3) with exponential backoff (5s base), then DLQ |
| HF 401/403 (bad token), bad input, SSRF rejection, missing embeddings table | `false` | **returns** `{ success: false }` | no retry, no DLQ; the failure is recorded in `getJobResult` |
| No imageUrl AND no caption | n/a (validation) | returns `{ success: false }` | no retry |

**401/403 are never retried, by construction:** `hfErrorMessage()` marks them
`retryable: false`, so they take the return path. Retrying a rejected token would burn
budget and log spam for a failure that can only be fixed by an admin rotating the key.

Idempotency: the same image/caption + limit enqueued twice returns the **same job id**
and runs once (the queue drops the duplicate by `idempotencyKey`, a sha256 of the inputs
— the raw image URL never becomes a key).

## 6. Where inline processing is genuinely insufficient

One case, documented rather than built:

**Bulk catalog re-embedding (re-embed every product, e.g. after a model change).**
Per product the cost is 1 HF embedding call (up to 30s on a cold model) — inline in a
request that is capped at 60s, a bulk job over the 10-product catalog is already
marginal, and over a 50-product catalog it is impossible in one invocation. The
per-item `ai.analyze` job does not fix this either in synchronous mode: each item
still runs inside the requesting function. What this needs:

1. **Owner provisions Upstash Redis (free tier)** — `REDIS_URL` in Vercel env.
2. **`npm i bullmq`** (not installed; the queue falls back to synchronous without it).
3. **A bulk trigger** (admin route or a cron step) that enqueues one `ai.analyze` job
   per product with distinct idempotency keys — the per-item processor already exists;
   only the fan-out trigger is missing, deliberately, until (1) and (2) exist.

Until then, bulk re-embedding stays what it already is: the offline
`scripts/embed-products-local.mjs` script (local CLIP encoder, zero API calls), which is
the honest path for bulk work today.

## 7. Files

| File | What |
|---|---|
| `lib/workers/types.ts` | `ai.analyze` job type + `AiAnalyzeJobData` + `JobDataMap` entry |
| `lib/workers/processors.ts` | `processAiAnalyze` processor + registry entry; §14 invalidation hooks in `price.update` / `price.refresh` |
| `lib/workers/queue.ts` | `AiAnalyzeJobData` type re-export (no behaviour change) |
| `services/ai-background-jobs.ts` | `enqueueAiVisualAnalysis()` + idempotency key + attempts/backoff constants |
| `app/api/v1/admin/ai/jobs/route.ts` | Admin-only trigger route (`maxDuration` 60, `requireAdmin`, 10/min) |
| `docs/ai-background-jobs.md` | This file |
| `tests/section19-phase8-ai-background-jobs.test.ts` | Processor + queue integration tests (retryable throws/retries, non-retryable returns, idempotency, CLIP→MiniLM fallback) |
