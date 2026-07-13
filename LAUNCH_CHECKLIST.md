# LAUNCH CHECKLIST — SmartBuy AI

**Date:** 2026-07-12

---

## Pre-Launch (Must Complete Before Going Live)

### Environment Variables
- [ ] `NEXT_PUBLIC_SUPABASE_URL` — Set to production Supabase URL
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Set to production anon key
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — Set to production service role key
- [ ] `NEXT_PUBLIC_APP_URL` — Set to production domain (e.g., `https://smartbuy.ai`)
- [ ] `STRIPE_SECRET_KEY` — Set to `sk_live_...` for live payments
- [ ] `STRIPE_WEBHOOK_SECRET` — Set to webhook signing secret
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — Set to `pk_live_...`
- [ ] `STRIPE_PRO_PRICE_ID` — Set to Stripe Price ID for Pro plan
- [ ] `RESEND_API_KEY` — Set to Resend API key
- [ ] `EMAIL_FROM_ADDRESS` — Set to `noreply@yourdomain.com`
- [ ] `EMAIL_FROM_NAME` — Set to `SmartBuy AI`
- [ ] `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — Set to VAPID public key
- [ ] `VAPID_PRIVATE_KEY` — Set to VAPID private key
- [ ] `CRON_SECRET` — Set to a strong random string
- [ ] `SENTRY_DSN` — Set to Sentry DSN (optional but recommended)
- [ ] `NEXT_PUBLIC_SENTRY_DSN` — Set to Sentry client DSN (optional)
- [ ] `LOG_LEVEL` — Set to `info` for production

### Database
- [ ] All 13 migrations applied to production Supabase
- [ ] RLS enabled on all 60 tables (verified: 0 "always true" policies)
- [ ] All 3 functions have immutable search_path
- [ ] Create admin user: `UPDATE profiles SET role_id = (SELECT id FROM roles WHERE name = 'admin') WHERE id = '<your-uuid>';`

### Stripe Configuration
- [ ] Create Stripe account
- [ ] Create Product "SmartBuy AI Pro" ($9.99/month recurring)
- [ ] Copy Price ID to `STRIPE_PRO_PRICE_ID`
- [ ] Set up webhook endpoint: `https://yourdomain.com/api/webhooks/stripe`
- [ ] Subscribe to events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`
- [ ] Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`
- [ ] Test checkout flow in test mode
- [ ] Switch to live mode (`sk_live_`, `pk_live_`)

### Email Configuration
- [ ] Create Resend account
- [ ] Verify sending domain in Resend
- [ ] Set `RESEND_API_KEY`
- [ ] Set `EMAIL_FROM_ADDRESS` to verified domain
- [ ] Test welcome email on sign up

