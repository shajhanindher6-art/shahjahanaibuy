# API error logging + request IDs (Section 18, Phase 0)

Audit: §1 #4 (API errors invisible — 137/181 routes logged nothing in
their catch blocks, zero `captureException` calls in any API route),
§1 #37 (no request IDs), §12 items 44, 9, 52.

## The helper — `logApiError` (`lib/api/error-logging.ts`)

One shared helper. Do not build a second one.

```ts
import { logApiError } from '@/lib/api/error-logging';

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  // ... rate limit, auth ...
  try {
    // ... work ...
  } catch (err) {
    logApiError(err, { request, route: 'subscriptions.upsert', status: 500, startedAt });
    return internalError('Failed to update subscription');
  }
}
```

Contract (item 9) — every call records:

| Field | Source |
|---|---|
| `status` | `options.status` (default 500) — the HTTP status of the response returned for this error |
| `durationMs` | `options.durationMs`, else `Date.now() - options.startedAt` when `startedAt` is passed |
| `requestId` | the `x-request-id` header (set by `middleware.ts`); a fresh UUID when no request object is available |
| `route` | `options.route`, else the request pathname |
| `error` | the error message (server-side log only — never in the response) |
| `method`, `path` | from the request, when one is passed |
| `context` | extra structured fields you pass (masked by the logger — never secrets) |

`logApiError` returns the request id. It never throws: a failure
inside the log call or the Sentry call is swallowed so error
reporting can never break the error response.

### Sentry capture (item 44)

`captureException` fires ONLY when a DSN is configured
(`SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN`). Sentry is
dormant/unproven live — the DSN presence is **maloom nahi** — so
with no DSN the helper is a structured log line and nothing else.
Owner-gated follow-up: set the DSN + alert rules in the Sentry
dashboard (audit §12 owner item 14). The event carries
`tags: { route, status }` and `extra: { requestId, durationMs, ...context }`.

### Persistent store — the `error_log` writer (Phase 2 follow-up to item 45)

`logApiError` also persists every error to the `error_log` table
(migration 048, `supabase/migrations/20261112210000_048_error_log.sql`)
via `writeErrorLog` (`lib/api/error-logging.ts`) — one row per error:
`level`, `message`, `request_id`, `route`, `user_id` when known
(pass `userId` in the options), and `meta` JSONB (`status`,
`durationMs`, `...context`).

- **Best-effort, fire-and-forget:** the insert runs after the log +
  Sentry capture and never blocks the response; it never throws.
- **Table missing (migration 048 unapplied):** the insert returns
  the missing-table outcome (42P01/PGRST205) and is skipped with a
  debug log — no error, no throw. Until the owner applies 048, rows
  are simply not stored; nothing is lost that was ever stored.
- **No service-role key:** no client exists, the write is skipped
  with a debug log.
- **Read side:** `/owner` lists the most recent rows
  (`listRecentErrors`, `services/error-log-admin.ts`); per-product
  refresh failures are listed on `/admin/refresh-runs`
  (`listRefreshFailures` — rows with `route='prices.refresh'` and a
  `productId` in `meta`, written by `markProductRefreshFailed`).
- **Same writer, one insert function:** both `logApiError` and
  `markProductRefreshFailed` go through `insertErrorLogRow`
  (`services/error-log-admin.ts`) — do not build a second writer.

### No request object? Pass `route`

Service-level helpers without a request (e.g. the prices/refresh
step helpers) log with a route label instead:

```ts
logApiError(err, { route: 'prices.refresh', status: 500, context: { step: 'checkGuestEmailAlerts', alertId: row.id } });
```

## Request IDs (`lib/api/request-id.ts`, `middleware.ts`)

- **One generation site:** the root `middleware.ts` calls
  `ensureRequestId(request)` once per request. An inbound
  `x-request-id` is reused (so an upstream proxy can correlate
  end to end); otherwise a UUID is generated and stamped onto the
  request headers.
- **One header:** the same id is returned on every response as
  `x-request-id` — including the soft-404 rewrite response — so a
  user-reported error can be found in Vercel logs / Sentry by id.
- **Logger support:** `logApiRequest` includes `requestId` in
  every request log line, read off the same header. No tracing
  vendor, no external sink.

## Adoption pattern (for later workers, route by route)

1. Add `const startedAt = Date.now();` at the top of the handler
   (after `logApiRequest`).
2. In each `catch`, bind the error (`catch (err)`) and call
   `logApiError(err, { request, route: '<stable-label>', status: <the status you return>, startedAt })`.
   The route label is the `endpoint` string the handler already
   passes to `logApiRequest` (e.g. `'subscriptions'`,
   `'admin.intake'`).
3. Do NOT change the response: same helper, same public message,
   no error detail or stack trace in the body.
4. Do NOT convert `logger.warn` degradation logs (missing table,
   load failure, expected skip) into `logApiError` — those are not
   errors and must not become Sentry noise. Only error-level
   sites convert.

## Wired so far (Phase 0, first set — 9 catch sites, 5 routes)

| Route | Sites |
|---|---|
| `app/api/v1/subscriptions/route.ts` | GET catch, POST catch |
| `app/api/webhooks/stripe/route.ts` | signature-verification catch (400), processing catch (500), service-client-unavailable branch (503) |
| `app/api/v1/admin/intake/route.ts` | body-parse catch (400), preview + approve `loadCatalogContext` catches (500) |
| `app/api/v1/admin/merchants/[slug]/verify/route.ts` | outer catch (500) |
| `app/api/v1/prices/refresh/route.ts` | `checkGuestEmailAlerts` per-alert error (500). The other step-helper catches already log via `logger.warn`/`logger.error` and record the failure in the run's step summary — they stay as-is by design. The POST handler has no outer catch because `runRefreshStep` isolates every step. |

Remaining 172 routes adopt the helper in later Section 18 work;
nothing else in this slice changes response shapes.

## What NOT to do

- Never pass a secret, token, password, or credential value in
  `context` or inside an error message — pass an id / code. The
  logger masks sensitive *keys* (`lib/config/logger.ts`), but it
  cannot scrub a secret embedded in a free-text message.
- Never call `captureException` directly from a route — go
  through `logApiError` so the DSN guard and the structured fields
  stay in one place.
- Log lines are JSON (Section 18, item 56): one JSON object per
  line, `{ timestamp, level, message, ...meta }` — parse them, do
  not grep for the old `[ISO] LEVEL: msg {json}` text format.
