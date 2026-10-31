# Live Deploy Preparation — SmartBuy AI
Prepared: 2026-10-31 | Code state: main after commit 41b5202 (75 pages, build passing)

## Free-tier plan (user decision, 2026-10-31: no budget, $0 only)
- Hosting: Netlify Free (config already present). Avoid Vercel Hobby for this
  commercial SaaS — Hobby is non-commercial only, while Netlify Free allows
  commercial use. Note new Netlify accounts are credit-based (300 credits/month),
  not the old 100 GB / 300 build-minute wording, so keep deploys few and traffic low.
- Database: Supabase Free — 500 MB database, 1 GB file storage, 5 GB egress,
  50,000 monthly active users. Catch: free projects pause after 1 week of
  inactivity and must be resumed from the dashboard.
- Email: Resend Free — 100 emails/day, 3,000/month, up to 3 verified domains.
- Payments: Stripe TEST mode only for now (no monthly fee; live fees apply only
  on successful live transactions, so live mode waits until the user chooses it).
- Domain: free Netlify subdomain first (e.g. *.netlify.app); custom domain later.
- Monitoring: Sentry SKIPPED for now to stay at $0; use the health endpoint + logs.
- Cron: free external scheduler (e.g. cron-job.org free tier) hitting the two
  cron endpoints, or Netlify scheduled functions if within free credits.

## What is already configured in code (no action needed)
- Security headers in `next.config.js`: CSP, HSTS (2 years, preload), X-Frame-Options,
  X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- Supabase session middleware on all non-static routes.
- Stripe webhook signature verification (`/api/webhooks/stripe`).
- Cron endpoints (`/api/v1/notifications/process`, `/api/v1/notifications/digest`)
  protected by a `CRON_SECRET` Bearer-token check.
- In-memory rate limiting (100 req / 60s per identifier) — note: not shared
  across multiple server instances; use Redis if you scale to multi-instance.
- PII masking in structured logs; service-role key is server-side only.
- `.gitignore` ignores `.env` and `.env*.local`; no `.env` file exists in the repo.
- Hardcoded-secret scan (2026-10-31): no live keys in source; only a `sk_live_`
  prefix check in `lib/stripe.ts`.
- Netlify config present (`netlify.toml`, `@netlify/plugin-nextjs`). No Vercel config yet.

## What still needs a decision / account (NOT in chat, NOT in git)
1. **Hosting:** Netlify (already configured, easiest path) or Vercel (needs new config).
2. **Domain:** your production domain, to set as `NEXT_PUBLIC_APP_URL`.
3. **Supabase project:** create project, apply ALL 16 migrations in
   `supabase/migrations/` (docs still say 13 — the repo actually has 16),
   then copy URL, anon key, and service-role key into the hosting dashboard.
   Then create an admin user in the database.
4. **Stripe:** create "SmartBuy AI Pro" ($9.99/month), copy Price ID, set webhook
   endpoint `https://yourdomain.com/api/webhooks/stripe` for events
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`. Test in test mode first.
5. **Resend:** verify your sending domain, then set API key + from address.
6. **VAPID keys:** generate at deploy time (`npx web-push generate-vapid-keys`)
   and enter both keys directly in the hosting dashboard.
7. **CRON_SECRET:** generate a strong random string at deploy time and enter it
   in the hosting dashboard; cron callers must send `Authorization: Bearer <secret>`.
8. **Cron jobs (external scheduler):**
   - `POST /api/v1/notifications/process` every 5 minutes
   - `POST /api/v1/notifications/digest` every Monday 09:00
9. **Sentry (optional):** set DSN if you want error reporting.

## Security rules for this step
- NEVER paste Supabase service-role keys, Stripe secret keys, Resend keys,
  VAPID private keys, or CRON_SECRET into this chat or into any committed file.
- Real values go only into the hosting dashboard's environment settings.
- `.env.example` in this repo contains placeholders only.

## Post-deploy verification (in order)
1. `GET /api/v1/health` returns healthy.
2. Home, search, deals, product, sign-up, sign-in, dashboard all load.
3. Stripe checkout in TEST mode, then webhook events appear in billing history.
4. Welcome email arrives on sign-up (after Resend domain verification).
5. Push subscription works (after VAPID keys are set).
6. `/sitemap.xml` and `/robots.txt` are reachable; submit sitemap to Search Console.
7. Privacy/Terms starter pages (added 2026-10-31) reviewed by the site owner.

## Status
- Build test: PASS (TypeScript 0 errors, 75 pages, smoke test 200s).
- Fixes pushed to GitHub main: commit 41b5202.
- Live deployment: NOT started — waiting for hosting choice, domain, and the
  accounts/keys above (to be entered in the hosting dashboard, not chat).
