# API Documentation — SmartBuy AI

**Base URL:** `https://shahjahanaibuy-b1zp.vercel.app`
**Version:** v1
**Last updated:** 2026-11-12 (Section 17, Stage I)
**Coverage:** 181 route files / 244 handlers under `app/api/`, counted from the route files on 2026-11-12. The route table below is generated, not hand-typed — regenerate it with the Section 17 Stage I generator (`docs/openapi.json` is generated from the same source).
**Machine-readable spec:** `docs/openapi.json` (OpenAPI 3.0.3 — paths + methods only; request/response schemas are not yet machine-generated).

> Honest scope note: this document lists every route that exists in code. It does **not** mean every route works live today — several depend on owner-gated configuration (see "Fail-closed behaviour" below) or on database migrations that are not yet applied live. Where a route is known to degrade, it is called out.

---

## Authentication

Three auth models exist side by side:

| Model | Where | How |
|---|---|---|
| Supabase session cookie | Most `/api/v1/*` user endpoints | Signed-in session; server-validated with `getUser()`. No session → 401. |
| API key (`x-api-key` header only, never a query param) | `/api/v1/public/*` | Key format `sbk_live_` + 32 chars; only a SHA-256 hash is stored. Invalid key → 401. |
| Bearer `CRON_SECRET` | The 6 cron endpoints (see below) | `Authorization: Bearer <CRON_SECRET>`. Missing/wrong secret → 401/500 depending on the route. |
| Stripe signature | `POST /api/webhooks/stripe` | `stripe-signature` header verified; bad signature → 400. |

### API tiers & quotas (public API)

| Tier | Daily quota |
|---|---|
| Anonymous (no key, IP-keyed) | 100 / IP / day |
| Free | 1,000 / day |
| Premium / Family | 10,000 / day |
| Team | 100,000 / day |

