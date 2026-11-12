# SmartBuy AI — Deployment Documentation

**Last updated:** 2026-11-12 (Section 17, Stage I — full rewrite)
**Live site:** https://shahjahanaibuy-b1zp.vercel.app/
**Repo:** https://github.com/shajhanindher6-art/shahjahanaibuy (branch `main`)

> This document supersedes all earlier deployment notes in this repo. The root July 2026 docs (`DATABASE_SCHEMA.md`, `LAUNCH_CHECKLIST.md`, etc.) are frozen historical snapshots and their numbers (13 migrations, 60 tables, 57 routes, 99 tests) are stale — do not use them. Current numbers live in `project-summary.md`.

## Deployment model

- **Hosting: Vercel. Deploy = git push to `main`.** There is no `vercel.json` (no Vercel Cron, no custom headers, no build overrides).
- **Verification gate before every push:** `npx tsc --noEmit` = 0 errors · full `npx vitest run` = 100% pass · clean `next build` · headless smoke · live recheck after push. **Push only on the user's live approval** (standing rule).
- **GitHub workflow files** (`.github/workflows/*`) cannot be pushed by the GitHub App (403) — workflow changes go via the GitHub website.
- **Baseline (12 Nov 2026, Section 17 gate):** tsc 0 · vitest 216 files / 2,685 tests, 100% PASS · clean build exit 0, 799 pages, `/products/[slug]` First Load 330 kB (budget ≤350 kB).

## Deployment checklist

### Pre-deployment
- [ ] All environment variables configured in Vercel (see below; only 2 are truly required)
- [ ] Production build passes with zero TypeScript errors (`npm run build`, `npm run typecheck`)
- [ ] Full test suite passes (`npm test`)
- [ ] Supabase migrations verified/applied per the migration section below — **never apply a migration without the owner's explicit approval for that migration**
- [ ] RLS policies verified on all tables
- [ ] Stripe webhook endpoint registered in the Stripe Dashboard (test mode first)
- [ ] Resend API key configured + sending domain verified (for email delivery)
- [ ] VAPID key pair generated (for push notifications)
- [ ] Domain DNS configured (A record, CNAME, MX for email)
- [ ] SSL/TLS certificate active

### Deployment steps
1. Set all environment variables in Vercel (Production)
2. Build: `npm run build`
3. Push to `main` (Vercel deploys automatically) — only with the user's live approval
4. Verify health endpoint: `GET /api/v1/health`
5. Test authentication flow (sign up, sign in, sign out)
6. Test Stripe checkout flow (test mode)
7. Test email delivery (welcome email on sign up)
8. Submit sitemap to Google Search Console
9. Register service worker (verify in browser DevTools)
10. Verify the cron-job.org jobs exist and fire (see "Cron jobs" below)

### Post-deployment verification
- [ ] `https://shahjahanaibuy-b1zp.vercel.app/api/v1/health` returns `healthy`
- [ ] Sign up creates profile + user_settings
- [ ] Email verification arrives (if enabled)
- [ ] Dashboard loads with recommendations
- [ ] AI search returns results
- [ ] Product detail page loads with price chart
- [ ] Stripe checkout redirects to Stripe (test mode only)
- [ ] Stripe webhook processes events (check `webhook_events` table)
- [ ] PWA installable on mobile (check manifest + icons)
- [ ] Offline page loads when network disconnected
- [ ] Sitemap accessible at `/sitemap.xml`
- [ ] Robots accessible at `/robots.txt`
- [ ] Unknown slugs return real 404s: `/products/unknown-slug-xyz`, `/brands/unknown-slug-xyz`, `/categories/unknown-slug-xyz`, `/live/unknown-slug-xyz` (note: `/creators/unknown-slug-xyz` returns 200 until migration 044 is applied — expected, not a failure)

---

## Environment variables

