# SmartBuy AI — Deployment Documentation

**Last updated:** 2026-11-12 (Section 17, Stage I — full rewrite)
**Live site:** https://shahjahanaibuy-b1zp.vercel.app/
**Repo:** https://github.com/shajhanindher6-art/shahjahanaibuy (branch `main`)

> This document supersedes all earlier deployment notes in this repo. The root July 2026 docs (`DATABASE_SCHEMA.md`, `LAUNCH_CHECKLIST.md`, etc.) are frozen historical snapshots and their numbers (13 migrations, 60 tables, 57 routes, 99 tests) are stale — do not use them. Current numbers live in `project-summary.md`.

## Deployment model

- **Hosting: Vercel. Deploy = git push to `main`.** There is no `vercel.json` (no Vercel Cron, no custom headers, no build overrides).
- **Verification gate before every push:** `npx tsc --noEmit` = 0 errors · full `npx vitest run` = 100% pass · clean `next build` · headless smoke · live recheck after push. **Push only on the user's live approval** (standing rule).
- **GitHub workflow files** (`.github/workflows/*`) cannot be pushed by the GitHub App (403) — workflow changes go via the GitHub website.
- **Baseline (12 Nov 2026):** tsc 0 · vitest 204 files / 2,528 tests, 100% PASS · clean build exit 0, 796 pages, `/products/[slug]` First Load 329 kB (budget ≤350 kB).

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

This is enforced in `lib/stripe.ts` (`isStripeLiveLaunchApproved()`, `isStripeLiveModeBlocked()`): checkout and portal routes refuse with **503 + a loud log** when a live key is configured but the launch flag is not set — never silently taking real money. Before setting the flag, complete the live launch checklist: live keys + webhook secret in Vercel, live Price IDs, test checkout in live mode with a real card flow rehearsed, refund/dunning behaviour confirmed (note: there is currently **no** `invoice.payment_failed` handler — failed payments fall into a log-only branch), and the price decision made. **Stripe stays in TEST mode for Section 17 — no live activation.**

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

Note: `NEXT_PUBLIC_SITE_URL` is **not read by the code** — use `NEXT_PUBLIC_APP_URL`. The `enableGoogleAuth` / `enableEmailVerification` flags in `lib/config/env.ts` are not read anywhere else in code: Google sign-in is always offered, and email confirmation is governed by the Supabase dashboard, not code.

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

## Migrations (43 files — not 12)

`supabase/migrations/` holds **43 files** (001–044, gaps 024/025 only — 023 exists). 121 `CREATE TABLE` statements, 120 distinct tables, every table RLS-enabled.

**Applied status of every migration is UNKNOWN from the repo** — only the owner can check `supabase_migrations.schema_migrations` in Supabase. Two are proven NOT applied live: **033** (`live_shopping_sessions` table missing — proven by a PGRST205) and **044** (`creator_slugs` view — applying it activates `/creators` 404s with no redeploy).

### Rules
- **Never apply a migration without the owner's explicit approval for that migration.**
- **9 files carry "DO NOT APPLY YET" (035–043).** In particular, **never apply 035 without a separate explicit review** (standing rule).
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

**Known live risk (Section 17 audit §4 #1):** the server-side admin check (`requireAdmin`, `app/admin/layout.tsx`, `services/admin.ts`) reads a `profiles.role` column that does **not** exist in the migration chain — if the live DB matches the chain, every admin route 403s and `/admin` redirects everyone to `/dashboard`. Live status is unknown; verify with one admin login attempt before relying on the admin surface. A second, related risk: `profiles_update_own` has no column restriction, so any signed-in user can set their own `role_id` to admin — fix is Stage H code work, not a deployment step.

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
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`
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
- [ ] All 43 migrations verified (see migration section — do not blindly apply; 035–043 are DO NOT APPLY YET)
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

## Backup & restore guide

### What to back up

**Supabase database**
- Supabase provides automatic daily backups
- Manual backup: `pg_dump` via Supabase SQL Editor or MCP tools
- Point-in-time recovery available for 7 days (free tier) or 30 days (pro)

**Supabase Storage**
- File uploads (product images, avatars)
- Supabase provides automatic backup of storage

**Application code**
- Git repository (primary backup)
- Environment variables (store securely, never in git)

**Stripe data**
- Stripe stores all payment data (no need to back up locally)
- Export customer/subscription data from Stripe Dashboard

### Backup procedure

**Database (via Supabase Dashboard)**
1. Go to Database > Backups
2. Click "Create Backup"
3. Download the backup file

**Environment variables**
1. Export all env vars to a secure vault (e.g. AWS Secrets Manager, 1Password)
2. Document which vars are needed for each environment

### Restore procedure

**Database restore**
1. Go to Supabase Dashboard > Database > Backups
2. Select the backup to restore
3. Click "Restore"
4. Verify data integrity by checking key tables

**Application restore**
1. Deploy the last known good version from Git
2. Restore environment variables
3. Verify health endpoint
4. Test critical user flows

### Disaster recovery plan
1. **Database failure**: Supabase automatic failover (high availability)
2. **Hosting failure**: Deploy to alternate platform (Vercel/Netlify)
3. **Stripe outage**: Stripe provides status page, payments queue and retry
4. **Email outage**: Notification queue retains pending items, retry logic handles temporary failures
5. **RTO**: 1 hour (time to restore service)
6. **RPO**: 24 hours (max data loss from daily backups)
