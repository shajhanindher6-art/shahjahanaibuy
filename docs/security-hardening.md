# Security hardening batch (2026-11-05)

User asked for Google-level hardening. Audit first, then this batch.
Honest framing: no site is 100% unhackable; what this batch does is
close the real gaps the audit found, in layers — the same layers
Google uses at this site's scale (headers, authz, rate limits,
secret hygiene, audit logging).

## Audit findings (what was already strong)

- Security headers in `next.config.js`: HSTS 2y + preload, CSP,
  X-Frame-Options SAMEORIGIN, nosniff, Referrer-Policy,
  Permissions-Policy (camera/mic/geo off).
- RLS enabled on 38+ tables with 156+ policies (migration 010):
  profiles are own-row only; admin audit logs are admin_id-scoped.
- Service-role key is server-only (`lib/supabase/service.ts`); no
  secret in any `NEXT_PUBLIC_*` variable.
- Stripe webhook verifies its signature (`constructEvent`).
- CRON_SECRET is fail-closed on `/api/v1/prices/refresh` and
  `/api/v1/alerts/check`.
- Webhook settings route uses `getUser()` + `user_id`-scoped updates.
- No `eval` / `new Function`; `dangerouslySetInnerHTML` only for
  JSON-LD and chart styles.

## Gap 1 (HIGH) — admin API routes did not verify the admin role

`/api/v1/admin/analytics`, `/audit-logs`, `/users` called
`requireAuth` only — any signed-in user passed. The admin page hid
itself client-side, but the API did not enforce anything. RLS
backstopped the worst case (a non-admin reading `profiles` got only
their own row; audit logs only their own `admin_id` rows), but the
API must enforce it itself.

**Fix — `lib/api/middleware.ts` `requireAdmin`:**
- Requires a session, then reads the caller's `profiles.role` via
  the service-role client. Fail closed: no session, no service
  client, no profile, or a non-admin role all return an error (401
  / 403 / 500) — never the user ID.
- Applied to all four admin routes. `affiliate-clicks` (which had
  its own inline copy of this check) now uses the shared helper;
  its data read still uses the service client.
- **New `app/admin/layout.tsx` (server component):** no session →
  `/sign-in`; signed in but not admin → `/dashboard`. The admin
  shell no longer renders for non-admins at all.

## Gap 2 (MEDIUM) — rate limiting existed but was applied nowhere

`checkRateLimit` / `rateLimitResponse` in `lib/api/middleware.ts`
(in-memory per-IP token bucket) were defined and exported but no
route called them. Public POSTs could be flooded, including
`scan` (each call spends a SerpAPI credit).

**Fix — per-IP caps (60s window), applied before any work:**
- `deal-finder` 20/min, `scan` 10/min, `gifts` 30/min,
  `comparison` 30/min, `affiliate/transform` 30/min,
  `affiliate/geo-click` 60/min (in front of the existing host
  validation + burst flagging; the fail-open beacon contract is
  unchanged — over the limit it answers 429 instead of tracking).
- `getClientIp` helper: first `x-forwarded-for` entry, else
  `x-real-ip`, else `unknown`. It is a bucket key for abuse
  control, never an identity proof (proxies can spoof it).
- **Honest limit:** the bucket is in-memory, so it is per
  server instance and resets on redeploy. A distributed
  (Redis/Upstash) limiter is the Phase 2 step; it needs an owner
  account and is not in this batch.

## Gap 3 (LOW) — JSON-LD `</script>` breakout

`JSON.stringify` does not escape `<`, so a `</script>` sequence
inside product data would close the JSON-LD script element. Product
data is owner-seeded today (not user input), so exploitability was
low — but the fix is one line and always correct.

**Fix — `lib/json-ld.ts` `toJsonLd`:** `JSON.stringify(value)`
with every `<` replaced by `\u003c` (valid JSON, unescapable).
Applied in `app/layout.tsx` and `app/products/[slug]/page.tsx`.

## Gap 4 (LOW) — cookies without the secure flag

**Fix — `middleware.ts`:** `sb-country` and `sb-language` now set
`secure: true` in production (HTTPS-only Vercel). Local dev stays
non-secure, where a secure cookie would never be set. (`httpOnly`
was deliberately NOT added: the region provider reads these
cookies client-side.)

