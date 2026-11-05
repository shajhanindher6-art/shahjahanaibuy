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