Only **2 variables are truly required** — the app throws at import without them. Everything else is optional/nullable and degrades to an honest 503 or a disabled feature. Never put a real secret in `.env.example` or in git; real values go only in the Vercel dashboard (or the owner's service dashboards). The complete list with placeholders is `.env.example`.

### Required (app will not start without these)
| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | `eyJ...` |

### Optional / fail-closed — service-role key
| Variable | Description | Example |
|----------|-------------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server only). **Optional, fail-closed:** without it the app still starts; service-role-dependent routes (admin writes, account deletion, webhooks) return 503 instead of silently running as anon. | `eyJ...` |

### Stripe
| Variable | Description | Example |
|----------|-------------|---------|
| `STRIPE_SECRET_KEY` | Stripe API secret key — start with `sk_test_...` | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | `whsec_...` |
| `STRIPE_PREMIUM_PRICE_ID` | Price ID for Premium plan | `price_...` |
| `STRIPE_FAMILY_PRICE_ID` | Price ID for Family plan (optional) | `price_...` |
| `STRIPE_TEAM_PRICE_ID` | Price ID for Team plan (optional) | `price_...` |
| `STRIPE_STARTER_PRICE_ID` | Price ID for Starter plan (optional, off by default) | `price_...` |
| `STRIPE_TRIAL_DAYS` | Free-trial length in days (optional, default 0 = no trial) | `0` |
| `STRIPE_LIVE_LAUNCHED` | **The sole live-money gate (see below).** `true` only as part of a deliberate live launch. | `true` |

Do **not** use `STRIPE_PRO_PRICE_ID` — it is a deprecated alias for `STRIPE_PREMIUM_PRICE_ID` kept only for backwards compatibility in `lib/config/env.ts`. Set `STRIPE_PREMIUM_PRICE_ID` instead.

**Premium price: $9.99/month is the planned price, not a live charge.** Payments are NOT live: Stripe is in test mode and no paid plan can be bought today (`/pricing` says so on the site). The live price decision ($1 vs $4.99 vs $9.99) is the owner's and has not been made.

#### Stripe live launch — the double gate (read this before touching live keys)

A live secret key (`sk_live_...`) alone **never** enables charges. Live mode counts as launched only when **both** are true:

1. `STRIPE_SECRET_KEY` starts with `sk_live_`, **and**
2. `STRIPE_LIVE_LAUNCHED=true` is set in the hosting dashboard.