## Phase 2 — distributed rate limiting (Upstash Redis)

**Why:** the in-memory bucket is per server instance. A live burst
test proved it: 31 rapid transform calls, 0 × 429 — Vercel spreads
requests across instances, so no single instance saw 30 calls.

**What changed:**
- Installed `@upstash/redis` + `@upstash/ratelimit` (free tier,
  REST — no persistent connection, serverless-safe).
- New `lib/api/rate-limit.ts`: a shared sliding-window limiter
  (`Ratelimit.slidingWindow`, prefix `sb-ratelimit`) over one Redis
  client. `windowMsToDuration` converts the existing 60s windows.
- `rateLimitResponse` (middleware) is now async: Redis first when
  `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set;
  any Redis error falls back to the in-memory bucket (fail-open —
  a limiter outage never blocks legitimate traffic); unconfigured
  → in-memory, exactly as before. All 6 public POST routes now
  `await` it (same limits: deal-finder 20, scan 10, gifts /
  comparison / transform 30, geo-click 60 per minute per IP).
- Env vars added to `lib/config/env.ts` (optional) and
  `.env.example` (blank placeholders only — never commit real
  values).
- Only counter keys are stored in Redis
  (`sb-ratelimit:<identifier>`); no IPs are logged by this module.

**Owner steps to activate (code alone cannot do this):**
1. https://console.upstash.com → sign up (free) → Create Database
   → type Redis → region closest to the users (e.g. EU / US) →
   Create.
2. On the database page, copy **REST URL** (`UPSTASH_REDIS_REST_URL`)
   and **REST Token** (`UPSTASH_REDIS_REST_TOKEN`) from the REST API
   section.
3. Vercel → project → Settings → Environment Variables → add both
   (Production scope) → **Redeploy** (env vars only apply after a
   new deployment).
4. Verify live: 31 rapid transform POSTs must then return 30 × 200
   + 1 × 429. Until then the in-memory bucket stays in effect.

**Verification (code side):** tsc 0, production build pass.
Logic tests on the real compiled modules (4/4 PASS): duration
conversion, unconfigured → client null + distributed check null,
`rateLimitResponse` falls back to in-memory and still returns 429
after the limit, per-identifier isolation. The Redis path itself
cannot be tested without real Upstash credentials — it is verified
live after the owner sets them (step 4 above).

## Phase 2 — CSP tightening (nonce-based script-src)

**Why:** the old CSP allowed `script-src 'unsafe-inline' 'unsafe-eval'`,
which lets any injected inline script or eval() run — the main XSS
hole left after the batch above.

**What changed:**
- NEW `lib/csp.ts` `buildCsp(nonce)`: `script-src 'self' 'nonce-<uuid>'`
  only — no `unsafe-inline`, no `unsafe-eval`.
- `middleware.ts` generates one fresh nonce per request
  (`crypto.randomUUID()`), sets it as the `x-nonce` request header
  BEFORE `updateSession` (Next.js applies it to its own inline
  scripts), and sets the CSP response header. The CSP header moved
  OUT of `next.config.js` (a static header cannot carry a nonce);
  all other security headers stay there.
- The nonce is threaded to the app: root layout reads `x-nonce` via
  `headers()` → `Providers nonce={...}` → `NonceProvider`
  (`components/csp-nonce-context.tsx`). The layout's JSON-LD script
  and the product page's JSON-LD script (client component, reads the
  nonce via `useNonce()`) both carry `nonce={...}`.
- `next-themes` also renders an inline theme script (prevents a
  dark/light flash). Its `ThemeProvider` accepts a `nonce` prop —
  threaded through `components/providers/theme-provider.tsx`.
- `style-src` KEEPS `'unsafe-inline'` BY DESIGN: React renders
  `style={{...}}` props as style attributes, and CSP has no nonce
  mechanism for style attributes — removing it would break inline
  styles (e.g. the dashboard's staggered animation delays). This
  matches the official Next.js strict-CSP example.
- `eval('require')` in `lib/workers/queue.ts` is server-side only;
  CSP does not apply to it.

**Verification (local prod server, curl on the built output):**
- tsc 0, production build pass.
- CSP header: exactly 1, `script-src 'self' 'nonce-<uuid>'`, no
  `unsafe-inline`/`unsafe-eval` in script-src; all other security
  headers still present.
- Homepage: 24/24 `<script>` tags carry the header nonce, 0 bare
  scripts, 1 distinct nonce value; 0 inline event handlers;
  JSON-LD script and the next-themes theme script both nonced.
- /gifts: 20/20 scripts nonced, 0 bare.
- NOT verifiable by curl: the product page's JSON-LD (client
  component, renders after hydration) — verify in a live browser
  after push: product page renders, no CSP console errors.
- **Lesson (do not repeat):** `pkill -f "next-server"` killed the
  exec's own shell because the pattern matched its own command
  line — kill the server by PID (from `ss -ltnp`) instead.

## Deliberately NOT in this batch

- **CSP nonce tightening** (removing `'unsafe-eval'` /
  `'unsafe-inline'` from `script-src`): needs per-request nonces
  in middleware + config; a wrong move breaks the site's inline
  scripts. Phase 2, with a live test after deploy.
- **Dormant `affiliate/click` route:** unauthenticated POST, but
  unwired and its writes already fail (table needs
  `affiliate_link_id` + authenticated INSERT). Left untouched.
- **Unauthenticated read-only POSTs** (`deal-finder`, `scan`,
  `gifts`, `comparison`, `transform`) stay public by design; they
  are now rate-limited instead.

## Owner dashboard steps (code cannot do these)

- Supabase Auth → enable **email confirmation** (currently
  `NEXT_PUBLIC_ENABLE_EMAIL_VERIFICATION=false`: anyone can
  register with any email), enable **leaked-password protection**,
  and turn on **MFA/2FA** for the admin account.
- Confirm **migration 010** (security-fix RLS) is actually applied
  on the live database — the admin-route safety partly relied on it
  before this batch.
- Admin accounts (GitHub / Vercel / Supabase) should use strong
  unique passwords + 2FA.

## Verification

- `tsc --noEmit`: 0 errors.
- Production build (placeholder env): pass (101 pages). The
  `requireAuth failed` lines in the build log are the static
  generator probing the admin routes without a session — they
  return 401 as designed.
- Logic tests on the real compiled `lib/json-ld.ts` +
  `lib/api/middleware.ts` (6/6 PASS): `</script>` escaping with
  JSON round-trip, rate-limit allow/block per bucket, per-identifier
  isolation, 429 response shape, client-IP parsing.
- Live verification after push: logged-out GET on the admin
  endpoints must return 401; a signed-in non-admin must get 403
  (needs a non-admin test account — none exists yet, read-only
  constraint unlifted). Rate-limit behaviour can be probed
  logged-out (e.g. 11 rapid scan calls → the 11th is 429).

## Round 2 — Deep audit (2026-11-05)

A read-only deep audit (subagent) found what Round 1 missed: **0 Critical,
3 High, 5 Medium, 6 Low**. Honest score reassessment: **~78** (Round 1's ~82
had assumed the catalog RLS was sound — it was not). Fixing everything
code-fixable below + 2FA → **~88 on the free tier**.

### High

- **H1 — Catalog RLS wide open (migration 010).** `products`,
  `merchant_products`, `price_history`, `deals`, `coupons`, `merchants`,
  `brands`, `categories`, `countries`, `currencies`, `data_sources`,
  `languages`, `product_attributes`, `product_images`, `product_sources`,
  `product_tags`, `product_variants`, `regions`, `retailers`,
  `review_sources` (and system tables: `system_settings`,
  `feature_flags`, `api_rate_limits`, `affiliate_links`,
  `affiliate_clicks`, `providers`, `provider_health`, `sync_history`,
  `queue_metrics`, `cache_metrics`, `deal_rankings`, `roles`, `tags`)
  all had `TO authenticated WITH CHECK (true)` write policies — any
  self-registered user could rewrite the public catalog with the anon
  key + their JWT. Fix: `supabase/migrations/20261105190000_017_admin_only_catalog_writes.sql`
  (38 tables, 114 policies) — writes now require
  `profiles.role = 'admin'` via a `public.is_admin()` SECURITY DEFINER
  helper. SELECT policies untouched. **Owner step: run the file in the
  Supabase SQL Editor (Ctrl+A, Run) + verify with its final SELECT.**
  Verified safe: catalog writers use the service-role client (RLS
  bypass); community deals write to `community_deals`, not `deals`.
- **H2 — `POST /api/v1/data/refresh` injected mock products.**
  `requireAuth` only, no rate limit, and `MockProvider.isAvailable()`
  always returned true with a synchronous inline queue — any signed-in
  user could insert fake products into the live catalog. Fix: route is
  now `requireAdmin` + 10/min rate limit, and `MockProvider` is only
  registered when `NODE_ENV !== 'production'` (in production with no
  real provider, the job fails cleanly with "No available provider").
- **H3 — Next.js 13.5.1 is EOL (36 OSV advisories).** Includes the
  middleware auth bypass CVE-2025-29927 (CVSS 9.1, fixed in 13.5.9)
  and two unauthenticated image-optimizer RCEs (fixed only in 16.x).
  Fix step 1 in this batch: `next` 13.5.1 → **13.5.9** (patch bump,
  closes the middleware bypass; applicability here is reduced — no
  authorization lives in this app's middleware). Step 2 (major upgrade
  to 15/16) is a separate project, not a patch.

### Medium

- **M1 — `notifications/digest` + `notifications/process` CRON_SECRET
  fail-OPEN.** `if (cronSecret)` meant anyone could call them when the
  secret was unset — and `process` sends email/WhatsApp/Telegram.
  Fix: fail-closed, same pattern as `prices/refresh` + `alerts/check`.
- **M2 — Rate limits bypassable via spoofed `X-Forwarded-For`.**
  `getClientIp()` trusted the first forwarded entry, which any client
  can forge. Fix: prefer `x-real-ip` (set by Vercel to the true client
  IP); forwarded-for is only a non-Vercel fallback.
- **M3 — No error monitoring or alerting.** `@sentry/nextjs` is not
  installed; `app/error.tsx` silently falls back to console-only.
  Fix needs an owner step: free-tier Sentry account + install
  `@sentry/nextjs` + init (not in this batch — no account exists yet).
- **M4 — `ai_predictions` / `ai_summaries` / `product_comparisons` /
  `admin_audit_logs` writable by any authenticated user (migration
  011).** Fix: covered by the 017 migration (admin-only writes).
  Known behaviour: the public ai-summary/predictions routes cache
  through the session client fire-and-forget, so after the migration
  the cache write only persists when an admin views the product —
  reads and on-the-fly computation are unaffected (already the case
  for logged-out visitors today).
- **M5 — Open redirect on sign-in.** `?redirect=` was pushed
  unvalidated. Fix: `lib/utils/safe-redirect.ts` (`isSafeRedirectPath`
  — same-origin paths starting with a single `/` only) + sign-in page
  falls back to `/dashboard` otherwise.

### Low

- **L1 — Dormant `/api/v1/affiliate/click`: almost harmless.**
  Verified: anonymous inserts already fail (migration 015), the FK
  needs a real link id, the `increment_affiliate_clicks` RPC does not
  exist, and nothing reads the table. Left as-is (lowest priority);
  its writes are now admin-only via the 017 migration anyway.
- **L2 — Public monitoring endpoints** (`/api/v1/monitoring`,
  `/providers`, `/sync-history`) leaked internal ops data. Fix:
  `requireAdmin` on all three.
- **L3 — `Secure` flag lost on client-side cookie overwrite.**
  Middleware sets it, but `region-provider.tsx` rewrote `sb-country` /
  `sb-language` without it. Fix: append `; Secure` when
  `location.protocol === 'https:'`.
- L4 (zod advisory — not exploitable here), L5 (`eval('require')` in
  the worker queue — server-side static string, not exploitable), L6
  (`chart.tsx` style injection — developer-controlled config only):
  no change, noted for the record.

### Verified clean in Round 2 (no finding)

No hardcoded secrets; no `fetch()` to user-supplied URLs (`/scan`
hands the image URL to SerpAPI, which fetches it — not our server);
only three `dangerouslySetInnerHTML` uses, all safe (escaped JSON-LD
×2, developer-only chart config); no stack traces or DB errors
returned to clients; no CORS anywhere; no public storage buckets;
Stripe webhook signature verified; checkout plan allowlisted
server-side; IDOR spot-checks pass (alerts/vault ownership enforced).

### Caveat — migration files contradict each other

Migration 015 restricts `merchant_products` SELECT to `authenticated`,
yet the live site serves it logged-out — so the live DB does not
exactly match the file chain. Every RLS finding above is "per the
migration files, if that policy is live". **Owner step: confirm the
live policies** (the 017 file's verification SELECT + Supabase
dashboard → Authentication → Policies) after running it.

### Still open after Round 2

- 2FA on the admin account (owner redo — verified OFF 2026-11-05).
- Sentry free account + install (M3).
- Next.js 15/16 major upgrade (closes the image-optimizer RCEs,
  nonce-XSS, DoS/cache-poisoning cluster).
- Leaked-password protection (Pro-only), WAF/bot protection, pen test
  (paid) — these cap the free-tier score at ~88.

## Section 18 — Auth-cookie trade-off (audit §1 #52)

**Current state (verified 2026-11-12, code-read, not assumed):**
the repo passes NO custom `cookieOptions` anywhere (grep: 0 hits).
Auth session cookies are set by `@supabase/ssr@0.12.7` with its
defaults:

- `path: '/'`
- `sameSite: 'lax'`
- `httpOnly: false`
- `maxAge: 400d` (~13 months)
- NO `Secure` flag set by the library (see below for why that is
  not the hole it looks like)

The repo's own cookies (`sb-country`, `sb-language`) are different
and already correct: `sameSite: lax` + `secure: true` in production
(see Gap 4 above; the client-side rewrite in `region-provider.tsx`
also appends `; Secure` on HTTPS).

**Why `httpOnly: false` is deliberate, not an oversight:**
Supabase's browser client (`@supabase/ssr` client-side) reads the
session from the cookie itself — that is how `getSession()` works
without a server round-trip on every navigation. Setting
`httpOnly: true` would hide the cookie from JavaScript and break
every client-side session read: the app would behave as signed
out in the browser while the server still saw a valid session.
This is Supabase's documented default for exactly that reason,
and the audit's own wording agrees ("`httpOnly: false` is
Supabase's deliberate default — the browser client reads the
cookie"). The audit classifies flipping it blindly as REJECTED
(§12 rejected item 15).

**Why the missing `Secure` flag is low-risk in practice:**
Vercel serves this site HTTPS-only, and the HSTS header is
`max-age=63072000; includeSubDomains; preload` on `/(.*)` — a
browser that has ever visited the site will not send the cookie
over plain HTTP. The residual exposure is a first-ever visit
over HTTP before the HSTS preload kicks in, or a non-preloaded
client. The cookie is also `SameSite=lax`, so it is not sent on
cross-site POSTs (the CSRF backstop for cookie-authed mutations).

**What would break if `httpOnly` were flipped:**
- Client-side `getSession()` / `onAuthStateChange` reads fail →
  the header, dashboard shell, and every `useAuth()` consumer
  render signed-out state while server routes still see the
  session (split-brain auth).
- The `/auth/callback` exchange and the `SIGNED_IN` guest-merge
  funnel (Section 12, Chunk B) run client-side and would stop
  seeing the fresh session.
- Any code that reads the cookie directly (region/language
  providers are separate cookies and unaffected, but the auth
  flow is not).

**What proof would be needed BEFORE any change:**
1. A staging deployment with the flag flipped, proving: sign-in,
   sign-up, Google OAuth callback, session refresh, sign-out,
   and the guest → signed-in merge all still work end-to-end in
   a real browser (not jsdom — the failure mode is a browser
   cookie read).
2. Confirmation from Supabase's current `@supabase/ssr` docs that
   a server-only session pattern is supported for this app's
   usage (all client reads replaced by server reads or a
   dedicated session endpoint) — i.e. the app no longer needs
   the browser client to read the cookie at all.
3. A live recheck after deploy: an authenticated browser session
   survives a full navigation + a hard refresh.
Until all three exist, the correct action is this document, not
a flag flip. No cookie flag was changed in Section 18.
