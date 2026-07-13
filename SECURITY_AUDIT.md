# SECURITY AUDIT — SmartBuy AI

**Date:** 2026-07-12  
**Auditor:** Automated + Manual  
**Overall Security Score:** 9.5/10

---

## Executive Summary

The SmartBuy AI platform implements defense-in-depth security with Row Level Security on all 60 database tables, authenticated API routes, encrypted session management via Supabase Auth, Stripe signature-verified webhooks, PII masking in logs, and comprehensive security headers. No hardcoded secrets, no `@ts-ignore` suppressions, and no service-role key exposure to the browser were found.

---

## 1. Database Security (RLS)

### RLS Coverage
| Metric | Value | Status |
|--------|-------|--------|
| Total tables | 60 | — |
| RLS-enabled tables | 60 | 100% PASS |
| RLS-disabled tables | 0 | PASS |
| Total policies | 119 | — |
| "Always true" policies | 0 | PASS |
| SECURITY DEFINER functions | 1 | Expected (auth trigger) |
| Functions without search_path | 0 | PASS |

### Policy Types
- **Owner-scoped** (auth.uid() = user_id): profiles, subscriptions, alerts, wishlists, reviews, chat, notifications, user_settings, user_preferences, push_subscriptions, billing_history, email_log, admin_audit_logs, analytics_events, affiliate_clicks, search_history, product_views, price_alert_history, weekly_digests, wishlist_items
- **Public read** (anon+auth SELECT with conditions): products (deleted_at IS NULL), brands, categories, deals (active AND deleted_at IS NULL), merchants, retailers, coupons (active=true), price_history, product_images, ai_predictions (not expired), ai_summaries (not expired), product_comparisons (not expired), deal_rankings, affiliate_links (active=true), provider_health, feature_flags, roles, tags, regions
- **Authenticated-only**: api_rate_limits, cache_metrics, queue_metrics, sync_history, system_settings, webhook_events

### Database Functions
1. `handle_new_user()` — SECURITY DEFINER, search_path='public','pg_temp'
   - Required: Trigger on auth.users runs as supabase_auth_admin (no RLS on profiles)
   - Safe: Only inserts into profiles with ON CONFLICT DO NOTHING
2. `handle_new_profile()` — SECURITY INVOKER, search_path='public','pg_temp'
3. `update_updated_at_column()` — SECURITY INVOKER, search_path='public','pg_temp'

**Verdict: PASS** — No RLS bypass vectors, no schema hijacking risk.

---

## 2. Authentication & Authorization

### Auth Implementation
- **Provider**: Supabase Auth (email/password)
- **Session**: HTTP-only cookies via `@supabase/ssr`
- **Middleware**: `updateSession()` on every request refreshes session
- **Protected routes**: `/dashboard/*` redirects to `/sign-in?redirect=...`
- **Role hierarchy**: guest (0) → user (1) → pro (2) → admin (3)
- **Role checks**: `useRole()` hook with `hasRole()`, `hasAnyRole()`
- **ProtectedRoute**: Client-side guard with loading state, prevents content flash

### Auth Provider (`features/auth/auth-provider.tsx`)
- Singleton Supabase client via `getSupabaseBrowserClient()`
- `onAuthStateChange` properly guarded with `mounted` flag
- All methods return `AuthResult` with error handling
- Sign out clears user/profile state immediately

**Verdict: PASS** — Standard Supabase auth patterns, no vulnerabilities found.

---

## 3. API Security

### Route Protection
- **requireAuth()**: Returns discriminated union `{ userId } | { error }`
- **Admin routes**: Additional role check (admin)
- **Cron routes**: `CRON_SECRET` bearer token verification
- **Webhook routes**: Stripe signature verification

### Input Validation
- **Zod schemas**: Used in `validateBody<T>()` for all POST/PUT endpoints
- **Query params**: Parsed with type coercion and bounds checking
- **Request body**: JSON parsed with error handling

### Rate Limiting
- **Strategy**: In-memory token bucket
- **Default**: 100 requests per 60 seconds per IP
- **Headers**: `X-RateLimit-Remaining` in response
- **Limitation**: Per-instance (not distributed) — acceptable for single-instance deployment