This is enforced in `lib/stripe.ts` (`isStripeLiveLaunchApproved()`, `isStripeLiveModeBlocked()`): checkout and portal routes refuse with **503 + a loud log** when a live key is configured but the launch flag is not set — never silently taking real money. Before setting the flag, complete the live launch checklist: live keys + webhook secret in Vercel, live Price IDs, test checkout in live mode with a real card flow rehearsed, refund/dunning behaviour confirmed (an `invoice.payment_failed` handler exists — `handleInvoicePaymentFailed` in `services/stripe.ts` marks the subscription past-due and logs the retry context; Stripe's automatic retries keep running), and the price decision made. **Stripe stays in TEST mode for Section 17 — no live activation.**

### Email (Resend)
| Variable | Description | Example |
|----------|-------------|---------|
| `RESEND_API_KEY` | Resend API key | `re_...` |
| `EMAIL_FROM_ADDRESS` | From email address (must be on a verified domain; `RESEND_FROM` is accepted as an alias, `EMAIL_FROM_ADDRESS` wins) | `noreply@yourdomain.com` |
| `EMAIL_FROM_NAME` | From display name | `SmartBuy AI` |

Without `RESEND_API_KEY`, email sends fail closed (`{success:false}`); newsletter subscribe returns 503 until migration 036 is applied live.

### Push notifications (VAPID)
| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | VAPID public key | `BPq...` |
| `VAPID_PRIVATE_KEY` | VAPID private key | `Dh...` |

Wired but dormant without keys. Generate once (`npx web-push generate-vapid-keys`), store in Vercel, never commit.

### Cron
| Variable | Description | Example |
|----------|-------------|---------|
| `CRON_SECRET` | Secret for cron endpoint auth (strong random string, ≥32 chars). Sent as `Authorization: Bearer <CRON_SECRET>`. | `your-secret-string` |

### Smart-home webhook
| Variable | Description | Example |
|----------|-------------|---------|
| `SMART_HOME_WEBHOOK_SECRET` | Shared secret for the smart-home webhook receiver (≥16 chars). Unset → the webhook returns 503. | `your-secret-string` |

### App configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_APP_URL` | Public app URL (no trailing slash) | `https://shahjahanaibuy-b1zp.vercel.app` (fallback in `lib/config/app.ts` when unset) |
| `NEXT_PUBLIC_ENABLE_EMAIL_VERIFICATION` | Require email verification | `false` |
| `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH` | Offer Google sign-in | `true` |

Note: `NEXT_PUBLIC_SITE_URL` is **not read by the code** — use `NEXT_PUBLIC_APP_URL`. The `enableGoogleAuth` / `enableEmailVerification` flags in `lib/config/env.ts` ARE read — into flag defaults by `services/feature-flags.ts:15-16,49-50` (`isFeatureEnabled` / `getAllFeatureFlags`) — but no caller in `app/` / `features/` / `components/` consults the resulting flags, so the flags gate nothing in practice: Google sign-in is always offered, and email confirmation is governed by the Supabase dashboard, not code.

### Creators, price lock & translations (all optional)

| Variable | Description | Default / example |
|----------|-------------|-------------------|
| `CREATOR_REVENUE_SHARE_PERCENT` | Revenue-share percent used by the creator-rewards wiring (`lib/creator-rewards.ts`). A plain number 0–100 (no `%` sign); unset, non-numeric, or out-of-range → unconfigured (`null`). No payouts happen — this only configures the share math. | Unset = not configured · e.g. `20` |
| `PRICE_LOCK_ENABLED` | Enables the price-lock config (`lib/price-lock.ts`). Only the exact string `true` enables it; anything else (including unset) = disabled. When enabled, eligible tiers are Premium/Family/Team with a 30-day guarantee window; Stripe must still be configured for it to mean anything. | `false` · e.g. `true` |
| `TRANSLATION_PROVIDER_ENDPOINT` | External translation provider endpoint (`lib/product-translations.ts`). Read together with `TRANSLATION_PROVIDER_API_KEY` — **both must be set** or the provider is `null` (dormant: no calls, no silent fallback to a hard-coded service). The provider POSTs `{ text, target }` and is expected to return `{ translatedText }`. | Unset = dormant · e.g. `https://your-translation-provider.example/translate` |
| `TRANSLATION_PROVIDER_API_KEY` | API key for the translation provider above. Same all-or-nothing rule: without the endpoint it does nothing. Set the real key only in the hosting dashboard, never here or in git. | Unset = dormant · e.g. `your-provider-api-key` |

### Monitoring & analytics (all optional)
| Variable | Description | Example |
|----------|-------------|---------|
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN (server / client). SDK stays dormant until a DSN is set. | `https://...@sentry.io/...` |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | Only needed for source-map upload at build time | — |
| `LOG_LEVEL` | Logging level | `info` |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` | PostHog analytics (dormant until a key is set AND the visitor accepts analytics in the cookie banner) | `https://us.i.posthog.com` |
| `NEXT_PUBLIC_GA4_ID` | Google Analytics 4 measurement ID (`G-...`) | `G-XXXXXXXXXX` |
| `NEXT_PUBLIC_META_PIXEL_ID` | Meta Pixel ID | — |

### eBay (all owner-gated)
| Variable | Description | Example |
|----------|-------------|---------|
| `EBAY_CLIENT_ID` | eBay developer app client ID | — |
| `EBAY_CLIENT_SECRET` | eBay developer app client secret | — |
| `EBAY_MARKETPLACE_ID` | eBay marketplace, e.g. `EBAY_US` (default when unset) | `EBAY_US` |

Without the client ID + secret, every eBay call returns a fail-closed error and the eBay intake/refresh legs are inert. Note: `EBAY_ENVIRONMENT` is **not read by the code** — do not set it expecting an effect. The eBay pipeline also needs an `ebay` row in the live `merchants` table (no seed creates it) and migration 041 for daily-cap tracking.

### Search, visual search, storage, messaging (all optional)
| Variable | Description |
|----------|-------------|
| `SERPAPI_API_KEY` | SerpAPI Google Shopping fallback (~100–250 searches/month free; results cached 7 days). Unset → search is catalog-only. |
| `HF_API_TOKEN` | Hugging Face token for visual search. Unset → `POST /api/v1/visual-search` returns 503. |
| `CLOUDFLARE_R2_ACCOUNT_ID` / `CLOUDFLARE_R2_ACCESS_KEY_ID` / `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Cloudflare R2 storage. (The bare `R2_*` names are not read by code — use the `CLOUDFLARE_R2_*` names.) |
| `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_TEMPLATE_NAME` | WhatsApp alerts (needs a Meta Business app + approved template). Unset → channel reports `not_configured`, never a fake "sent". |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram alerts (bot token from BotFather). |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis for distributed rate limiting. Unset → per-instance in-memory buckets (partial protection on serverless). |
| `AMAZON_ASSOC_TAG` (+ `AMAZON_ASSOC_TAG_<CC>` per locale, e.g. GB, DE, JP) | Amazon Associates tags. US visitors use the base tag; other countries need their own override. `AMAZON_ASSOC_TAG_US` is never read (silently ignored). Tag `smartbuy-20` is live via Vercel env; approved vs placeholder is unknown — only the Associates dashboard can confirm. |
| `SKIMLINKS_PUBLISHER_ID` | Skimlinks publisher ID. Not configured; do NOT apply for Skimlinks without the owner's explicit go-ahead (rejection blocks reapplying for 90 days). |
| `OPENAI_API_KEY`, `REDIS_URL`, `APIFY_API_TOKEN` / `APIFY_ACTOR_ID` | Present in `.env.example` for reference only. **Apify must stay unset** — scraping is a hard rule; the provider is fail-closed by design. |

Dead/phantom references (mentioned in old docs, never read by code): `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, bare `VAPID_PUBLIC_KEY`, `AFFILIATE_BEACON_SECRET` (proposed, never implemented).

---

## Migrations (51 files — not 12)

`supabase/migrations/` holds **51 files** (001–053, gaps 024/025/046 — 023 exists — plus the unnumbered `20260718060823_fix_anonymous_access_policies.sql`). 123 `CREATE TABLE` statements, 122 distinct tables, every table RLS-enabled.

**Applied status of every migration is UNKNOWN from the repo** — only the owner can check `supabase_migrations.schema_migrations` in Supabase. Two are proven NOT applied live: **033** (`live_shopping_sessions` table missing — proven by a PGRST205) and **044** (`creator_slugs` view — applying it activates `/creators` 404s with no redeploy).

### Rules
- **Never apply a migration without the owner's explicit approval for that migration.**
- **17 files carry "DO NOT APPLY YET" (035–043, 045, 047–053).** In particular, **never apply 035 without a separate explicit review** (standing rule).
- **Never apply the unnumbered `supabase/migrations/20260718060823_fix_anonymous_access_policies.sql` as-is** — it restricts public catalogue reads to authenticated users and would break the public site.
- Apply in filename order. 022 and 023 share the timestamp prefix `20261109124500_` — order by full filename.
- Preconditions: **018 needs `add-smartpools.sql` first** (it alters the `pools` table); **031 needs `add-community-deals.sql` first** (hard FK to `community_deals`); 038 needs 026; 042 needs 039; 037 needs the commented cleanup UPDATE + VALIDATE after applying.

### The 10 `add-*.sql` files — run only the subset you need

`supabase/add-*.sql` are owner-run SQL files, **not** migrations. Do **not** run all of them. Run only the ones the feature you are enabling needs:

| File | Needed for |
|---|---|
| `add-affiliate-geo-clicks.sql` | Geo affiliate click tracking |
| `add-alert-webhooks.sql` | Alert webhooks |
| `add-clip-embeddings.sql` | Visual search (CLIP embeddings) |
| `add-community-deals.sql` | Community deals — **required before migration 031** |
| `add-country-stores-directory.sql` | Stores directory (84 stores) |
| `add-external-wishlist-items.sql` | External wishlist items |
| `add-public-wishlist-sharing-rls.sql` | Public wishlist sharing |
| `add-receipt-vault.sql` | Receipt vault |
| `add-smartpools.sql` | SmartPools — **required before migration 018** |
| `add-visual-embeddings.sql` | Visual search (visual embeddings) |

Other `.sql` scripts in `supabase/` (seed/repair/diagnostic) are not part of deployment — never re-run the full seed.

### Admin setup
1. Sign up at `/sign-in`.
2. Grant the admin role in Supabase (the role lives in the `roles` table, linked via `profiles.role_id`):
   ```sql
   UPDATE profiles SET role_id = (SELECT id FROM roles WHERE name = 'admin')
   WHERE id = '<user-uuid>';
   ```
3. Navigate to `/admin`.

**Admin check — fixed in code (Section 17 + Section 18 Phase 0):** the server-side admin check (`requireAdmin`, `app/admin/layout.tsx`, `services/admin.ts`) used to read a `profiles.role` column that does **not** exist in the migration chain. It now resolves the role via `role_id → roles.name` (`lib/admin-role.ts`, `fetchProfileRoleName`), and the `/owner` layout — the last surface still reading `profiles.role` — was fixed the same way in Section 18 Phase 0 (audit §1 #1). Live verification is still owner-gated: confirm with one admin login attempt before relying on the admin/owner surface (an anonymous request is redirected to `/sign-in` by a streaming redirect — HTTP 200 with a `NEXT_REDIRECT` digest — so check the redirect target, not the status alone). A second, related risk: `profiles_update_own` has no column restriction, so any signed-in user can set their own `role_id` to admin — migration 047 guards UPDATE (written, NOT applied); the INSERT path is still open (Section 18 audit §1 #53).

### Owner dashboard (`/owner`) and refresh-runs admin page (`/admin/refresh-runs`)

- **`/owner`** — admin-only owner dashboard (same fail-closed guard as `/admin`: no session → `/sign-in`, signed-in non-admin → `/dashboard`; role resolved via `role_id → roles.name`). It aggregates revenue, subscription/plan counts, API usage, price-source health, failed jobs and error logs. Where the underlying table is not yet applied live it shows an honest empty state instead of erroring (e.g. the error log until migration 048 is applied). Anonymous requests get a streaming redirect to `/sign-in` (HTTP 200 with a `NEXT_REDIRECT` digest) — verify the redirect target, not the status alone.
- **`/admin/refresh-runs`** — admin page listing price-refresh runs from the `price_refresh_runs` table (migration 040, written NOT applied — until it is applied the page shows the honest "not applied yet" state). Each run shows per-step status and error only; no per-run counts are stored (by design — the full counts live in the run's ephemeral API response).

### Admin features
- Analytics dashboard: real DB counts (users, products, alerts, wishlists, searches)
- User management, audit logs (`admin_audit_logs`), feature flags (`feature_flags` table)
- Catalog intake (CSV + eBay), merchants, fact-check, community-deals
- Monitoring: provider health, sync history, queue metrics

### Managing feature flags
```sql
-- Enable a feature
UPDATE feature_flags SET enabled = true WHERE key = 'ai_chat';
-- Disable a feature
UPDATE feature_flags SET enabled = false WHERE key = 'ai_chat';
```

---

## Cron jobs (6 — not 2)

Exactly **one** scheduler is expected: **cron-job.org**. There is no `vercel.json` (no Vercel Cron) and no in-repo scheduler. All six endpoints require `Authorization: Bearer <CRON_SECRET>` (POST). Whether the cron-job.org jobs exist or fire is **unknown from the repo** — only the owner can verify it in the cron-job.org dashboard.

| Endpoint | Schedule | Purpose |
|---|---|---|
| `POST /api/v1/prices/refresh` | **Every 6 hours** | Price-refresh chain: eBay leg → refresh → alerts → hunts → digest → notifications → stock → guest alerts → guest email → saved searches. Always returns 200 with a per-step status — monitors must read the body, not just the status code. Returns 500 when `CRON_SECRET` is unset. Note: the refresh currently re-reads the DB only; it fetches nothing live except the eBay leg (blocked without eBay keys + a live `merchants` row). |
| `POST /api/v1/notifications/process` | Every 5 minutes | Process the pending notification queue |
| `POST /api/v1/notifications/digest` | Weekly, Monday 09:00 | Weekly digest generation |
| `POST /api/v1/monitoring/uptime/check` | Every 5 minutes | Uptime check runner (needs migration 032, otherwise `totalChecks` is 0) |
| `POST /api/v1/alerts/check` | Unscheduled | No decision recorded on scheduling it |
| `POST /api/v1/predictions/outcomes` | Unscheduled | No decision recorded on scheduling it |

---

## Production configuration guide

### Stripe setup
1. Create a Stripe account at dashboard.stripe.com
2. Get your API keys from Developers > API Keys — **start in TEST mode** (`sk_test_...`)
3. Create Products and Prices: Premium **$9.99/month (planned price)**, Family (to be announced), Team (custom), Starter ($1, off by default)
4. Copy each Price ID to `STRIPE_PREMIUM_PRICE_ID` / `STRIPE_FAMILY_PRICE_ID` / `STRIPE_TEAM_PRICE_ID` / `STRIPE_STARTER_PRICE_ID` (do not use the deprecated `STRIPE_PRO_PRICE_ID`)
5. Set up a webhook endpoint:
   - URL: `https://shahjahanaibuy-b1zp.vercel.app/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
   - Copy the signing secret to `STRIPE_WEBHOOK_SECRET`
6. Test mode: use `sk_test_` keys. Live mode: use `sk_live_` keys **plus** `STRIPE_LIVE_LAUNCHED=true` — see the double gate above. **Do not go live in Section 17.**

### Resend email setup
1. Create a Resend account at resend.com
2. Get your API key from API Keys
3. Set `RESEND_API_KEY`
4. Verify your sending domain in Resend
5. Set `EMAIL_FROM_ADDRESS` to an address on your verified domain

### Push notification setup
1. Generate VAPID keys: `npx web-push generate-vapid-keys`
2. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`
3. The service worker (`/sw.js`) handles push events automatically

---

## Launch checklist

### Infrastructure
- [ ] Supabase project provisioned
- [ ] All 51 migrations verified (see migration section — do not blindly apply; 035–043, 045 and 047–053 are DO NOT APPLY YET)
- [ ] RLS policies verified (note: migration 010's 66 wide-open write policies are fixed by 017 in code, but 017's live application is unverified — check `pg_policies` live)
- [ ] Hosting platform configured (Vercel)
- [ ] Custom domain pointing to hosting
- [ ] SSL certificate active

### Integrations
- [ ] Stripe configured (test mode first, then live — see double gate)
- [ ] Stripe webhook endpoint registered and verified
- [ ] Resend configured and sending domain verified
- [ ] VAPID keys generated and set
- [ ] Sentry DSN configured (optional but recommended)
- [ ] `SMART_HOME_WEBHOOK_SECRET` (≥16 chars) set in Production
- [ ] Upstash Redis vars set (or accept in-memory rate limiting)

### SEO
- [ ] `NEXT_PUBLIC_APP_URL` set to production domain (or rely on the `https://shahjahanaibuy-b1zp.vercel.app` fallback)
- [ ] Sitemap submitted to Google Search Console
- [ ] Sitemap submitted to Bing Webmaster Tools
- [ ] Open Graph image created and referenced
- [ ] PWA icons (192px, 512px) in `/public/`
- [ ] `robots.txt` accessible

### Testing
- [ ] Authentication: sign up, sign in, sign out, password reset
- [ ] AI search returns relevant results
- [ ] Product comparison works for 2–5 products
- [ ] Price alerts can be created and triggered
- [ ] Wishlist CRUD works
- [ ] Notifications page shows queued notifications
- [ ] Billing page shows plans and checkout redirects to Stripe (test mode)
- [ ] Admin panel accessible to admin role only (see the known `profiles.role` risk above)
- [ ] PWA installable on Chrome/Edge/Safari
- [ ] Offline page loads when disconnected

### Cron jobs
- [ ] Price refresh (every 6 hours)
- [ ] Notification queue processor (every 5 min)
- [ ] Weekly digest generator (weekly)
- [ ] Uptime check (every 5 min)
- [ ] Decision recorded on `alerts/check` and `predictions/outcomes` (schedule or leave unscheduled)

---

## Maintenance guide

### Regular tasks

**Daily**
- Monitor `/api/v1/health` endpoint
- Check error logs for unhandled exceptions
- Verify Stripe webhook events are processing

**Weekly**
- Review audit logs in admin panel
- Check notification queue for stuck/failed notifications
- Review analytics for unusual patterns
- Run weekly digest for Premium users

**Monthly**
- Review and apply Supabase updates
- Review Stripe webhook event log for failures
- Update npm dependencies (`npm audit` — note: `npm audit` is blocked by sandbox registry policy in the dev VM; run it on a machine with registry access)
- Review and rotate API keys if needed
- Check database size and optimize queries

### Database maintenance
```sql
-- Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size DESC;

-- Clean old analytics events (keep 90 days)
DELETE FROM analytics_events WHERE created_at < now() - interval '90 days';

-- Clean old webhook events (keep 30 days)
DELETE FROM webhook_events WHERE created_at < now() - interval '30 days';

-- Clean sent notifications (keep 30 days)
DELETE FROM notification_queue WHERE status = 'sent' AND sent_at < now() - interval '30 days';
```

### Updating the application
1. Create a new branch
2. Make changes and test locally
3. Run `npm run build` — must pass with zero errors
4. Run `npx tsc --noEmit` — must pass with zero errors
5. Run `npm test` — full suite must pass 100%
6. Deploy to staging (if available)
7. Test critical paths
8. Push to `main` (Vercel deploys) — only with the user's live approval
9. Verify health endpoint + live recheck

---

## Rollback runbook

> **Status: never tested.** No rollback — code or database — has ever been run or exercised for this project. This runbook is a procedure to follow, not a proven recovery path. Do not present it as tested until a rollback has actually been rehearsed.

### Code rollback (a bad deploy)

1. **Vercel dashboard (fastest):** Vercel → Deployments → the last known-good deployment → Promote to Production (or Rollback, depending on the dashboard wording). This re-serves the previous build without touching git.
2. **Git revert (equivalent, needs approval):** `git revert <bad-commit>` on `main`, then push — only with the user's live approval, as with any push. Vercel deploys the reverted tree automatically. Prefer reverting the single bad commit over resetting history.
3. Verify after the rollback: `GET /api/v1/health` returns `healthy`, the reported symptom is gone, and the live recheck (unknown slugs → 404, key pages load) passes.

### What a code rollback does NOT do

- **A code rollback never touches the database.** Reverting code or re-deploying an older build changes no rows, no schema, and no Supabase configuration.
- **Already-applied migrations are NOT rolled back by a code revert.** If a bad deploy shipped alongside an applied migration, rolling back the code leaves the new schema in place. A migration can only be undone by a deliberate, owner-approved reverse migration or manual SQL in the Supabase SQL Editor — there is no automatic "undo migration" step, and no migration rollback has ever been run for this project.
- **No database rollback exists on the free tier.** The frozen `LAUNCH_CHECKLIST.md` rollback step "restore from Supabase daily backup" is **not available** — the free tier has no automated backups (see "Backup & restore guide" below). The only database recovery path is the most recent manual `pg_dump` export, if one exists — and no restore from such an export has ever been tested.

### Rollback-adjacent mitigations (no deploy needed)

- **Stripe:** disable the webhook endpoint or pause subscriptions in the Stripe Dashboard (test mode first).
- **Email:** disable the Resend API key (sends fail closed).
- **Cron:** pause the cron-job.org jobs so a bad refresh chain stops firing.
- **Feature flags:** flip the row in the `feature_flags` table (see "Managing feature flags" above) to disable a feature without a deploy.

---

## Backup & restore guide

> **Status — corrected 12 Nov 2026 (Section 18 audit, verified against Supabase's published pricing/docs): this project is on the Supabase free tier. The free tier has NO automated backups. There is no backup job, no scheduled dump, no verification, and no restore exercise anywhere in this project — no backup has ever been proven to exist. Whether the owner has ever taken a manual export is unknown. Until the owner decides otherwise (see "Owner decision" below), a manual export is the ONLY recovery path.**

### What is (and is not) backed up

**Supabase database**
- No automated backups on the free tier — the previous claim of "automatic daily backups" was false.
- Daily backups start on the Pro plan ($25/month, 7-day retention).
- Point-in-time recovery (PITR) is a Pro+ add-on at $100/month per 7 days of retention — it is NOT included in the free tier (or in Pro's base price). The previous claim of "7 days (free tier) or 30 days (pro)" was false.
- Manual backup only: `pg_dump` (see below). No scheduled or automated dump exists today.

**Supabase Storage**
- File uploads (product images, avatars).
- Storage objects are NEVER included in database backups — on any plan. There is no automatic backup of storage. The previous claim of "automatic backup of storage" was false. Storage files must be exported separately if they are to be recoverable.

**Application code**
- Git repository (primary backup)
- Environment variables (store securely, never in git)

**Stripe data**
- Stripe stores all payment data (no need to back up locally)
- Export customer/subscription data from Stripe Dashboard

### Owner decision — NOT done, nothing here is in place yet

The owner must choose one of these two options. Neither is implemented today, and neither is presented as done:
1. **Upgrade to Supabase Pro ($25/month)** — enables automatic daily backups (7-day retention). Note: this conflicts with the project's free-tier-only rule, so it needs an explicit owner decision. PITR would still cost extra ($100/month per 7 days) if wanted.
2. **Manual/CI `pg_dump` routine to owner-held storage** — a scheduled export (manual run or CI job) of the database plus a separate export of Storage objects, stored somewhere the owner controls, with a periodic restore test. No such routine exists today.

Until one of these is chosen and implemented, there is no backup.

### Backup procedure (manual — the only path today)

**Database (manual `pg_dump`)**
1. Run `pg_dump` against the live database (connection details from the Supabase Dashboard > Project Settings > Database, or the owner's secure vault) and save the output file to owner-held storage.
2. Separately export Storage objects — there is no combined export.
3. Record the date of each export. No export has been verified to exist as of 12 Nov 2026.

**Environment variables**
1. Export all env vars to a secure vault (e.g. AWS Secrets Manager, 1Password)
2. Document which vars are needed for each environment

### Restore procedure (from a manual export — untested)

**Database restore**
1. Restore the `pg_dump` file into the target database (via `psql` or the Supabase SQL Editor).
2. Verify data integrity by checking key tables.
3. **No restore has ever been run or tested — this procedure is unproven.**

**Application restore**
1. Deploy the last known good version from Git
2. Restore environment variables
3. Verify health endpoint
4. Test critical user flows

### Disaster recovery plan
1. **Database failure**: No automatic failover is configured or verified for this project — do not rely on one. Recovery depends on the most recent manual export, if one exists.
2. **Hosting failure**: Deploy to alternate platform (Vercel/Netlify)
3. **Stripe outage**: Stripe provides status page, payments queue and retry
4. **Email outage**: Notification queue retains pending items, retry logic handles temporary failures
5. **RTO**: Unproven — no restore exercise has ever been run, so no recovery-time figure can be stated. (The previous "1 hour" was asserted with no evidence.)
6. **RPO**: Unproven — with no automated backups, data loss on a database failure would be everything since the last manual export, if any. No number can be stated. (The previous "24 hours" assumed daily backups that do not exist.)
