# SmartBuy AI — Deployment Documentation

## Deployment Checklist

### Pre-Deployment
- [ ] All environment variables configured (see Environment Variables List)
- [ ] Production build passes with zero TypeScript errors
- [ ] Supabase migrations applied (12 migrations, 60 tables)
- [ ] RLS policies verified on all tables
- [ ] Stripe webhook endpoint registered in Stripe Dashboard
- [ ] Resend API key configured (for email delivery)
- [ ] VAPID key pair generated (for push notifications)
- [ ] Domain DNS configured (A record, CNAME, MX for email)
- [ ] SSL/TLS certificate active
- [ ] CDN configured (Cloudflare/Netlify)

### Deployment Steps
1. Set all environment variables in hosting platform
2. Build: `npm run build`
3. Deploy to hosting platform (Netlify/Vercel)
4. Verify health endpoint: `GET /api/v1/health`
5. Test authentication flow (sign up, sign in, sign out)
6. Test Stripe checkout flow (test mode)
7. Test email delivery (welcome email on sign up)
8. Submit sitemap to Google Search Console
9. Register service worker (verify in browser DevTools)
10. Set up cron jobs for notification queue processing

### Post-Deployment Verification
- [ ] `https://yourdomain.com/api/v1/health` returns `healthy`
- [ ] Sign up creates profile + user_settings
- [ ] Email verification arrives (if enabled)
- [ ] Dashboard loads with recommendations
- [ ] AI search returns results
- [ ] Product detail page loads with price chart
- [ ] Stripe checkout redirects to Stripe (if configured)
- [ ] Stripe webhook processes events (check `webhook_events` table)
- [ ] PWA installable on mobile (check manifest + icons)
- [ ] Offline page loads when network disconnected
- [ ] Sitemap accessible at `/sitemap.xml`
- [ ] Robots.txt accessible at `/robots.txt`

---

## Environment Variables List

### Required (App won't start without these)
| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | `eyJ...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) | `eyJ...` |

### Stripe (Required for payments)
| Variable | Description | Example |
|----------|-------------|---------|
| `STRIPE_SECRET_KEY` | Stripe API secret key | `sk_test_...` or `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | `whsec_...` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key | `pk_test_...` or `pk_live_...` |
| `STRIPE_PRO_PRICE_ID` | Stripe Price ID for Pro plan | `price_...` |

### Email (Required for email delivery)
| Variable | Description | Example |
|----------|-------------|---------|
| `RESEND_API_KEY` | Resend API key | `re_...` |
| `EMAIL_FROM_ADDRESS` | From email address | `noreply@smartbuy.ai` |
| `EMAIL_FROM_NAME` | From display name | `SmartBuy AI` |

### Push Notifications (Required for browser push)
| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | VAPID public key | `BPq...` |
| `VAPID_PRIVATE_KEY` | VAPID private key | `Dh...` |

### Monitoring (Optional)
| Variable | Description | Example |
|----------|-------------|---------|
| `SENTRY_DSN` | Sentry DSN for crash reporting | `https://...@sentry.io/...` |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN for client errors | `https://...@sentry.io/...` |
| `LOG_LEVEL` | Logging level (debug/info/warn/error) | `info` |

### Cron (For scheduled jobs)
| Variable | Description | Example |
|----------|-------------|---------|
| `CRON_SECRET` | Secret for cron endpoint auth | `your-secret-string` |

### App Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_APP_URL` | Public app URL | `http://localhost:3000` |
| `NEXT_PUBLIC_ENABLE_EMAIL_VERIFICATION` | Require email verification | `false` |

### Optional / Future
| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for AI features |
| `REDIS_URL` | Redis URL for distributed rate limiting |
| `CLOUDFLARE_R2_*` | R2 storage credentials |

---

## Production Configuration Guide

### Stripe Setup
1. Create a Stripe account at dashboard.stripe.com
2. Get your API keys from Developers > API Keys
3. Create a Product and Price for the Pro plan ($9.99/month)
4. Copy the Price ID (`price_...`) to `STRIPE_PRO_PRICE_ID`
5. Set up a webhook endpoint:
   - URL: `https://yourdomain.com/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`
   - Copy the signing secret to `STRIPE_WEBHOOK_SECRET`
6. Test mode: use `sk_test_` and `pk_test_` keys
7. Live mode: use `sk_live_` and `pk_live_` keys

### Resend Email Setup
1. Create a Resend account at resend.com
2. Get your API key from API Keys
3. Set `RESEND_API_KEY`
4. Verify your sending domain in Resend
5. Set `EMAIL_FROM_ADDRESS` to an address on your verified domain

