# Sentry — Verification, Alerts & Weekly Triage

> S4#14. Sentry is wired but **event flow is not yet proven in the
> Sentry dashboard**. This doc is the owner checklist to prove it and
> keep it operational. No DSN or key is in this repo — the DSN lives
> only in the hosting dashboard (`SENTRY_DSN` server-side,
> `NEXT_PUBLIC_SENTRY_DSN` for the browser).

## What is wired

- `sentry.client.config.ts` — browser init, dormant until
  `NEXT_PUBLIC_SENTRY_DSN` is set.
- `sentry.server.config.ts` — Node init, `SENTRY_DSN` wins, falls back
  to `NEXT_PUBLIC_SENTRY_DSN`. Dormant with no DSN: `Sentry.init` is
  never called and nothing is sent anywhere.
- `sentry.edge.config.ts` — same rule for edge runtime.
- `next.config.js` — wrapped in `withSentryConfig` (source-map upload
  only when a DSN/org is configured; silent otherwise).
- `app/error.tsx` — error boundary dynamically imports
  `@sentry/nextjs` and calls `captureException` when a DSN is set.
- `tracesSampleRate: 0.1` everywhere — free-tier event volume stays low.
- CSP `connect-src` already allows `https://*.ingest.sentry.io`
  (see `lib/csp.ts`), so browser events are not blocked.
- Test route: `POST /api/v1/admin/sentry-test` (admin only,
  10/min per user). Sends a tagged test message or exception and
  flushes before responding.

## Step 1 — Verify the event flow (owner, ~5 minutes)

This is the one step no agent can do from here: only a human looking
at the Sentry dashboard can confirm receipt.

1. Confirm the DSN is set in Vercel (server `SENTRY_DSN` and/or
   `NEXT_PUBLIC_SENTRY_DSN`). If it is not set, the test route answers
   **503** with an honest message — set the DSN first, redeploy, retry.
2. Sign in to the live site as an admin.
3. In the browser DevTools console (on the live site, so the session
   cookie is sent), run:
   ```js
   await fetch('/api/v1/admin/sentry-test', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ kind: 'exception' }),
   }).then(r => r.json());
   ```
   Expect `{ success: true, data: { sent: true, kind: 'exception',
   eventId: "<hex>" } }`.
   - `kind: 'message'` sends an info-level test message instead.
   - A 401/403 means the signed-in user is not an admin; a 429 means
     the 10/min test limit fired — wait a minute and retry.
4. Open **Sentry → Issues** for the SmartBuy project. Within a minute
   you should see the test exception titled
   `SmartBuy AI Sentry test exception`, tagged
   `test=smartbuy-sentry-test`.
5. **Only after step 4: the flow is verified.** The API response alone
   proves the code path ran and the SDK flushed — it does NOT prove
   dashboard receipt. Do not mark S4#14 done on the API response.

If the event does NOT appear after 2 minutes: check Vercel Runtime
Logs for the request, confirm the deployed commit contains the test
route, and confirm the DSN value in Vercel matches the Sentry
project's DSN (Project Settings → Client Keys (DSN)).

## Step 2 — Alerts (owner, Sentry dashboard, free tier)

Create one alert rule so a new error reaches the owner before a user
reports it:

1. Sentry → Alerts → Create Alert Rule → "An issue is first seen"
   (or "An issue's state changes to unresolved" for regressions).
2. Action: **Send an email** to the owner (Sentry account email).
3. Filter: exclude the test tag (`test != smartbuy-sentry-test`) so
   test events never page anyone.
4. Name it `SmartBuy — new issue`.

Optional (free tier allows it): a second rule for issue volume —
"An issue is seen more than 10 times in 1 hour" → email. Add it only
after the first rule has run quietly for a week; otherwise triage
noise will train the owner to ignore the alerts.

## Weekly triage routine (~15 minutes, Mondays)

1. Open Sentry → Issues, filter **Unresolved**, sort by **Freq** (last
   7 days).
2. For each issue, decide one of:
   - **Fix now** — user-facing crash or broken checkout/payment flow.
     File it as a task with the issue link; fix in the next batch.
   - **Fix this week** — real bug, limited blast radius. Link it to
     the existing task or create one.
   - **Ignore (with reason)** — known, harmless, or third-party noise
     (e.g. a browser-extension error). Use Sentry's Ignore with a
     comment, never silent deletion.
   - **Needs repro** — cannot tell from the stack trace alone; note
     what is missing (URL, user action, release) and move on.
3. Check **Releases** (if releases are configured) — a spike right
   after a deploy points at that deploy, not at old code.
4. Resolve issues that have not recurred in 7 days after a fix.
5. If the week's top issue is a rate-limit 429 storm or a bot pattern,
   that is a rate-limit tuning signal — see `docs/rate-limits.md`,
   not a code bug.

## What Sentry does NOT cover

- **Uptime** — Sentry reports errors, not "site down". Use a free
  uptime monitor (e.g. UptimeRobot) for that; see Section 4 item 13
  in the future-features list.
- **Performance** — `tracesSampleRate: 0.1` samples transactions; it
  is not an APM replacement and is not monitored here.
- **Log search** — Vercel Runtime Logs remain the place for
  `logger.error` lines (e.g. the Stripe live-mode block). Sentry
  only sees captured exceptions/messages.
