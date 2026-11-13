# API Rate Limits

> Status: **complete coverage** — every API route handler enforces a rate
> limit. Regenerated 2026-11-13 ~12:35 PKT from the live route tree
> (266 handlers), updated 2026-11-13 ~15:20 PKT to the live tree
> (268 handlers: GET 143, POST 89, DELETE 18, PATCH 14, PUT 4 — counted
> from `app/api/**/route.ts` by extracting the first `rateLimitResponse()`
> call in each exported handler; the 4 named limits resolve to ai-search
> 10, scan 5, visual-search 5, ai-qa 20). All 160 rows from the 2026-11-10
> table are unchanged; 108 handlers were added since.
> `tests/rate-limit-coverage.test.ts` fails the build if a new handler is
> added without a limit, so this table stays honest.

## How it works

- Entry point: `rateLimitResponse()` in `lib/api/middleware.ts`, called at
  the top of every route handler (right after `logApiRequest`, before auth
  and before any DB work). Over the limit → HTTP 429 with body
  `{ success: false, error: { code: "RATE_LIMITED", ... } }` and a
  `resetAt` timestamp in `details`.
- Distributed first: `lib/api/rate-limit.ts` uses Upstash Redis (REST,
  free tier) sliding-window counters shared by all server instances
  (`sb-ratelimit:<key>`). Env: `UPSTASH_REDIS_REST_URL` +
  `UPSTASH_REDIS_REST_TOKEN` in the hosting dashboard.
- **Fail-open, never fail-closed:** Redis unset or erroring → the
  in-memory per-instance bucket in `lib/api/middleware.ts` takes over,
  so a limiter outage never blocks legitimate traffic. (Known gap: the
  in-memory bucket is per instance — a live burst test once showed 31
  rapid calls with 0×429 before Redis was wired. With Redis set, all
  instances share one counter.)
- Buckets are per **client IP** (`getClientIp`: `x-real-ip` first,
  `x-forwarded-for` first entry only as a local-dev fallback — never
  trusted as identity), except admin/owner-scoped writes, which are
  keyed per **user ID** after `requireAdmin` (e.g. visual-search
  backfill, Sentry test).
- Window is **1 minute** everywhere (`60_000` ms); limits below are
  requests/minute.

## Tiers

| Tier | Limit/min | Where it applies |
| --- | --- | --- |
| AI / heavy compute | 5–20 | `deal-finder` 20, `ai-search` 10, `scan` 5, `visual-search` 5 |
| Payments & sensitive writes | 10 | `subscriptions/checkout`, `subscriptions/portal`, `subscriptions` POST, `public/keys` create/revoke, `sentry-test`, `visual-search-backfill`, `monitoring/uptime/check` |
| Authenticated writes (default) | 30 | alerts, chat, community-deals, pools, reviews, wishlists, vault, tech-budget, preferences, settings/webhooks, push/subscribe, etc. |
| Unauthenticated writes | 60 | `affiliate/click`, `analytics/events`, `product-views` (click/event inflation protection) |
| Cron triggers | 30 | `prices/refresh`, `alerts/check`, `notifications/digest`, `notifications/process` (cron-job.org calls every 6h; 30/min leaves ample headroom for manual runs) |
| Stripe webhook | 30 | `webhooks/stripe` — signature-verified; Stripe retries 429s, so a generous limit only blunts floods of invalid-signature requests |
| Public GETs (default) | 120 | catalog reads: products, deals, brands, categories, merchants, coupons, etc. |
| Search | 60 | `GET /api/search` (DB + AI-search cache behind it) |
| Admin GETs | 60 | `/api/v1/admin/*` reads |
| Health | 300 | `GET /api/v1/health` (uptime monitors poll frequently) |
| Public API (keyed) | 120 keyed / 30 anon | `GET /api/v1/public/*` — an API key gets 120/min, anonymous IP 30/min |

### AI quotas — per-user daily budget + global provider budgets (Section 19, Phase 1)

- **Per-user AI quota:** signed-in users get **300 AI calls/day across all AI
  routes** (`AI_USER_DAILY_QUOTA`, in-memory per instance — see
  `services/ai-engine/usage.ts`). Enforced on the routes where a user identity
  is available (ai-search, recommendations, chat messages/conversations,
  smart-deals); anonymous users keep the per-IP per-minute limits above as
  their floor. Over-quota answers 429 with `resetAt` (next UTC midnight).
- **Global daily provider budgets (in-memory, per instance):** SerpAPI **5 live
  calls/day**, Hugging Face **50 live calls/day**. Cached hits spend nothing.
  When a budget is exhausted the route serves the deterministic/catalog
  fallback with an honest label (`webBudgetExhausted` in ai-search meta;
  "unavailable today" notes in scan) instead of spending more quota.