### Push Notification Setup
1. Generate VAPID keys: `npx web-push generate-vapid-keys`
2. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`
3. The service worker (`/sw.js`) handles push events automatically

### Cron Job Setup
Set up external cron jobs (or Supabase scheduled functions):
- **Notification queue**: POST `/api/v1/notifications/process` every 5 minutes
- **Weekly digest**: POST `/api/v1/notifications/digest` every Monday at 9:00 AM
- Include header: `Authorization: Bearer <CRON_SECRET>`

---

## Admin Setup Guide

### Accessing the Admin Panel
1. Sign up at `/sign-up`
2. Manually update the user's role in Supabase:
   ```sql
   UPDATE profiles SET role_id = (SELECT id FROM roles WHERE name = 'admin')
   WHERE id = '<user-uuid>';
   ```
3. Navigate to `/admin`

### Admin Features
- **Analytics Dashboard**: Total users, products, alerts, wishlists, searches
- **User Management**: View all registered users
- **Audit Logs**: All admin actions are logged in `admin_audit_logs`
- **Feature Flags**: Toggle features on/off via `feature_flags` table
- **Monitoring**: Provider health, sync history, queue metrics

### Managing Feature Flags
```sql
-- Enable a feature
UPDATE feature_flags SET enabled = true WHERE key = 'ai_chat';
-- Disable a feature
UPDATE feature_flags SET enabled = false WHERE key = 'ai_chat';
```

---

## Launch Checklist

### Infrastructure
- [ ] Supabase project provisioned
- [ ] All 12 migrations applied
- [ ] RLS policies verified (0 "always true" policies)
- [ ] Hosting platform configured (Netlify/Vercel)
- [ ] Custom domain pointing to hosting
- [ ] SSL certificate active
- [ ] CDN configured

### Integrations
- [ ] Stripe configured (test mode first, then live)
- [ ] Stripe webhook endpoint registered and verified
- [ ] Resend configured and sending domain verified
- [ ] VAPID keys generated and set
- [ ] Sentry DSN configured (optional but recommended)

### SEO
- [ ] `NEXT_PUBLIC_APP_URL` set to production domain
- [ ] Sitemap submitted to Google Search Console
- [ ] Sitemap submitted to Bing Webmaster Tools
- [ ] Open Graph image created and referenced
- [ ] PWA icons (192px, 512px) in `/public/`
- [ ] `robots.txt` accessible

### Testing
- [ ] Authentication: sign up, sign in, sign out, password reset
- [ ] AI search returns relevant results
- [ ] Product comparison works for 2-5 products
- [ ] Price alerts can be created and triggered
- [ ] Wishlist CRUD works
- [ ] Notifications page shows queued notifications
- [ ] Billing page shows plans and checkout redirects to Stripe
- [ ] Admin panel accessible to admin role only
- [ ] PWA installable on Chrome/Edge/Safari
- [ ] Offline page loads when disconnected

### Cron Jobs
- [ ] Notification queue processor (every 5 min)
- [ ] Weekly digest generator (weekly)

---

## Maintenance Guide

### Regular Tasks

**Daily**
- Monitor `/api/v1/health` endpoint
- Check error logs for unhandled exceptions
- Verify Stripe webhook events are processing

**Weekly**
- Review audit logs in admin panel
- Check notification queue for stuck/failed notifications
- Review analytics for unusual patterns
- Run weekly digest for Pro users

**Monthly**
- Review and apply Supabase updates
- Review Stripe webhook event log for failures
- Update npm dependencies (`npm audit`)
- Review and rotate API keys if needed
- Check database size and optimize queries

### Database Maintenance
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

### Updating the Application
1. Create a new branch
2. Make changes and test locally
3. Run `npm run build` — must pass with zero errors
4. Run `npx tsc --noEmit` — must pass with zero errors
5. Deploy to staging (if available)
6. Test critical paths
7. Deploy to production
8. Verify health endpoint

---

## Backup & Restore Guide

### What to Back Up

**Supabase Database**
- Supabase provides automatic daily backups
- Manual backup: `pg_dump` via Supabase SQL Editor or MCP tools
- Point-in-time recovery available for 7 days (free tier) or 30 days (pro)

**Supabase Storage**
- File uploads (product images, avatars)
- Supabase provides automatic backup of storage

**Application Code**
- Git repository (primary backup)
- Environment variables (store securely, never in git)

**Stripe Data**
- Stripe stores all payment data (no need to back up locally)
- Export customer/subscription data from Stripe Dashboard

### Backup Procedure

**Database (via Supabase Dashboard)**
1. Go to Database > Backups
2. Click "Create Backup"
3. Download the backup file

**Environment Variables**
1. Export all env vars to a secure vault (e.g., AWS Secrets Manager, 1Password)
2. Document which vars are needed for each environment

### Restore Procedure

**Database Restore**
1. Go to Supabase Dashboard > Database > Backups
2. Select the backup to restore
3. Click "Restore"
4. Verify data integrity by checking key tables

**Application Restore**
1. Deploy the last known good version from Git
2. Restore environment variables
3. Verify health endpoint
4. Test critical user flows

### Disaster Recovery Plan
1. **Database failure**: Supabase automatic failover (high availability)
2. **Hosting failure**: Deploy to alternate platform (Vercel/Netlify)
3. **Stripe outage**: Stripe provides status page, payments queue and retry
4. **Email outage**: Notification queue retains pending items, retry logic handles temporary failures
5. **RTO**: 1 hour (time to restore service)
6. **RPO**: 24 hours (max data loss from daily backups)
