/**
 * CSRF Origin check — Section 18, Phase 2, item 8 (audit §1 #12).
 *
 * Finding: zero `csrf`/Origin/Referer checks in `app/api`, `lib/api`
 * or `middleware.ts`; no CSRF tokens anywhere. The only mitigations
 * were `SameSite=lax` auth cookies + POST-only mutations.
 *
 * This helper adds an Origin/Host check on mutating
 * cookie-authenticated routes: a browser cross-site POST always
 * carries an `Origin` header, so a request whose Origin host does
 * not match the request Host cannot be a legitimate same-site
 * browser request and is rejected with 403.
 *
 * TRADE-OFF (deliberate, fail-open on absent Origin): a request
 * with NO `Origin` header is allowed. Non-browser clients (curl,
 * server-to-server calls, mobile apps) send no Origin, and
 * rejecting them would break legitimate API use. The check
 * therefore stops cross-site browser forgery — the CSRF threat —
 * not every unauthenticated request; authentication and rate
 * limiting remain the controls for non-browser callers.
 *
 * The comparison is on HOST only (hostname + port), not scheme:
 * same-host http/https differences are a deployment detail, not
 * a cross-site signal. An Origin header that cannot be parsed as
 * a URL is treated as a mismatch (403) — a present-but-garbled
 * Origin is not a legitimate browser request.
 *
 * Apply ONLY to cookie-authenticated mutating routes. Do NOT
 * apply to x-api-key, CRON_SECRET, or webhook routes — those are
 * not cookie-authenticated and their callers are non-browser.
 */
import type { NextRequest } from 'next/server';
import { forbidden } from './responses';

/**
 * Returns a 403 response when the request carries an `Origin`
 * header whose host differs from the request `Host`; otherwise
 * returns null (request may proceed).
 */
export function checkCsrfOrigin(request: NextRequest): ReturnType<typeof forbidden> | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;

  // Host header first; fall back to the request URL's host (the
  // platform always sets one of the two — NextRequest objects
  // built in tests carry no Host header, only the URL).
  const host = request.headers.get('host') ?? new URL(request.url).host;
  if (!host) return forbidden('Cross-site request rejected');

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return forbidden('Cross-site request rejected');
  }

  if (originHost.toLowerCase() !== host.toLowerCase()) {
    return forbidden('Cross-site request rejected');
  }
  return null;
}
