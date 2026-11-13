# AI Security Report — SmartBuy AI (Section 19)

**Last updated:** 2026-11-13 (Section 19, Phase 8/9 — describes the finished built state)
**Code:** `lib/config/providers.ts`, `lib/config/env.ts`,
`services/external-search.ts`, `services/visual-search.ts`,
`services/visual-search-client.ts`, `services/ai-engine/usage.ts`,
`lib/api/middleware.ts`, `lib/admin-role.ts`,
`lib/api/error-logging.ts`, `services/ai-engine/`,
`app/api/v1/admin/ai/route.ts`.

> This report covers the AI surfaces only: provider keys, the visual-search
> SSRF guard, anonymous quota-burn defences, per-user quotas, admin guards, and
> error logging. Platform-wide security (CSRF, Zod validation, auth hardening,
> RLS, Stripe webhook verification) is in `docs/security-audit-report.md`
> (Section 18) and is not repeated here except where Section 19 changed it.

## 1. Provider keys are backend-only

- **No provider key is ever sent to the browser.** There is no `NEXT_PUBLIC_*`
  key or token for any AI provider (verified by grep, 13 Nov 2026). SerpAPI
  (`SERPAPI_API_KEY`) and Hugging Face (`HF_API_TOKEN`) are read server-side
  only, in `services/external-search.ts` and `services/visual-search.ts`.