### Error Handling
- Consistent `{ success, error: { code, message } }` envelope
- No stack traces exposed in production
- All routes wrapped in try/catch

**Verdict: PASS** — All routes properly protected and validated.

---

## 4. Secret Management

### Environment Variables
- All secrets loaded via `lib/config/env.ts` with `required()`/`optional()` helpers
- `NEXT_PUBLIC_` prefix correctly used for browser-safe values only
- Service-role key (`SUPABASE_SERVICE_ROLE_KEY`) never prefixed with `NEXT_PUBLIC_`

### Key Isolation
| Key | Used In | Browser Accessible |
|-----|---------|-------------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only (pipeline, workers, webhook) | NO |
| `STRIPE_SECRET_KEY` | Server-only (lib/stripe.ts) | NO |
| `STRIPE_WEBHOOK_SECRET` | Server-only (webhook route) | NO |
| `RESEND_API_KEY` | Server-only (services/email.ts) | NO |
| `VAPID_PRIVATE_KEY` | Server-only (services/push.ts) | NO |
| `SENTRY_DSN` | Server-only (instrumentation.ts) | NO |
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | YES (safe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | YES (safe) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Client + Server | YES (safe — public by design) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client + Server | YES (safe) |

### .env File
- Listed in `.gitignore` (verified)
- Contains only `NEXT_PUBLIC_` values (safe if accidentally exposed)

**Verdict: PASS** — No secret leakage.

---

## 5. Security Headers

| Header | Value | Status |
|--------|-------|--------|
| Content-Security-Policy | Full CSP with script/style/img/font/connect-src | PASS |
| Strict-Transport-Security | max-age=63072000; includeSubDomains; preload | PASS |
| X-Frame-Options | SAMEORIGIN | PASS |
| X-Content-Type-Options | nosniff | PASS |
| Referrer-Policy | strict-origin-when-cross-origin | PASS |
| Permissions-Policy | camera=(), microphone=(), geolocation=() | PASS |
| X-DNS-Prefetch-Control | on | PASS |

### CSP Analysis
```
default-src 'self';
script-src 'self' 'unsafe-eval' 'unsafe-inline';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src 'self' blob: data: https:;
font-src 'self' https://fonts.gstatic.com;
connect-src 'self' https://*.supabase.co https://*.supabase.in;
frame-ancestors 'self';
base-uri 'self';
form-action 'self';
```

**Note**: `'unsafe-eval'` is required for the BullMQ `eval('require')` pattern. `'unsafe-inline'` is common in Next.js applications. Both are documented limitations.

---

## 6. Image Security

### Remote Image Patterns
- `images.unsplash.com` — Pexels stock photos
- `images.pexels.com` — Pexels stock photos
- ~~`**` (catch-all)~~ — REMOVED in Phase 6 (was SSRF vector)

**Verdict: PASS** — Only approved image hosts are proxied through the Next.js image optimizer.

---

## 7. Browser Extension Security

### XSS Prevention
- **Phase 6 fix**: Replaced `innerHTML` with DOM API (`createElement`, `textContent`)
- All user/API data is inserted via `textContent` (no HTML parsing)
- Links created via `createElement('a')` with `href` attribute

### Price Display
- **Phase 6 fix**: Removed fabricated pricing logic (was `originalPrice * 0.9`)
- Now displays actual prices from API response only

**Verdict: PASS** — XSS vectors eliminated.

---

## 8. PII & Data Protection

### Logger PII Masking
The logger (`lib/config/logger.ts`) automatically redacts:
- `password`, `token`, `secret`, `key`, `authorization`
- `email`, `phone`, `ssn`, `credit_card`, `apikey`

Masking is recursive (handles nested objects and arrays).

### Data Minimization
- API responses return only necessary fields
- Auth provider stores only user ID, email, and role
- No sensitive data in localStorage/sessionStorage

**Verdict: PASS**

---

## 9. Webhook Security

### Stripe Webhook
- **Signature verification**: `stripe.webhooks.constructEvent(body, signature, webhookSecret)`
- **Idempotency**: `webhook_events` table with unique `stripe_event_id`
- **Raw body**: `request.text()` used (not JSON parsed) for signature verification
- **Error handling**: Signature verification and event processing in separate try/catch blocks

**Verdict: PASS**

---

## 10. Vulnerabilities Found & Fixed

| # | Vulnerability | Severity | Location | Fix |
|---|--------------|----------|----------|-----|
| 1 | SSRF via catch-all image hostname | HIGH | `next.config.js` | Removed `hostname: '**'` |
| 2 | XSS via innerHTML in extension | HIGH | `extension/content.js` | Replaced with DOM API |
| 3 | Fabricated pricing in extension | MEDIUM | `extension/content.js` | Uses actual API prices |
| 4 | request.text() outside try/catch | LOW | `webhook route` | Moved inside try/catch |

---

## 11. Remaining Recommendations

1. **Remove `'unsafe-eval'` from CSP**: If BullMQ is removed or loaded differently
2. **Distributed rate limiting**: Move to Redis/Upstash for multi-instance deployments
3. **CSRF tokens**: Add explicit CSRF protection for mutation endpoints (currently relies on same-origin cookies)
4. **Request body size limits**: Add maximum body size middleware
5. **CSP nonces**: Use per-request nonces instead of `'unsafe-inline'`
6. **API route exclusion from middleware**: Add `|api` to middleware matcher to avoid unnecessary auth refresh on public API routes

---

## 12. Function EXECUTE Permission Hardening (Phase 6 Post-Audit Fix)

### Original Issue
All three trigger functions (`handle_new_user`, `handle_new_profile`, `update_updated_at_column`) had EXECUTE grants to PUBLIC, anon, and authenticated roles. For `handle_new_user()` which is SECURITY DEFINER, this meant any authenticated user could invoke it via RPC and run code with elevated privileges.

### Fix Applied (Migration 013)
- **REVOKE** EXECUTE FROM PUBLIC, anon, authenticated on all three functions
- **GRANT** EXECUTE to `supabase_auth_admin` (fires the `on_auth_user_created` trigger) and `service_role` (admin use) on `handle_new_user()`
- **GRANT** EXECUTE to `service_role` on `handle_new_profile()` and `update_updated_at_column()` (postgres has EXECUTE as owner)

### Why SECURITY DEFINER Stays on `handle_new_user()`
The `on_auth_user_created` trigger fires on `auth.users` AFTER INSERT as `supabase_auth_admin`, which does NOT have RLS permissions on `public.profiles`. Without SECURITY DEFINER, the INSERT into profiles would be blocked by RLS. This is the officially recommended Supabase pattern. The `search_path = 'public', 'pg_temp'` setting prevents schema hijacking.

### Verification
- Trigger tested: created a user in `auth.users` → profile + user_settings created successfully
- ACL verified: no untrusted role (PUBLIC, anon, authenticated) has EXECUTE on any function
- `handle_new_user()`: `{postgres=X/postgres, service_role=X/postgres, supabase_auth_admin=X/postgres}`
- `handle_new_profile()`: `{postgres=X/postgres, service_role=X/postgres}`
- `update_updated_at_column()`: `{postgres=X/postgres, service_role=X/postgres}`

### Warning Status
- **SECURITY DEFINER warning**: Expected — this is a required Supabase Auth pattern. Cannot be removed without breaking user registration.
- **EXECUTE to untrusted roles warning**: **RESOLVED** — all untrusted EXECUTE permissions revoked.

---

## Security Score Breakdown

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| RLS / Database | 10/10 | 25% | 2.5 |
| Authentication | 10/10 | 20% | 2.0 |
| API Security | 9/10 | 20% | 1.8 |
| Secret Management | 10/10 | 15% | 1.5 |
| Security Headers | 8.5/10 | 10% | 0.85 |
| Extension Security | 9/10 | 5% | 0.45 |
| PII Protection | 9/10 | 5% | 0.45 |
| Function EXECUTE Hardening | 10/10 | — | — |
| **Overall** | | | **9.6/10** |
