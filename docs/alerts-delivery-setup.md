# Price Drop Alerts — Delivery Setup (Owner Checklist)

One complete chain, one trigger, three channels. When a tracked product's
price drops, an alerted user gets notified through every channel they
enabled — email, web push, and in-app — or, when a provider is not
configured yet, the alert is never silently lost: it stays visible in
the dashboard.

## How the chain works (code map)

```
cron job (ONE trigger, see below)
  └─ POST /api/v1/prices/refresh            (canonical endpoint)
       ├─ 1. refreshTrackedPrices()         services/price-refresh.ts
       │     Tracked set = active alerts + wishlist_items.
       │     A new price_history row is written ONLY when the lowest
       │     in-stock catalog price (or availability) changed.
       ├─ 2. checkPriceAlerts()              services/alert-checker.ts
       │     price_drop fires when latest price <= alert target;
       │     back_in_stock fires when the product is in stock;
       │     deal fires when an active deal exists. One notification
       │     per distinct triggered price (price_alert_history dedupe),
       │     so a price that stays low does not re-notify every run.
       └─ 3. processNotificationQueue()      services/notification-dispatch.ts
             ├─ email via Resend            services/email.ts
             ├─ web push via VAPID          services/push.ts
             └─ in-app notification row     services/notifications.ts
                   (queue row + `notifications` table row, created at
                   queue time — visible in /dashboard/notifications
                   even when email/push providers are unconfigured)
```

`POST /api/v1/alerts/check` runs the same three steps and exists for
manual runs and health checks. The Supabase Edge Function
`supabase/functions/price-refresh-worker/` calls
`/api/v1/prices/refresh` and is an alternative invocation path.

## THE rule: pick ONE scheduler, never two

Schedule **exactly one** of these. Scheduling two of them runs the whole
chain twice per cadence (dedupe keeps emails to one per price, but the
extra run is wasted work and double queue churn):

| Option | What to schedule | Status |
|---|---|---|
| ✅ **Preferred** | **One free cron-job.org job** → `POST /api/v1/prices/refresh` | Recommended: no repo workflow, no Supabase schedule needed |
| Alternative | Supabase `price-refresh-worker` Edge Function on a schedule | Only if you prefer a Supabase-side invocation |
| ❌ Never | Both of the above, or additionally `/api/v1/alerts/check` | Do not schedule alongside the preferred job |

## Owner checklist (do these in order)

### 1. Resend (email) — free tier

1. Create a free account at resend.com and create an API key.
2. **Sending-domain rule (honest free-tier limit):** without a verified
   sending domain, Resend only delivers to the account owner's own
   email address. To alert real users, verify a sending domain in
   Resend and use it as the FROM address. Free-tier volume is
   limited — verify the current limits on resend.com/pricing before
   relying on it; this project promises no specific free quota.
3. Set in the **Vercel dashboard** (never in chat or git):
   - `RESEND_API_KEY` = your key
   - `EMAIL_FROM_ADDRESS` = your verified sender (e.g.
     `alerts@yourdomain.com`); `RESEND_FROM` is accepted as an alias.
   - `EMAIL_FROM_NAME` = `SmartBuy AI` (or your brand name)

### 2. VAPID (web push) — free, no account needed

1. Generate a keypair (the `web-push` package is already installed):
   `npx web-push generate-vapid-keys`
2. Set in the **Vercel dashboard** (never in chat or git):
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = public key (this one is public
     by design — it ships to browsers)
   - `VAPID_PRIVATE_KEY` = private key (secret — dashboard only)
3. Users enable push in **Dashboard → Settings → Push
   Notifications**: turning the toggle ON requests browser permission,
   registers the service worker, and saves the subscription via
   `POST /api/v1/push/subscribe`. Turning it OFF unsubscribes.
   Expired subscriptions (410/404 from the push service) are deleted
   automatically instead of being retried forever.

### 3. Service-role key + cron secret — Vercel dashboard

- `SUPABASE_SERVICE_ROLE_KEY` — required. The refresh/check steps
  read alerts and wishlist items for every user, which owner-scoped
  RLS would hide from an anon client. Without it the endpoint fails
  fast with a clear error instead of silently checking zero alerts.