### Push Notifications
- [ ] Generate VAPID keys: `npx web-push generate-vapid-keys`
- [ ] Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`
- [ ] Test push subscription in browser

### Domain & SSL
- [ ] Purchase/configure domain
- [ ] Configure DNS (A record to hosting platform)
- [ ] SSL certificate active (usually automatic via Netlify/Vercel)
- [ ] Configure MX records if sending email from own domain

### Cron Jobs
- [ ] Set up cron for notification queue: `POST /api/v1/notifications/process` every 5 minutes with `Authorization: Bearer <CRON_SECRET>`
- [ ] Set up cron for weekly digest: `POST /api/v1/notifications/digest` every Monday 9:00 AM with `Authorization: Bearer <CRON_SECRET>`

---

## Build Verification

- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] `npm run build` passes with 0 errors
- [ ] No new warnings introduced
- [ ] All pages compile (59 pages)
- [ ] All API routes compile (57 routes)

---

## Functional Testing

### Authentication
- [ ] User can sign up with email/password
- [ ] User receives welcome email (if Resend configured)
- [ ] User can sign in
- [ ] User can sign out
- [ ] User can reset password
- [ ] Protected routes redirect to sign-in when unauthenticated
- [ ] Admin routes redirect non-admin users

### Core Features
- [ ] Home page loads with featured products
- [ ] Search returns relevant results
- [ ] AI search returns natural language results
- [ ] Product detail page loads with price chart
- [ ] Product comparison works (2-5 products)
- [ ] Deals page shows active deals
- [ ] Wishlist CRUD works
- [ ] Price alerts can be created
- [ ] Reviews can be submitted

### Dashboard
- [ ] Dashboard shows user stats
- [ ] Recommendations page loads
- [ ] Notifications page shows queue
- [ ] Settings page works (theme, preferences)
- [ ] Profile page allows updates
- [ ] Chat AI assistant responds

### Billing
- [ ] Billing page shows Free and Pro plans
- [ ] Click "Upgrade" redirects to Stripe Checkout
- [ ] After payment, subscription is activated
- [ ] Billing history shows invoices
- [ ] Cancel subscription works
- [ ] Stripe Customer Portal accessible

### Admin
- [ ] Admin panel accessible to admin role only
- [ ] Admin analytics show totals
- [ ] User management works
- [ ] Audit logs display

### Notifications
- [ ] Email notifications queued and sent
- [ ] Push notifications work (if VAPID configured)
- [ ] Notification preferences respected
- [ ] Weekly digest generates for Pro users

---

## SEO Verification

- [ ] `https://yourdomain.com/sitemap.xml` accessible and includes product URLs
- [ ] `https://yourdomain.com/robots.txt` accessible
- [ ] Submit sitemap to Google Search Console
- [ ] Submit sitemap to Bing Webmaster Tools
- [ ] Open Graph tags present (check with https://opengraph.dev/)
- [ ] Twitter Card tags present
- [ ] JSON-LD structured data valid (check with https://search.google.com/test/rich-results)
- [ ] Canonical URLs correct
- [ ] Apple touch icon linked

---

## PWA Verification

- [ ] Manifest accessible at `/manifest.json`
- [ ] Install prompt appears on Chrome/Edge
- [ ] App installs and opens in standalone mode
- [ ] Offline page loads when disconnected
- [ ] Service worker registered (check DevTools > Application)
- [ ] Images cached (check DevTools > Application > Cache)

---

## Performance Verification

- [ ] Run Lighthouse audit (target: 90+ Performance)
- [ ] First Contentful Paint < 1.5s
- [ ] Largest Contentful Paint < 2.5s
- [ ] Cumulative Layout Shift < 0.1
- [ ] Total Blocking Time < 200ms
- [ ] Images optimized (AVIF/WebP)
- [ ] No render-blocking resources

---

## Security Verification

- [ ] `https://yourdomain.com/api/v1/health` returns healthy status
- [ ] Security headers present (check with https://securityheaders.com)
- [ ] CSP header present
- [ ] HSTS header present
- [ ] No `.env` file in git repository
- [ ] No secrets in client-side code
- [ ] Stripe webhook signature verification working
- [ ] Rate limiting active

---

## Post-Launch Monitoring

### First 24 Hours
- [ ] Monitor health endpoint every hour
- [ ] Check error logs for unhandled exceptions
- [ ] Verify Stripe webhook events processing
- [ ] Monitor notification queue for stuck items
- [ ] Check user signups and authentication

### First Week
- [ ] Review analytics dashboard daily
- [ ] Check for failed payments
- [ ] Monitor email delivery rates
- [ ] Review audit logs
- [ ] Check database performance

### Ongoing
- [ ] Weekly: Review error trends
- [ ] Weekly: Run weekly digest for Pro users
- [ ] Monthly: Update dependencies (`npm audit`)
- [ ] Monthly: Review database size
- [ ] Monthly: Rotate API keys if needed
- [ ] Quarterly: Review and update security headers

---

## Rollback Plan

If critical issues are found after launch:

1. **Application rollback**: Deploy previous version from git
2. **Database rollback**: Restore from Supabase daily backup
3. **Stripe**: Disable webhook endpoint, pause subscriptions
4. **Email**: Disable Resend API key
5. **Communication**: Post status update on status page

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | | | |
| Security Reviewer | | | |
| Product Owner | | | |
| DevOps | | | |

---

**Launch Authorization:** All items above must be checked before going live.