Quota is enforced server-side via `lib/api-quota.ts`. Known gap (Section 17 audit §4 #4): `GET /api/v1/public/products/[slug]` validates the key but does **not** count quota, unlike the other three public routes. Also note: until migration 035 is applied, quotas live in per-instance memory on serverless (restartable, bypassable across instances) and any DB error fails open to the in-memory store.

### Admin

Admin routes under `/api/v1/admin/*` require a signed-in admin (`requireAdmin`, fail-closed). Known live risk (Section 17 audit §4 #1): the server-side admin check reads a `profiles.role` column that does not exist in the migration chain (only `role_id` FK) — if the live database matches the migration chain, every admin route returns 403. Live status is unknown to the repo; only the owner can verify it.

---

## Response format

All API routes return a consistent JSON envelope:

### Success
```json
{
  "success": true,
  "data": { ... }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { ... }
  }
}
```

### Error codes
| Code | HTTP status | Description |
|------|-------------|-------------|
| `BAD_REQUEST` | 400 | Invalid request |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource conflict |
| `RATE_LIMITED` | 429 | Too many requests |
| `VALIDATION_ERROR` | 422 | Input validation failed |
| `INTERNAL_ERROR` | 500 | Server error |
| `SERVICE_UNAVAILABLE` | 503 | Service down / not configured (fail-closed) |

---

## Rate limiting

All 181 route files call `rateLimitResponse` (enforced by `tests/rate-limit-coverage.test.ts`). Upstash Redis first when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set; otherwise a per-instance in-memory bucket (fail-open by design). Exceeding the limit returns `429 RATE_LIMITED`. Per-route limits vary — see `docs/rate-limits.md` for the per-route table.

---

## Pagination

List endpoints support `page` (default 1) and `pageSize` (default 20, max 100).

**Response includes:**
```json
{
  "success": true,
  "data": [...],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 150
  }
}
```

---

## Fail-closed behaviour (routes that honestly refuse)

These are by design, not bugs:

- `POST /api/v1/visual-search` → **503** when `HF_API_TOKEN` is unset.
- `POST /api/v1/prices/refresh` → **500** when `CRON_SECRET` is unset. When it runs it always returns 200 with a per-step status — a monitor must read the response body, not just the status code, to see a failed step.
- Newsletter subscribe → **503** until migration 036 is applied live (table missing).
- Webhook / service-role-dependent routes → **503** when `SUPABASE_SERVICE_ROLE_KEY` is unset.
- `DELETE /api/v1/account` requires `{ "confirmation": "DELETE" }` and is limited to 1/hour.
- No route returns fake data. Worker processors `data.sync` and `image.process` return `{ success: true, processed: 0, placeholder: true }`.

---

## Cron endpoints (6 — all `CRON_SECRET`-protected)

Exactly one scheduler is expected: cron-job.org. There is no `vercel.json` and no in-repo scheduler.

| Endpoint | Schedule (owner's cron-job.org) |
|---|---|
| `POST /api/v1/prices/refresh` | Every 6 hours — the price-refresh chain (eBay leg → refresh → alerts → hunts → digest → notifications → stock → guest alerts → guest email → saved searches) |
| `POST /api/v1/notifications/process` | Every 5 minutes |
| `POST /api/v1/notifications/digest` | Weekly (Monday 09:00) |
| `POST /api/v1/monitoring/uptime/check` | Every 5 minutes |
| `POST /api/v1/alerts/check` | Unscheduled — no decision recorded yet |
| `POST /api/v1/predictions/outcomes` | Unscheduled — no decision recorded yet |

Whether the cron-job.org jobs exist or fire is unknown from the repo — only the owner can verify it in the cron-job.org dashboard.

---

## Stripe webhook

#### `POST /api/webhooks/stripe`

Signature-verified. Events handled: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`. Idempotency via the `webhook_events` table. No handler exists yet for `invoice.payment_failed` (falls into the log-only default branch).

**Stripe is in TEST mode. Revenue is $0.** Live charges need BOTH a live secret key (`sk_live_`) AND `STRIPE_LIVE_LAUNCHED=true` — see `docs/DEPLOYMENT.md`. `POST /api/v1/subscriptions` accepts only `plan: 'free'`; any other plan returns 400 (paid plans only via the Stripe webhook).

---

## Key routes (curated)

The full table follows. These are the routes most callers need first:

### Health
#### `GET /api/v1/health`
Service health with component checks (database, auth, Stripe status).

### Products (public catalogue)
#### `GET /api/v1/products`
Query products with filtering and pagination. Query params: `page`, `pageSize`, `category`, `brand`, `minPrice`, `maxPrice`, `sort`. Live catalogue: 10 products; prices last recorded 2026-11-02 (stale — refresh fetches nothing live except the eBay leg, which is blocked without eBay keys and a live `merchants` row).

#### `GET /api/v1/products/[slug]`
Single product with full details. `/products/[slug]/deals`, `/merchants`, `/prices`, `/reviews`, `/similar`, `/qa`, `/review-summary`, `/budget-alternative` exist alongside it.

### Public API (keyed)
#### `GET /api/v1/public/products` · `GET /api/v1/public/products/[slug]` · `GET /api/v1/public/prices` · `GET /api/v1/public/deals`
Keyed catalogue access (see tiers above). `GET /api/v1/public/keys` manages keys.

### AI search
#### `POST /api/v1/ai-search`
Natural-language product search. Body: `{ "query": "string", "pageSize": 10 }`.

### Alerts, wishlists, subscriptions
- Alerts: `GET/POST /api/v1/alerts`, `GET/PUT/DELETE /api/v1/alerts/[id]`, `GET /api/v1/alerts/history`.
- Wishlists: `GET/POST /api/v1/wishlists`, item routes under `/api/v1/wishlists/[id]/items`.
- Subscriptions: `GET/POST /api/v1/subscriptions`, `POST /api/v1/subscriptions/checkout`, `POST /api/v1/subscriptions/portal`, `GET /api/v1/subscriptions/history`.

### Push
- `POST /api/v1/push/subscribe`, `DELETE /api/v1/push/subscribe`, `GET /api/v1/push/vapid`, `POST /api/v1/push/test`.

---

## Complete route table (181 routes, 244 handlers)

Generated from `app/api/**/route.ts` on 2026-11-12. Methods are the exported handlers in each file.

### `search`

| Method(s) | Path |
|---|---|
| GET | `/api/search` |


### `v1/account`

| Method(s) | Path |
|---|---|
| DELETE | `/api/v1/account` |


### `v1/admin`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/admin/affiliate-clicks` |
| GET | `/api/v1/admin/analytics` |
| GET | `/api/v1/admin/audit-logs` |
| PATCH | `/api/v1/admin/community-deals/{id}` |
| GET | `/api/v1/admin/community-deals` |
| POST | `/api/v1/admin/ebay/preview` |
| POST | `/api/v1/admin/intake` |
| POST | `/api/v1/admin/merchants/{slug}/verify` |
| POST | `/api/v1/admin/newsletter/send` |
| POST | `/api/v1/admin/sentry-test` |
| GET | `/api/v1/admin/users` |
| POST | `/api/v1/admin/visual-search-backfill` |


### `v1/affiliate`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/affiliate/click` |
| POST | `/api/v1/affiliate/geo-click` |
| GET | `/api/v1/affiliate/links` |
| POST | `/api/v1/affiliate/transform` |


### `v1/agent`

| Method(s) | Path |
|---|---|
| PATCH, DELETE | `/api/v1/agent/hunts/{id}` |
| GET, POST | `/api/v1/agent/hunts` |
| GET, PUT, DELETE | `/api/v1/agent/memory` |
| PATCH, DELETE | `/api/v1/agent/rules/{id}` |
| GET, POST | `/api/v1/agent/rules` |
| GET | `/api/v1/agent/summary` |


### `v1/ai-search`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/ai-search` |


### `v1/ai-summary`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/ai-summary/{productId}` |


### `v1/alerts`

| Method(s) | Path |
|---|---|
| PATCH, DELETE | `/api/v1/alerts/{id}` |
| POST | `/api/v1/alerts/check` |
| POST | `/api/v1/alerts/guest` |
| GET, POST | `/api/v1/alerts/guest/unsubscribe` |
| GET | `/api/v1/alerts/history` |
| GET, POST | `/api/v1/alerts` |


### `v1/analytics`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/analytics/events` |
| GET | `/api/v1/analytics` |


### `v1/brands`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/brands/{slug}` |
| GET | `/api/v1/brands` |


### `v1/bundles`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/bundles` |


### `v1/buy-list`

| Method(s) | Path |
|---|---|
| PATCH, DELETE | `/api/v1/buy-list/{id}` |
| GET, POST | `/api/v1/buy-list` |


### `v1/cashback`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/cashback` |


### `v1/categories`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/categories/{slug}` |
| GET | `/api/v1/categories` |


### `v1/category-inflation`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/category-inflation` |


### `v1/chat`

| Method(s) | Path |
|---|---|
| GET, POST | `/api/v1/chat/conversations` |
| GET, POST | `/api/v1/chat/messages` |


### `v1/community-deals`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/community-deals/{id}/vote` |
| GET, POST | `/api/v1/community-deals` |


### `v1/comparison`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/comparison` |


### `v1/coupons`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/coupons` |


### `v1/creator-rewards`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/creator-rewards/award` |
| GET | `/api/v1/creator-rewards/leaderboard` |
| GET | `/api/v1/creator-rewards/me` |


### `v1/creators`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/creators/{slug}` |


### `v1/dashboard`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/dashboard/digest` |
| GET | `/api/v1/dashboard/drops-to-watch` |
| GET | `/api/v1/dashboard/landed-cost` |
| GET | `/api/v1/dashboard/tech-budget` |


### `v1/data`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/data/export` |
| POST | `/api/v1/data/refresh` |


### `v1/deal-finder`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/deal-finder` |


### `v1/deal-hotspots`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/deal-hotspots` |


### `v1/deals`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/deals/ranked` |
| GET | `/api/v1/deals` |


### `v1/digests`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/digests` |


### `v1/extension`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/extension/coupons` |
| GET | `/api/v1/extension/price` |


### `v1/fact-check`

| Method(s) | Path |
|---|---|
| GET, PATCH | `/api/v1/fact-check/{id}` |
| GET | `/api/v1/fact-check/meaning` |
| GET, POST | `/api/v1/fact-check` |


### `v1/feature-flags`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/feature-flags` |


### `v1/forecast`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/forecast/{productId}/backtest` |
| GET | `/api/v1/forecast/{productId}` |


### `v1/fx-rates`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/fx-rates` |


### `v1/gifts`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/gifts` |


### `v1/guided-finder`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/guided-finder` |


### `v1/health`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/health` |


### `v1/live-sessions`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/live-sessions/{slug}` |
| GET, POST | `/api/v1/live-sessions` |


### `v1/merchants`

| Method(s) | Path |
|---|---|
| GET, POST | `/api/v1/merchants/{slug}/accuracy` |
| GET | `/api/v1/merchants/{slug}` |
| GET | `/api/v1/merchants/{slug}/trust` |
| GET | `/api/v1/merchants` |
| GET | `/api/v1/merchants/verified` |


### `v1/mobile-app`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/mobile-app/waitlist` |


### `v1/monitoring`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/monitoring/incidents` |
| GET | `/api/v1/monitoring/providers` |
| GET | `/api/v1/monitoring` |
| GET | `/api/v1/monitoring/sync-history` |
| POST | `/api/v1/monitoring/uptime/check` |
| GET | `/api/v1/monitoring/uptime` |


### `v1/newsletter`

| Method(s) | Path |
|---|---|
| GET, POST | `/api/v1/newsletter/confirm` |
| POST | `/api/v1/newsletter/subscribe` |
| GET, POST | `/api/v1/newsletter/unsubscribe` |


### `v1/notifications`

| Method(s) | Path |
|---|---|
| PATCH | `/api/v1/notifications/{id}` |
| POST | `/api/v1/notifications/digest` |
| POST | `/api/v1/notifications/process` |
| POST | `/api/v1/notifications/read-all` |
| GET | `/api/v1/notifications` |


### `v1/platforms`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/platforms/ebay/search` |
| GET | `/api/v1/platforms` |


### `v1/pools`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/pools/{id}/join` |
| GET | `/api/v1/pools/{id}` |
| GET, POST | `/api/v1/pools` |


### `v1/predictions`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/predictions/{productId}` |
| GET | `/api/v1/predictions/accuracy` |
| GET, POST | `/api/v1/predictions/outcomes` |


### `v1/preferences`

| Method(s) | Path |
|---|---|
| GET, PUT | `/api/v1/preferences` |


### `v1/price-history`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/price-history/export` |


### `v1/price-index`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/price-index/export` |
| GET | `/api/v1/price-index` |


### `v1/price-protection`

| Method(s) | Path |
|---|---|
| PATCH, DELETE | `/api/v1/price-protection/{id}` |
| GET, POST | `/api/v1/price-protection` |


### `v1/prices`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/prices/refresh` |


### `v1/product-views`

| Method(s) | Path |
|---|---|
| GET, DELETE, POST | `/api/v1/product-views` |


### `v1/products`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/products/{slug}/budget-alternative` |
| GET | `/api/v1/products/{slug}/deals` |
| GET | `/api/v1/products/{slug}/merchants` |
| GET | `/api/v1/products/{slug}/prices` |
| GET, POST, PATCH | `/api/v1/products/{slug}/qa` |
| GET | `/api/v1/products/{slug}/review-summary` |
| GET, POST | `/api/v1/products/{slug}/reviews` |
| GET | `/api/v1/products/{slug}` |
| GET | `/api/v1/products/{slug}/similar` |
| GET | `/api/v1/products` |


### `v1/public`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/public/deals` |
| DELETE | `/api/v1/public/keys/{keyId}` |
| GET, POST | `/api/v1/public/keys` |
| GET | `/api/v1/public/prices` |
| GET | `/api/v1/public/products/{slug}` |
| GET | `/api/v1/public/products` |


### `v1/push`

| Method(s) | Path |
|---|---|
| POST, DELETE | `/api/v1/push/subscribe` |
| POST | `/api/v1/push/test` |
| GET | `/api/v1/push/vapid` |


### `v1/recommendations`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/recommendations` |


### `v1/referrals`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/referrals/attribute` |
| POST | `/api/v1/referrals/click` |
| POST, GET | `/api/v1/referrals` |


### `v1/retailers`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/retailers` |


### `v1/saved-calculations`

| Method(s) | Path |
|---|---|
| GET, POST, DELETE | `/api/v1/saved-calculations` |


### `v1/saved-searches`

| Method(s) | Path |
|---|---|
| GET, POST, PATCH, DELETE | `/api/v1/saved-searches` |


### `v1/savings`

| Method(s) | Path |
|---|---|
| GET, POST | `/api/v1/savings` |


### `v1/scan`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/scan` |


### `v1/search-history`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/search-history` |


### `v1/settings`

| Method(s) | Path |
|---|---|
| GET, POST | `/api/v1/settings/webhooks` |


### `v1/shared-wishlists`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/shared-wishlists/{id}` |


### `v1/smart-deals`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/smart-deals` |


### `v1/stores`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/stores` |


### `v1/subscriptions`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/subscriptions/checkout` |
| GET | `/api/v1/subscriptions/history` |
| POST | `/api/v1/subscriptions/portal` |
| GET, POST | `/api/v1/subscriptions` |


### `v1/tech-budget`

| Method(s) | Path |
|---|---|
| GET, POST | `/api/v1/tech-budget` |


### `v1/tools`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/tools/ai-qa` |
| GET | `/api/v1/tools/best-time` |
| GET, POST, PUT, DELETE | `/api/v1/tools/consumer-subscriptions` |
| GET, POST | `/api/v1/tools/digest` |
| GET, POST | `/api/v1/tools/eco-coach` |
| GET, POST | `/api/v1/tools/expenses` |
| GET | `/api/v1/tools/forecast-explainer` |
| GET, POST | `/api/v1/tools/future-you` |
| GET, POST | `/api/v1/tools/list-optimizer` |
| GET, POST | `/api/v1/tools/planner` |
| GET | `/api/v1/tools/price-history` |
| GET, POST | `/api/v1/tools/smart-home` |
| POST | `/api/v1/tools/smart-home/webhook` |
| GET | `/api/v1/tools/trade-in` |
| GET, POST | `/api/v1/tools/warranty-claims` |


### `v1/tracking`

| Method(s) | Path |
|---|---|
| GET | `/api/v1/tracking` |


### `v1/translations`

| Method(s) | Path |
|---|---|
| GET, POST | `/api/v1/translations` |


### `v1/vault`

| Method(s) | Path |
|---|---|
| PATCH, DELETE | `/api/v1/vault/{id}` |
| GET, POST | `/api/v1/vault` |


### `v1/visual-search`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/visual-search` |


### `v1/warranty-plans`

| Method(s) | Path |
|---|---|
| GET, POST | `/api/v1/warranty-plans` |


### `v1/wishlist-polls`

| Method(s) | Path |
|---|---|
| POST | `/api/v1/wishlist-polls/{id}/vote` |
| GET, POST | `/api/v1/wishlist-polls` |


### `v1/wishlists`

| Method(s) | Path |
|---|---|
| DELETE | `/api/v1/wishlists/{id}/items/{itemId}` |
| GET, POST | `/api/v1/wishlists/{id}/items/external` |
| GET, POST | `/api/v1/wishlists/{id}/items` |
| GET, PATCH, DELETE | `/api/v1/wishlists/{id}` |
| GET, POST | `/api/v1/wishlists` |


### `webhooks/stripe`

| Method(s) | Path |
|---|---|
| POST | `/api/webhooks/stripe` |


---

## What this doc does not cover

- **Page routes (118 `page.tsx` files)** — see `project-summary.md` and the in-app `/docs` page.
- **The 36 AI tools** — see `app/tools/page.tsx` and `project-summary.md`.
- **`/api-docs` page** — covers 7 of 181 routes; this document supersedes it for API reference.
- **Request/response schemas** — not yet machine-generated. `docs/openapi.json` lists paths and methods only.
