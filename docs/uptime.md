# Uptime monitoring (Section 4, items 11 + 13)

Two layers, both free:

1. **In-app check runner (built)** — `POST /api/v1/monitoring/uptime/check`
   records one check row in `uptime_checks` (migration 032). The status
   page (`/status`) and `GET /api/v1/monitoring/uptime` compute uptime %
   from those rows only.
2. **UptimeRobot (owner-side, free plan)** — an external monitor that
   emails the owner when the site goes down. The app cannot create this
   account; the owner steps below take ~10 minutes.

## Honest states — read before interpreting /status

- **Before any check is recorded:** the status page says "Monitoring
  started 10 November 2026 — no checks recorded yet" and shows **no**
  uptime %. There is no percentage until real checks accrue.
- **Uptime %** = recorded successful checks ÷ recorded checks in the
  last 90 days. It says nothing about the period before monitoring
  started.
- **An empty incident list** means no incidents have been recorded
  since monitoring started — not that nothing ever went wrong before.
- **A single failed check is never auto-promoted to an incident.**
  Incidents are human-recorded (see "Recording an incident" below),
  because one failed check can be a blip, a deploy, or a monitor hiccup.

## Owner step 1 — schedule the in-app check runner (cron-job.org)

The 6-hour price-refresh cron is a **separate** job. Do not combine them.

1. In cron-job.org (free account), create a new job:
   - **URL:** `https://shahjahanaibuy-b1zp.vercel.app/api/v1/monitoring/uptime/check`
   - **Method:** POST, **every 5 minutes**.
   - **Header:** `Authorization: Bearer <CRON_SECRET>` — the same
     `CRON_SECRET` already set in Vercel for the price-refresh job.
     (Never put the secret in this repo or in chat.)
   - **Body:** `{}` (empty JSON object is fine; no `target_url` means
     the homepage is checked).
2. Verify: after ~15 minutes, `GET /api/v1/monitoring/uptime` should
   show `totalChecks` growing, and `/status` should show a percentage.
   If `totalChecks` stays 0, check that migration 032 was run in
   Supabase (the endpoint returns 503 with that hint) and that the
   cron job is enabled.

Optional: check a second URL (e.g. a product page) by creating a
second job with body `{"target_url": "https://shahjahanaibuy-b1zp.vercel.app/products/macbook-air-13"}`.

## Owner step 2 — UptimeRobot (external monitor, free plan)

1. Create a free account at https://uptimerobot.com (free plan:
   50 monitors, 5-minute interval).
2. Add a monitor:
   - **Monitor type:** HTTPS
   - **Friendly name:** SmartBuy AI — homepage
   - **URL:** `https://shahjahanaibuy-b1zp.vercel.app/`
   - **Monitoring interval:** 5 minutes
3. Add an alert contact: **Alert Contacts → Add → Email** (your email),
   and attach it to the monitor. Optional: add a second contact for
   WhatsApp/Telegram via UptimeRobot's integrations — those are
   UptimeRobot-side settings, not SmartBuy code.
4. (Optional, second monitor) Same as above for
   `https://shahjahanaibuy-b1zp.vercel.app/products/macbook-air-13`.
5. Verify: UptimeRobot shows the monitor "Up" within a few minutes.
   Its uptime % is UptimeRobot's own measurement — it will differ
   slightly from the in-app % because the two checkers run on different
   schedules. That is expected; neither is "the" uptime, both are
   recorded measurements.

## Recording an incident

When the site is confirmed down (or degraded), record it so `/status`
shows it. Run this in the Supabase SQL editor (admin/owner only):

```sql
insert into public.uptime_incidents (title, status, description)
values ('Homepage returning errors', 'investigating', 'Error ID … / cause …');
```

Update the row as the situation changes, and close it when resolved:

```sql
update public.uptime_incidents
set status = 'resolved', resolved_at = now()
where id = '<incident id>';
```

Status values: `investigating` → `identified` → `monitoring` →
`resolved`. Only `resolved` removes the incident from the "open"
list on `/status`.

## Alert wiring (what notifies whom)

| Event | Who is notified | How |
|---|---|---|
| Site down (external) | Owner | UptimeRobot email (owner step 2) |
| Check runner records a failure | Nobody automatically | The failed row is visible in `uptime_checks` and on `/status`; the owner opens an incident manually |
| Incident opened | Visitors | `/status` shows it immediately |

There is deliberately no automatic WhatsApp/Telegram alert from the
in-app runner: the webhook hub already exists for price alerts, and
wiring downtime alerts into it is a follow-up, not part of this batch.
If the owner wants downtime WhatsApp alerts, the follow-up is: a cron
that reads the latest `uptime_checks` row and calls the existing
webhook dispatch when `ok = false` twice in a row (twice, to avoid
alerting on a single blip).