- **Anon caps tightened 12 Nov 2026** (audit §1 #9): ai-search 20→10/min,
  visual-search 10→5/min, scan 10→5/min — these routes spend real SerpAPI/HF
  free quota, and the per-query cache does not stop distinct queries from
  burning a month's free quota in minutes.

## Per-route table

| Route | Method | Bucket key | Limit/min |
| --- | --- | --- | --- |
| `/search/route.ts` | GET | `search:<ip|user|key>` | 60 |
| `/v1/account/route.ts` | DELETE | `account-delete:<ip|user|key>` | 1 |
| `/v1/admin/affiliate-clicks/route.ts` | GET | `admin.affiliate-clicks:<ip|user|key>` | 60 |
| `/v1/admin/ai/jobs/route.ts` | POST | `admin-ai-jobs:<ip|user|key>` | 10 |
| `/v1/admin/ai/route.ts` | GET | `admin.ai:<ip|user|key>` | 60 |
| `/v1/admin/analytics/route.ts` | GET | `admin.analytics:<ip|user|key>` | 60 |
| `/v1/admin/audit-logs/route.ts` | GET | `admin.audit-logs:<ip|user|key>` | 60 |
| `/v1/admin/community-deals/[id]/route.ts` | PATCH | `admin-community-deals:<ip|user|key>` | 60 |
| `/v1/admin/community-deals/route.ts` | GET | `admin-community-deals:<ip|user|key>` | 60 |
| `/v1/admin/data-quality/route.ts` | GET | `admin-data-quality:<ip|user|key>` | 60 |
| `/v1/admin/ebay/preview/route.ts` | POST | `admin.ebay-preview:<ip|user|key>` | 30 |
| `/v1/admin/intake/route.ts` | POST | `admin.intake:<ip|user|key>` | 30 |
| `/v1/admin/jobs/dead-letter/route.ts` | GET | `admin.jobs.dead-letter:<ip|user|key>` | 60 |
| `/v1/admin/merchant-listings/route.ts` | GET | `admin.merchant-listings:<ip|user|key>` | 60 |
| `/v1/admin/merchant-listings/route.ts` | POST | `admin.merchant-listings:<ip|user|key>` | 20 |
| `/v1/admin/merchants/[slug]/verify/route.ts` | POST | `admin-merchants-verify:<ip|user|key>` | 30 |
| `/v1/admin/monitoring/alert-delivery/route.ts` | GET | `admin.monitoring.alert-delivery:<ip|user|key>` | 60 |
| `/v1/admin/monitoring/jobs/route.ts` | GET | `admin.monitoring.jobs:<ip|user|key>` | 60 |
| `/v1/admin/newsletter/send/route.ts` | POST | `admin.newsletter.send:<ip|user|key>` | 10 |
| `/v1/admin/products/[id]/route.ts` | DELETE | `admin-products-delete:<ip|user|key>` | 30 |
| `/v1/admin/products/[id]/route.ts` | GET | `admin-products-get:<ip|user|key>` | 60 |
| `/v1/admin/products/[id]/route.ts` | PATCH | `admin-products-patch:<ip|user|key>` | 30 |
| `/v1/admin/products/[id]/specs/route.ts` | GET | `admin-products-specs-get:<ip|user|key>` | 60 |
| `/v1/admin/products/[id]/specs/route.ts` | PATCH | `admin-products-specs-patch:<ip|user|key>` | 30 |
| `/v1/admin/products/route.ts` | GET | `admin-products-list:<ip|user|key>` | 60 |
| `/v1/admin/providers/route.ts` | GET | `admin.providers:<ip|user|key>` | 60 |
| `/v1/admin/sentry-test/route.ts` | POST | `sentry-test:<ip|user|key>` | 10 |
| `/v1/admin/users/route.ts` | GET | `admin.users:<ip|user|key>` | 60 |
| `/v1/admin/visual-search-backfill/route.ts` | POST | `visual-search-backfill:<ip|user|key>` | 10 |
| `/v1/affiliate/click/route.ts` | POST | `affiliate.click:<ip|user|key>` | 60 |
| `/v1/affiliate/geo-click/route.ts` | POST | `affiliate.geo-click:<ip|user|key>` | 60 |
| `/v1/affiliate/links/route.ts` | GET | `affiliate.links:<ip|user|key>` | 120 |
| `/v1/affiliate/transform/route.ts` | POST | `affiliate.transform:<ip|user|key>` | 30 |
| `/v1/agent/hunts/[id]/route.ts` | DELETE | `agent-hunts:<ip|user|key>` | 30 |
| `/v1/agent/hunts/[id]/route.ts` | PATCH | `agent-hunts:<ip|user|key>` | 30 |
| `/v1/agent/hunts/route.ts` | GET | `agent-hunts:<ip|user|key>` | 30 |
| `/v1/agent/hunts/route.ts` | POST | `agent-hunts:<ip|user|key>` | 30 |
| `/v1/agent/memory/route.ts` | DELETE | `agent-memory:<ip|user|key>` | 30 |
| `/v1/agent/memory/route.ts` | GET | `agent-memory:<ip|user|key>` | 30 |
| `/v1/agent/memory/route.ts` | PUT | `agent-memory:<ip|user|key>` | 30 |
| `/v1/agent/rules/[id]/route.ts` | DELETE | `agent-rules:<ip|user|key>` | 30 |
| `/v1/agent/rules/[id]/route.ts` | PATCH | `agent-rules:<ip|user|key>` | 30 |
| `/v1/agent/rules/route.ts` | GET | `agent-rules:<ip|user|key>` | 30 |
| `/v1/agent/rules/route.ts` | POST | `agent-rules:<ip|user|key>` | 30 |
| `/v1/agent/summary/route.ts` | GET | `agent-summary:<ip|user|key>` | 30 |
| `/v1/ai-search/route.ts` | POST | `ai-search:<ip|user|key>` | 10 |
| `/v1/ai-summary/[productId]/route.ts` | GET | `ai-summary.productId:<ip|user|key>` | 120 |
| `/v1/alerts/[id]/route.ts` | DELETE | `alerts.id:<ip|user|key>` | 30 |
| `/v1/alerts/[id]/route.ts` | PATCH | `alerts.id:<ip|user|key>` | 30 |
| `/v1/alerts/check/route.ts` | POST | `alerts.check:<ip|user|key>` | 30 |
| `/v1/alerts/guest/route.ts` | POST | `alerts-guest:<ip|user|key>` | 30 |
| `/v1/alerts/guest/unsubscribe/route.ts` | GET | `alerts-guest-unsub:<ip|user|key>` | 30 |
| `/v1/alerts/guest/unsubscribe/route.ts` | POST | `alerts-guest-unsub:<ip|user|key>` | 30 |
| `/v1/alerts/history/route.ts` | GET | `alerts.history:<ip|user|key>` | 120 |
| `/v1/alerts/route.ts` | GET | `alerts:<ip|user|key>` | 120 |
| `/v1/alerts/route.ts` | POST | `alerts:<ip|user|key>` | 30 |
| `/v1/analytics/events/route.ts` | POST | `analytics.events:<ip|user|key>` | 60 |
| `/v1/analytics/route.ts` | GET | `analytics:<ip|user|key>` | 120 |
| `/v1/auth/reset-password/route.ts` | POST | `auth.reset-password:<ip|user|key>` | 5 |
| `/v1/auth/sign-in/route.ts` | POST | `auth.sign-in:<ip|user|key>` | 5 |
| `/v1/auth/sign-up/route.ts` | POST | `auth.sign-up:<ip|user|key>` | 5 |
| `/v1/brands/[slug]/route.ts` | GET | `brands.slug:<ip|user|key>` | 120 |
| `/v1/brands/route.ts` | GET | `brands:<ip|user|key>` | 120 |
| `/v1/bundles/route.ts` | GET | `bundles:<ip|user|key>` | 120 |
| `/v1/buy-list/[id]/route.ts` | DELETE | `buy-list.id:<ip|user|key>` | 30 |
| `/v1/buy-list/[id]/route.ts` | PATCH | `buy-list.id:<ip|user|key>` | 30 |
| `/v1/buy-list/route.ts` | GET | `buy-list:<ip|user|key>` | 30 |
| `/v1/buy-list/route.ts` | POST | `buy-list:<ip|user|key>` | 30 |
| `/v1/cashback/route.ts` | GET | `cashback:<ip|user|key>` | 120 |
| `/v1/categories/[slug]/route.ts` | GET | `categories.slug:<ip|user|key>` | 120 |
| `/v1/categories/route.ts` | GET | `categories:<ip|user|key>` | 120 |
| `/v1/category-inflation/route.ts` | GET | `category-inflation:<ip|user|key>` | 120 |
| `/v1/chat/conversations/route.ts` | GET | `chat.conversations:<ip|user|key>` | 120 |
| `/v1/chat/conversations/route.ts` | POST | `chat.conversations:<ip|user|key>` | 30 |
| `/v1/chat/messages/route.ts` | GET | `chat.messages:<ip|user|key>` | 120 |
| `/v1/chat/messages/route.ts` | POST | `chat.messages:<ip|user|key>` | 30 |
| `/v1/community-deals/[id]/vote/route.ts` | POST | `community-deals.id.vote:<ip|user|key>` | 30 |
| `/v1/community-deals/route.ts` | GET | `community-deals:<ip|user|key>` | 120 |
| `/v1/community-deals/route.ts` | POST | `community-deals:<ip|user|key>` | 30 |
| `/v1/comparison/route.ts` | POST | `comparison:<ip|user|key>` | 30 |
| `/v1/coupons/route.ts` | GET | `coupons:<ip|user|key>` | 120 |
| `/v1/creator-rewards/award/route.ts` | POST | `creator-rewards.award:<ip|user|key>` | 30 |
| `/v1/creator-rewards/leaderboard/route.ts` | GET | `creator-rewards.leaderboard:<ip|user|key>` | 30 |
| `/v1/creator-rewards/me/route.ts` | GET | `creator-rewards.me:<ip|user|key>` | 30 |
| `/v1/creators/[slug]/route.ts` | GET | `creators.slug:<ip|user|key>` | 120 |
| `/v1/dashboard/digest/route.ts` | GET | `dashboard.digest:<ip|user|key>` | 120 |
| `/v1/dashboard/drops-to-watch/route.ts` | GET | `dashboard.drops-to-watch:<ip|user|key>` | 120 |
| `/v1/dashboard/landed-cost/route.ts` | GET | `dashboard.landed-cost:<ip|user|key>` | 120 |
| `/v1/dashboard/tech-budget/route.ts` | GET | `dashboard.tech-budget:<ip|user|key>` | 120 |
| `/v1/data/export/route.ts` | GET | `data-export:<ip|user|key>` | 5 |
| `/v1/data/refresh/route.ts` | POST | `(conditional key)` | 10 |
| `/v1/deal-finder/route.ts` | POST | `deal-finder:<ip|user|key>` | 20 |
| `/v1/deal-hotspots/route.ts` | GET | `deal-hotspots:<ip|user|key>` | 120 |
| `/v1/deals/ranked/route.ts` | GET | `deals.ranked:<ip|user|key>` | 120 |
| `/v1/deals/route.ts` | GET | `deals:<ip|user|key>` | 120 |
| `/v1/digests/route.ts` | GET | `digests:<ip|user|key>` | 120 |
| `/v1/extension/coupons/route.ts` | GET | `extension.coupons:<ip|user|key>` | 120 |
| `/v1/extension/price/route.ts` | GET | `extension.price:<ip|user|key>` | 120 |
| `/v1/fact-check/[id]/route.ts` | GET | `fact-check:<ip|user|key>` | 60 |
| `/v1/fact-check/[id]/route.ts` | PATCH | `fact-check-decide:<ip|user|key>` | 30 |
| `/v1/fact-check/meaning/route.ts` | GET | `fact-check-meaning:<ip|user|key>` | 60 |
| `/v1/fact-check/route.ts` | GET | `fact-check:<ip|user|key>` | 60 |
| `/v1/fact-check/route.ts` | POST | `fact-check-create:<ip|user|key>` | 30 |
| `/v1/feature-flags/route.ts` | GET | `feature-flags:<ip|user|key>` | 120 |
| `/v1/forecast/[productId]/backtest/route.ts` | GET | `forecast-backtest:<ip|user|key>` | 30 |
| `/v1/forecast/[productId]/route.ts` | GET | `forecast:<ip|user|key>` | 30 |
| `/v1/fx-rates/route.ts` | GET | `fx-rates:<ip|user|key>` | 120 |
| `/v1/gifts/route.ts` | POST | `gifts:<ip|user|key>` | 30 |
| `/v1/guided-finder/route.ts` | GET | `guided-finder:<ip|user|key>` | 60 |
| `/v1/health/route.ts` | GET | `health:<ip|user|key>` | 300 |
| `/v1/live-sessions/[slug]/route.ts` | GET | `live-sessions:<ip|user|key>` | 120 |
| `/v1/live-sessions/route.ts` | GET | `live-sessions:<ip|user|key>` | 120 |
| `/v1/live-sessions/route.ts` | POST | `live-sessions:<ip|user|key>` | 30 |
| `/v1/merchants/[slug]/accuracy/route.ts` | GET | `merchants-accuracy:<ip|user|key>` | 60 |
| `/v1/merchants/[slug]/accuracy/route.ts` | POST | `merchants-accuracy-record:<ip|user|key>` | 30 |
| `/v1/merchants/[slug]/route.ts` | GET | `merchants.slug:<ip|user|key>` | 120 |
| `/v1/merchants/[slug]/trust/route.ts` | GET | `merchants-trust:<ip|user|key>` | 60 |
| `/v1/merchants/route.ts` | GET | `merchants:<ip|user|key>` | 120 |
| `/v1/merchants/verified/route.ts` | GET | `merchants-verified:<ip|user|key>` | 60 |
| `/v1/mobile-app/waitlist/route.ts` | POST | `mobile-app-waitlist:<ip|user|key>` | 30 |
| `/v1/monitoring/incidents/route.ts` | GET | `monitoring-incidents:<ip|user|key>` | 60 |
| `/v1/monitoring/providers/route.ts` | GET | `monitoring.providers:<ip|user|key>` | 120 |
| `/v1/monitoring/route.ts` | GET | `monitoring:<ip|user|key>` | 120 |
| `/v1/monitoring/sync-history/route.ts` | GET | `monitoring.sync-history:<ip|user|key>` | 120 |
| `/v1/monitoring/uptime/check/route.ts` | POST | `monitoring-uptime-check:<ip|user|key>` | 10 |
| `/v1/monitoring/uptime/route.ts` | GET | `monitoring-uptime:<ip|user|key>` | 60 |
| `/v1/newsletter/confirm/route.ts` | GET | `newsletter-confirm:<ip|user|key>` | 30 |
| `/v1/newsletter/confirm/route.ts` | POST | `newsletter-confirm:<ip|user|key>` | 30 |
| `/v1/newsletter/subscribe/route.ts` | POST | `newsletter-subscribe:<ip|user|key>` | 60 |
| `/v1/newsletter/unsubscribe/route.ts` | GET | `newsletter-unsubscribe:<ip|user|key>` | 30 |
| `/v1/newsletter/unsubscribe/route.ts` | POST | `newsletter-unsubscribe:<ip|user|key>` | 30 |
| `/v1/notifications/[id]/route.ts` | PATCH | `notifications.id:<ip|user|key>` | 60 |
| `/v1/notifications/digest/route.ts` | POST | `notifications.digest:<ip|user|key>` | 30 |
| `/v1/notifications/process/route.ts` | POST | `notifications.process:<ip|user|key>` | 30 |
| `/v1/notifications/read-all/route.ts` | POST | `notifications.readAll:<ip|user|key>` | 30 |
| `/v1/notifications/route.ts` | GET | `notifications:<ip|user|key>` | 120 |
| `/v1/platforms/ebay/search/route.ts` | GET | `platforms.ebay-search:<ip|user|key>` | 30 |
| `/v1/platforms/route.ts` | GET | `platforms:<ip|user|key>` | 120 |
| `/v1/pools/[id]/join/route.ts` | POST | `pools.id.join:<ip|user|key>` | 30 |
| `/v1/pools/[id]/route.ts` | GET | `pools.id:<ip|user|key>` | 120 |
| `/v1/pools/route.ts` | GET | `pools:<ip|user|key>` | 120 |
| `/v1/pools/route.ts` | POST | `pools:<ip|user|key>` | 30 |
| `/v1/predictions/[productId]/route.ts` | GET | `predictions.productId:<ip|user|key>` | 120 |
| `/v1/predictions/accuracy/route.ts` | GET | `predictions-accuracy:<ip|user|key>` | 60 |
| `/v1/predictions/outcomes/route.ts` | GET | `predictions-outcomes:<ip|user|key>` | 60 |
| `/v1/predictions/outcomes/route.ts` | POST | `predictions-outcomes-write:<ip|user|key>` | 30 |
| `/v1/preferences/route.ts` | GET | `preferences:<ip|user|key>` | 120 |
| `/v1/preferences/route.ts` | PUT | `preferences:<ip|user|key>` | 30 |
| `/v1/price-history/export/route.ts` | GET | `price-history-export:<ip|user|key>` | 30 |
| `/v1/price-index/export/route.ts` | GET | `price-index-export:<ip|user|key>` | 30 |
| `/v1/price-index/route.ts` | GET | `price-index:<ip|user|key>` | 60 |
| `/v1/price-protection/[id]/route.ts` | DELETE | `price-protection.id:<ip|user|key>` | 30 |
| `/v1/price-protection/[id]/route.ts` | PATCH | `price-protection.id:<ip|user|key>` | 30 |
| `/v1/price-protection/route.ts` | GET | `price-protection:<ip|user|key>` | 30 |
| `/v1/price-protection/route.ts` | POST | `price-protection:<ip|user|key>` | 30 |
| `/v1/prices/refresh/route.ts` | POST | `prices.refresh:<ip|user|key>` | 30 |
| `/v1/product-views/route.ts` | DELETE | `product-views:<ip|user|key>` | 30 |
| `/v1/product-views/route.ts` | GET | `product-views:<ip|user|key>` | 60 |
| `/v1/product-views/route.ts` | POST | `product-views:<ip|user|key>` | 60 |
| `/v1/products/[slug]/budget-alternative/route.ts` | GET | `products.slug.budget-alternative:<ip|user|key>` | 120 |
| `/v1/products/[slug]/deals/route.ts` | GET | `products.slug.deals:<ip|user|key>` | 120 |
| `/v1/products/[slug]/merchants/route.ts` | GET | `products.slug.merchants:<ip|user|key>` | 120 |
| `/v1/products/[slug]/prices/route.ts` | GET | `products.slug.prices:<ip|user|key>` | 120 |
| `/v1/products/[slug]/qa/route.ts` | GET | `products-qa:<ip|user|key>` | 60 |
| `/v1/products/[slug]/qa/route.ts` | PATCH | `products-qa-answer:<ip|user|key>` | 30 |
| `/v1/products/[slug]/qa/route.ts` | POST | `products-qa-ask:<ip|user|key>` | 30 |
| `/v1/products/[slug]/review-summary/route.ts` | GET | `products.slug.review-summary:<ip|user|key>` | 120 |
| `/v1/products/[slug]/reviews/route.ts` | GET | `products-reviews:<ip|user|key>` | 60 |
| `/v1/products/[slug]/reviews/route.ts` | POST | `products-reviews-create:<ip|user|key>` | 30 |
| `/v1/products/[slug]/route.ts` | GET | `products.slug:<ip|user|key>` | 120 |
| `/v1/products/[slug]/similar/route.ts` | GET | `products.slug.similar:<ip|user|key>` | 120 |
| `/v1/products/route.ts` | GET | `products:<ip|user|key>` | 120 |
| `/v1/public/deals/route.ts` | GET | `public-api:key:<ip|user|key>` | 120 (120 keyed / 30 anon) |
| `/v1/public/keys/[keyId]/route.ts` | DELETE | `public-keys-revoke:<ip|user|key>` | 10 |
| `/v1/public/keys/route.ts` | GET | `public-keys:<ip|user|key>` | 30 |
| `/v1/public/keys/route.ts` | POST | `public-keys-create:<ip|user|key>` | 10 |
| `/v1/public/prices/route.ts` | GET | `public-api:key:<ip|user|key>` | 120 (120 keyed / 30 anon) |
| `/v1/public/products/[slug]/route.ts` | GET | `public-api:key:<ip|user|key>` | 120 (120 keyed / 30 anon) |
| `/v1/public/products/route.ts` | GET | `public-api:key:<ip|user|key>` | 120 (120 keyed / 30 anon) |
| `/v1/push/subscribe/route.ts` | DELETE | `push-unsubscribe:<ip|user|key>` | 30 |
| `/v1/push/subscribe/route.ts` | POST | `push-subscribe:<ip|user|key>` | 30 |
| `/v1/push/test/route.ts` | POST | `push-test:<ip|user|key>` | 5 |
| `/v1/push/vapid/route.ts` | GET | `push.vapid:<ip|user|key>` | 120 |
| `/v1/recommendations/feedback/route.ts` | POST | `recommendations.feedback:<ip|user|key>` | 30 |
| `/v1/recommendations/personalization/route.ts` | GET | `recommendations.personalization:<ip|user|key>` | 120 |
| `/v1/recommendations/personalization/route.ts` | PUT | `recommendations.personalization:<ip|user|key>` | 30 |
| `/v1/recommendations/route.ts` | GET | `recommendations:<ip|user|key>` | 120 |
| `/v1/recommendations/saved/route.ts` | DELETE | `recommendations.saved:<ip|user|key>` | 30 |
| `/v1/recommendations/saved/route.ts` | GET | `recommendations.saved:<ip|user|key>` | 120 |
| `/v1/recommendations/saved/route.ts` | POST | `recommendations.saved:<ip|user|key>` | 30 |
| `/v1/referrals/attribute/route.ts` | POST | `referrals-attribute:<ip|user|key>` | 30 |
| `/v1/referrals/click/route.ts` | POST | `referrals-click:<ip|user|key>` | 60 |
| `/v1/referrals/route.ts` | GET | `referrals-stats:<ip|user|key>` | 60 |
| `/v1/referrals/route.ts` | POST | `referrals-create:<ip|user|key>` | 30 |
| `/v1/retailers/route.ts` | GET | `retailers:<ip|user|key>` | 120 |
| `/v1/saved-calculations/route.ts` | DELETE | `saved-calculations:<ip|user|key>` | 30 |
| `/v1/saved-calculations/route.ts` | GET | `saved-calculations:<ip|user|key>` | 120 |
| `/v1/saved-calculations/route.ts` | POST | `saved-calculations:<ip|user|key>` | 30 |
| `/v1/saved-searches/route.ts` | DELETE | `saved-searches:<ip|user|key>` | 30 |
| `/v1/saved-searches/route.ts` | GET | `saved-searches:<ip|user|key>` | 120 |
| `/v1/saved-searches/route.ts` | PATCH | `saved-searches:<ip|user|key>` | 30 |
| `/v1/saved-searches/route.ts` | POST | `saved-searches:<ip|user|key>` | 30 |
| `/v1/savings/route.ts` | GET | `savings:<ip|user|key>` | 30 |
| `/v1/savings/route.ts` | POST | `savings:<ip|user|key>` | 30 |
| `/v1/scan/route.ts` | POST | `scan:<ip|user|key>` | 5 |
| `/v1/search-history/route.ts` | GET | `search-history:<ip|user|key>` | 120 |
| `/v1/settings/webhooks/route.ts` | GET | `settings.webhooks:<ip|user|key>` | 120 |
| `/v1/settings/webhooks/route.ts` | POST | `settings.webhooks:<ip|user|key>` | 30 |
| `/v1/shared-wishlists/[id]/route.ts` | GET | `shared-wishlists.id:<ip|user|key>` | 120 |
| `/v1/smart-deals/route.ts` | GET | `smart-deals:<ip|user|key>` | 120 |
| `/v1/stores/route.ts` | GET | `stores:<ip|user|key>` | 120 |
| `/v1/subscriptions/checkout/route.ts` | POST | `subscriptions.checkout:<ip|user|key>` | 10 |
| `/v1/subscriptions/history/route.ts` | GET | `subscriptions.history:<ip|user|key>` | 120 |
| `/v1/subscriptions/portal/route.ts` | POST | `subscriptions.portal:<ip|user|key>` | 10 |
| `/v1/subscriptions/route.ts` | GET | `subscriptions:<ip|user|key>` | 120 |
| `/v1/subscriptions/route.ts` | POST | `subscriptions:<ip|user|key>` | 10 |
| `/v1/tech-budget/route.ts` | GET | `tech-budget:<ip|user|key>` | 120 |
| `/v1/tech-budget/route.ts` | POST | `tech-budget:<ip|user|key>` | 30 |
| `/v1/tools/ai-qa/route.ts` | POST | `tools-ai-qa:<ip|user|key>` | 20 |
| `/v1/tools/best-time/route.ts` | GET | `tools-best-time:<ip|user|key>` | 60 |
| `/v1/tools/consumer-subscriptions/route.ts` | DELETE | `tools-consumer-subs:<ip|user|key>` | 30 |
| `/v1/tools/consumer-subscriptions/route.ts` | GET | `tools-consumer-subs:<ip|user|key>` | 30 |
| `/v1/tools/consumer-subscriptions/route.ts` | POST | `tools-consumer-subs:<ip|user|key>` | 30 |
| `/v1/tools/consumer-subscriptions/route.ts` | PUT | `tools-consumer-subs:<ip|user|key>` | 30 |
| `/v1/tools/digest/route.ts` | GET | `tools:digest:<ip|user|key>` | 30 |
| `/v1/tools/digest/route.ts` | POST | `tools:digest:<ip|user|key>` | 30 |
| `/v1/tools/eco-coach/route.ts` | GET | `tools.eco-coach:<ip|user|key>` | 30 |
| `/v1/tools/eco-coach/route.ts` | POST | `tools.eco-coach:<ip|user|key>` | 30 |
| `/v1/tools/expenses/route.ts` | GET | `tools-expenses:<ip|user|key>` | 30 |
| `/v1/tools/expenses/route.ts` | POST | `tools-expenses:<ip|user|key>` | 30 |
| `/v1/tools/forecast-explainer/route.ts` | GET | `tools-forecast-explainer:<ip|user|key>` | 60 |
| `/v1/tools/future-you/route.ts` | GET | `tools-future-you:<ip|user|key>` | 30 |
| `/v1/tools/future-you/route.ts` | POST | `tools-future-you:<ip|user|key>` | 30 |
| `/v1/tools/list-optimizer/route.ts` | GET | `tools:list-optimizer:<ip|user|key>` | 30 |
| `/v1/tools/list-optimizer/route.ts` | POST | `tools:list-optimizer:<ip|user|key>` | 30 |
| `/v1/tools/planner/route.ts` | GET | `tools-planner:<ip|user|key>` | 30 |
| `/v1/tools/planner/route.ts` | POST | `tools-planner:<ip|user|key>` | 30 |
| `/v1/tools/price-history/route.ts` | GET | `tools-price-history:<ip|user|key>` | 60 |
| `/v1/tools/smart-home/route.ts` | GET | `tools.smart-home:<ip|user|key>` | 30 |
| `/v1/tools/smart-home/route.ts` | POST | `tools.smart-home:<ip|user|key>` | 30 |
| `/v1/tools/smart-home/webhook/route.ts` | POST | `tools.smart-home.webhook:<ip|user|key>` | 30 |
| `/v1/tools/trade-in/route.ts` | GET | `tools-trade-in:<ip|user|key>` | 60 |
| `/v1/tools/warranty-claims/route.ts` | GET | `tools.warranty-claims:<ip|user|key>` | 30 |
| `/v1/tools/warranty-claims/route.ts` | POST | `tools.warranty-claims:<ip|user|key>` | 30 |
| `/v1/tracking/route.ts` | GET | `tracking:<ip|user|key>` | 120 |
| `/v1/translations/route.ts` | GET | `translations:<ip|user|key>` | 60 |
| `/v1/translations/route.ts` | POST | `translations-write:<ip|user|key>` | 30 |
| `/v1/vault/[id]/route.ts` | DELETE | `vault.id:<ip|user|key>` | 30 |
| `/v1/vault/[id]/route.ts` | PATCH | `vault.id:<ip|user|key>` | 30 |
| `/v1/vault/route.ts` | GET | `vault:<ip|user|key>` | 120 |
| `/v1/vault/route.ts` | POST | `vault:<ip|user|key>` | 30 |
| `/v1/visual-search/route.ts` | POST | `visual-search:<ip|user|key>` | 5 |
| `/v1/warranty-plans/route.ts` | GET | `warranty-plans:<ip|user|key>` | 120 |
| `/v1/warranty-plans/route.ts` | POST | `warranty-plans:<ip|user|key>` | 30 |
| `/v1/wishlist-polls/[id]/vote/route.ts` | POST | `wishlist-polls.id.vote:<ip|user|key>` | 30 |
| `/v1/wishlist-polls/route.ts` | GET | `wishlist-polls:<ip|user|key>` | 120 |
| `/v1/wishlist-polls/route.ts` | POST | `wishlist-polls:<ip|user|key>` | 30 |
| `/v1/wishlists/[id]/items/[itemId]/route.ts` | DELETE | `wishlists.id.items.itemId:<ip|user|key>` | 30 |
| `/v1/wishlists/[id]/items/external/route.ts` | GET | `wishlists.id.items.external:<ip|user|key>` | 120 |
| `/v1/wishlists/[id]/items/external/route.ts` | POST | `wishlists.id.items.external:<ip|user|key>` | 30 |
| `/v1/wishlists/[id]/items/route.ts` | GET | `wishlists.id.items:<ip|user|key>` | 120 |
| `/v1/wishlists/[id]/items/route.ts` | POST | `wishlists.id.items:<ip|user|key>` | 30 |
| `/v1/wishlists/[id]/route.ts` | DELETE | `wishlists.id:<ip|user|key>` | 30 |
| `/v1/wishlists/[id]/route.ts` | GET | `wishlists.id:<ip|user|key>` | 120 |
| `/v1/wishlists/[id]/route.ts` | PATCH | `wishlists.id:<ip|user|key>` | 30 |
| `/v1/wishlists/route.ts` | GET | `wishlists:<ip|user|key>` | 120 |
| `/v1/wishlists/route.ts` | POST | `wishlists:<ip|user|key>` | 30 |
| `/webhooks/stripe/route.ts` | POST | `webhooks.stripe:<ip|user|key>` | 30 |

Notes on the table:

- Bucket keys are shown with the variable suffix collapsed to
  `<ip|user|key>`; the real key is e.g. `affiliate.click:203.0.113.7`.
- A few routes predate this pass and use their own key spellings
  (e.g. `deal-finder:`, `push-subscribe:`, `fact-check-create:`) — the
  limit is what matters; key spelling is cosmetic.
- `data/refresh` uses a bare-IP call, `rateLimitResponse(getClientIp(request), 10)` — same 10/min effect, no key prefix.
- New routes added by later work must add a `rateLimitResponse` call;
  `tests/rate-limit-coverage.test.ts` enforces it.

## When legitimate traffic hits 429

1. Check whether the caller is a real user (one browser = one IP) or a
   shared NAT / office IP — shared IPs legitimately share a bucket.
2. Check Vercel Runtime Logs for the `RATE_LIMITED` 429s and the route.
3. Raise the limit for that route only (edit the call, update this doc
   and the coverage test's expectations if any). Do NOT raise limits
   globally or disable the limiter to fix one noisy route.
4. If 429s come from one IP hammering an unauthenticated write
   (`affiliate/click`, `analytics/events`), that is the limiter doing
   its job — leave it.