- `CRON_SECRET` — required, a strong random string. The endpoint
  **fails closed** when it is unset (it refuses to run rather than
  accepting unauthenticated triggers). Callers must send
  `Authorization: Bearer <CRON_SECRET>`.

### 4. Create the ONE cron job (cron-job.org, free)

- URL: `POST https://<your-production-domain>/api/v1/prices/refresh`
- Header: `Authorization: Bearer <your CRON_SECRET>`
- Schedule: **every 6 hours** is a good free-tier default (prices in
  this catalog change via the provider pipeline, not by the minute;
  more frequent runs mostly re-check unchanged prices).
- A successful run returns JSON counts:
  `{ refresh: { tracked, inserted, unchanged, … },
     alerts: { checked, triggered, queued, skippedDuplicate, … },
     notifications: { processed, sent, failed } }`.
  `triggered > 0` with `sent > 0` means alerts actually went out.

### 5. Wishlist scheduling ("Smart Wishlist Scheduling")

No extra setup. The refresh set already includes **wishlist products**
as well as active-alert products (`wishlist_items` + active `alerts`
in `services/price-refresh.ts`), so wishlisted products get fresh
price-history rows on every run. A wishlist product that also has an
active alert flows through the exact same drop → notify → deliver
chain. A wishlist product with **no** alert gets fresh prices but no
notification — by design (a wishlist is not an alert).

## What happens when a provider is NOT configured yet

This is deliberate, not a bug:

- **Email key missing** → the email leg is skipped and the queue row
  is marked `failed` immediately with a "provider not configured"
  reason. It is **not** retried on every run.
- **VAPID keys missing, or the user has no push subscription** → the
  push leg is skipped the same way, no retry loop.
- **Transient provider errors** (e.g. Resend 5xx) → the row keeps the
  existing exponential-backoff retry until `max_retries`, then fails.
- **In every case** the in-app notification row already exists, so
  the user still sees the alert in **Dashboard → Notifications** even
  when email/push could not go out.

## What is NOT proven by code alone (read this before promising delivery)

**Actual email/push delivery to a real inbox/device can only be proven
once the owner has set real keys and chosen a recipient.** No live
delivery test is possible from code alone, and none was run: this
delivery mechanism was verified by typecheck, production build, and
logic tests against fake data only (see below). To prove it end to
end, the owner should: set the keys above, create the cron job, set a
price alert on a product as a test user, trigger one manual run
(`POST /api/v1/prices/refresh` with the cron header), and confirm the
email arrives and/or the push appears — plus the in-app row in
Dashboard → Notifications.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Endpoint returns "CRON_SECRET is not configured" | Set `CRON_SECRET` in Vercel (and use it as the Bearer token) |
| Endpoint returns "SUPABASE_SERVICE_ROLE_KEY is not configured" | Set the service-role key in Vercel (service-role, not anon) |
| `checked: 0` every run | No active alerts, or the service-role key is wrong |
| `triggered: 0` although the price fell | The drop was already notified at that exact price (dedupe), or the alert target is above the current price |
| Queue rows `failed` with "provider not configured" | Expected until Resend/VAPID keys are set — in-app rows still show the alert |
| Queue rows `failed` after retries | Transient provider errors exhausted `max_retries`; check Resend/VAPID config and the row's `last_error` |
| User gets no push although the toggle is ON | The toggle subscribes the browser; if permission was denied, the toggle reverts with a reason toast. Check the VAPID public key is set and the browser allows notifications for the site |
| Alerts fire twice | You scheduled two triggers. Remove one (see the rule above) |

## Verification performed for this change (no live delivery)

- `npx tsc --noEmit` — 0 errors; production build with placeholder
  env only — passes.
- Logic tests against a fake Supabase client: (a) price 1099 → 999
  crossing a $1000 target creates exactly one queued notification +
  one history row; (b) a second run at the same $999 creates nothing
  new (`skippedDuplicate: 1`); (c) with no Resend/VAPID keys, a
  queued row is marked `failed` immediately with `retry_count`
  untouched and an in-app row still created; (d) a `both`-channel row
  with no keys at all fails permanently without a retry loop.
- NOT proven live: delivery of a real email or push notification —
  that needs the owner's keys + a real recipient (see above).
