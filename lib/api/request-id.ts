/**
 * Request IDs / tracing (Section 18, Phase 0 — audit §1 #37, §12 items 9 + 52).
 *
 * One generation site, one header, no tracing vendor, no external sink.
 *
 * - The root `middleware.ts` calls `ensureRequestId(request)` once per
 *   request: it reuses an inbound `x-request-id` when the caller sent
 *   one (so an upstream proxy / load balancer can correlate end to
 *   end) and generates a UUID otherwise. The same id is returned to
 *   the caller as the `x-request-id` RESPONSE header, so any error
 *   a user reports can be found in the server logs / Sentry by id.
 * - `logApiRequest` and `logApiError` read the id back off the
 *   request headers with `getRequestId` — they never generate a
 *   second id for a request that already has one. (When a handler
 *   is invoked without middleware — local tests, direct calls —
 *   `getRequestId` mints a fresh UUID so the log record still
 *   carries an id; two helpers called on such a bare request will
 *   mint different ids, which is why production traffic must go
 *   through the middleware.)
 */

import type { NextRequest } from 'next/server';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Read the request id off the request headers. Falls back to a
 * fresh UUID when no id was set (see header note) — never throws,
 * never returns an empty string.
 */
export function getRequestId(request: Pick<NextRequest, 'headers'>): string {
  const existing = request.headers.get(REQUEST_ID_HEADER)?.trim();
  return existing || crypto.randomUUID();
}

/**
 * The single generation site. Returns the inbound id when one is
 * present, otherwise generates a UUID and stamps it onto the
 * request headers (mutable in middleware) so every downstream
 * reader — `logApiRequest`, `logApiError`, route handlers — sees
 * the same value.
 */
export function ensureRequestId(request: NextRequest): string {
  const existing = request.headers.get(REQUEST_ID_HEADER)?.trim();
  if (existing) return existing;
  const id = crypto.randomUUID();
  request.headers.set(REQUEST_ID_HEADER, id);
  return id;
}