- **OpenAI flag removed (Section 19, Phase 0, §12 #2).** `lib/config/providers.ts`
  used to set `enabled: Boolean(process.env.OPENAI_API_KEY)`, but no OpenAI
  client exists anywhere in the repo — setting the key changed nothing while the
  registry claimed an AI provider was active. The flag is now always
  `enabled: false` with a comment stating the deterministic-only scope, and the
  description reads: "No LLM provider configured — deterministic-only scope;
  setting OPENAI_API_KEY enables nothing until a real client is wired (owner
  decision)". `OPENAI_API_KEY` is still read into `lib/config/env.ts` config
  plumbing, but it enables nothing: no client consumes it, and the only other
  `openai` string in the codebase is the Hugging Face **model name**
  `openai/clip-vit-base-patch32` in `services/visual-search.ts`, never a client.
- **Adding a real LLM provider is owner-gated** (owner decision + key). Until
  then the engine's `kind: 'live'` providers are exactly the two that already
  existed — SerpAPI and Hugging Face Inference.
- **Provider validation is key-presence-only, by design** (accepted deviation,
  Section 19 coordinator decision). `AIEngine.validate()` reports live providers
  as `'available-unverified'` on key presence only — **no network probe is ever
  made**, so validation burns zero SerpAPI/HF quota. A present key is not proof
  the provider works; the label says so.

## 2. SSRF guard in visual search (Section 18 fix, Section 19 hardened)

The audit found a HIGH SSRF in visual search: `fetch(imageUrl)` with a
protocol-only guard. The fix (Section 18, hardened in Section 19, Phase 8,
§12 #11) lives in `services/visual-search.ts` and is verified by reading the
code on 13 Nov 2026:

- **Protocol check first:** only `http:` / `https:` URLs are accepted
  (`isPublicImageUrl`).
- **DNS-resolve + reject private/loopback/link-local:** every address the host
  resolves to is checked — RFC-1918 private ranges, loopback, link-local
  including `169.254.0.0/16`, and `192.0.0.0/24` (IETF protocol assignments).
  A host that resolves to any non-public address is rejected.
- **Redirects re-validated:** at most **3 redirects** (`MAX_IMAGE_FETCH_REDIRECTS
  = 3`); **each redirect target is re-validated with the same SSRF guard**, so
  a safe first URL cannot redirect to an internal address.
- **Size and time caps:** **8 MB** maximum image (`MAX_VISUAL_SEARCH_IMAGE_BYTES`,
  shared with scan via `services/visual-search-client.ts`); **30 s** fetch
  timeout for the HF leg (`HF_TIMEOUT_MS = 30_000`), 10 s for the SerpAPI lens
  leg.
- **Cache hit after the SSRF guard (§12 #11):** the cache is consulted only
  after the URL passes the guard — a cached entry can never bypass validation.
- **Client helpers split (Section 18):** the browser-safe helpers live in
  `services/visual-search-client.ts` (size validation only); the server-only
  fetch/SSRF code never ships to the client.

Residual risk, stated honestly: the guard validates at fetch time; a DNS
rebinding between validation and fetch (TOCTOU) is not defended against, and
there is **no image-host allowlist** — none can be written because no real
merchant image host is known yet (Section 18 blocked item #39, still open).
The allowlist is an owner-gated follow-up, not a Section 19 item.

## 3. Anonymous quota-burn mitigations + spend alert

Anonymous users have no identity to budget, so the defence is layered caps plus
hard daily budgets (`services/ai-engine/usage.ts`, §12 #7 — verified by reading
the code, 13 Nov 2026):

- **Tightened anonymous per-minute caps (per IP per minute):** ai-search
  20 → **10/min**, visual-search 10 → **5/min**, scan 10 → **5/min**. The audit
  found 20 distinct queries/min could exhaust a month of SerpAPI free quota in
  minutes; the caps are the first line of defence.
- **Global daily provider budgets (per instance):** SerpAPI **5 live
  calls/day** (≈ 150/month, inside the free plan's ~100–250 searches/month
  band) and Hugging Face **50 live calls/day** (a burst guardrail; HF free
  inference is rate-limited rather than monthly-capped). Cache hits (24 h
  memory / 7 d DB for SerpAPI) spend nothing and do not count.
  `spendProviderBudget()` returns false when the budget is exhausted and spends
  nothing — callers must then serve the deterministic/catalog fallback with an
  honest "web results unavailable today" label, never call the provider anyway.
- **Spend alert:** `SPEND_ALERT_THRESHOLD = 0.8` — the admin AI page surfaces
  the budgets that have reached 80% of their daily budget, leaving 20% of
  headroom after the alert fires, early enough to act. (An alert surface, not
  an automated notification — there is no email/push alert wired to it; see
  "Known limits".)
- **Retry + circuit breaker** bound the burn further: retries only on retryable
  failures (explicit `retryable: true`, HTTP 429/502/503/504, network/timeout —
  never 401/403/400/validation), 3 attempts max with exponential backoff
  (200 ms base, ≈ 600 ms worst case added); the in-memory circuit opens after
  **5 consecutive failures** with a **60 s cooldown**, and the engine never
  tries a provider whose circuit is open.

Known limit: all counters are **per-instance in-memory state** — they reset on
deploy / instance recycle and are not shared between Vercel instances. Treat
them as a live guardrail, not an audited ledger. Durable per-user AI usage needs
an owner-applied migration for a usage table; **no such migration is written**.

## 4. Per-user quota

`AI_USER_DAILY_QUOTA = 300` calls/day per signed-in user across AI routes (one
AI call every 2 minutes for 10 hours). `checkAiUserQuota(userId)` checks and
increments in one call; over quota the caller answers **429** with `resetAt`
(next UTC midnight). The quota binds abuse (a scripted loop), not real use.
Anonymous users keep the per-IP per-minute limits above as their floor — they
have no identity to budget.

## 5. Admin guards (`requireAdmin`)

- Admin AI surfaces are guarded by `requireAdmin` (`lib/api/middleware.ts`),
  which resolves the caller's role via `lib/admin-role.ts` — `role_id` → `roles`
  table name (Section 17 fix; the old code read a `profiles.role` column that
  does not exist). `/api/v1/admin/ai` (GET) is admin-only; the admin AI page
  reads `getAiUsageSummary()` through it. There is no second guard and no
  per-route reimplementation — `requireAdmin` is the one guard.
- The usage summary exposes per-provider calls/success/failure, average
  latency, consecutive failures, circuit state, last-called-at, per-capability
  totals and budget states, with the in-memory limitation note attached. It
  exposes counts, never keys.
- **Self-promotion guard (Section 17):** a signed-in user cannot set their own
  `role_id` to admin. Any admin check that reads a role column directly instead
  of going through `lib/admin-role.ts` is a bug — grep `.select('role')` for it
  (0 hits at the Section 18 gate).

## 6. Error logging is server-errors-only

`logApiError` (`lib/api/error-logging.ts`) writes to the `error_log` table
(migration 048, file only — **owner-gated, not applied**) with `x-request-id`
correlation on every response. Section 19, Phase 9 (§12 #92) wired it across
the API:

- **178 of 187 route files wired, 245 call sites** (Section 19 gate count,
  13 Nov 2026). The 9 unwired files are deliberate skips (routes with no catch
  path that can produce a server error) plus routes whose only errors are
  client errors.
- **Server errors only — by coordinator decision.** Five call sites that the
  literal brief would have wired were **reverted**: 3 inner validation 422s
  (user typos) and 2 webhook 400s. Logging them would have filled `error_log`
  with user mistakes. The one 400 that stays is the **Stripe webhook signature
  400**, kept deliberately as a security event (a bad signature is an attack
  signal, not a typo).
- `recordProviderHealth` writes are best-effort and never throw: a missing
  table, an RLS denial, or a null client degrades to a `logger.debug`, never an
  error page. Health writes may silently fail on anonymous clients (no
  authenticated Supabase client in scope) — in-memory usage/latency needs no
  client and is unaffected.

## 7. No LLM prompt-injection surface — because there is no LLM

Every AI answer in this codebase is a deterministic template over recorded data
— never presented as LLM reasoning. There is no prompt, no system prompt, no
model call, and no user input that reaches a language model, so there is no
prompt-injection surface to harden. The residual injection surface is the
ordinary one: user input rendered into deterministic templates and SQL — the
templates interpolate recorded rows (never raw user text into a query), and
database access goes through Supabase's parameterised client, not string-built
SQL. If a real LLM provider is ever wired (owner-gated), this section must be
rewritten: prompt-injection hardening, output validation, and key scoping
become required work, not optional.

## Known limits (not hidden)

- In-memory quota/budget/circuit state is per-instance and resets on deploy
  (see §3).
- No image-host allowlist yet (§2) — blocked on knowing a real merchant image
  host.
- The spend alert is a surface on the admin AI page, not an automated
  notification — nobody is paged when a budget hits 80%.
- `error_log` storage needs migration 048 applied by the owner; until then
  `logApiError` falls back to the logger and Sentry (when configured).
- `provider_health` durable writes are best-effort and may silently fail on
  anonymous clients.
- DNS-rebinding (TOCTOU) between SSRF validation and fetch is not defended
  against.
