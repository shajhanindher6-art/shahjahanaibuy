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
 *
 * Sections 21–25, Stage G, G-P1-3 (audit §1 #25 + J-P1-2) —
 * UNIFORM COVERAGE, not just admin routes. The cookie-auth
 * verdict, verified in this change:
 * - Supabase SSR auth cookies ARE SameSite=Lax (verified in the
 *   installed `@supabase/ssr` package: `utils/constants.js`
 *   defaults `sameSite: "lax"`; no `cookieOptions` override in
 *   `lib/supabase/server.ts`). Lax already stops a cross-site
 *   POST from carrying the session cookie, so CSRF is mitigated
 *   even before this check — but Lax alone is not the whole
 *   story (same-site subdomains, and any future GET mutation
 *   would be exposed), so the Origin check below is applied as
 *   defense-in-depth, not as the only control.
 * - The check is now applied in TWO layers: (1) the root
 *   `middleware.ts` rejects any mutating `/api/*` request whose
 *   Origin host mismatches (covers all 103 mutating route files,
 *   including the ~56–80 cookie-auth ones, without touching each
 *   file); (2) every mutating admin route ALSO calls
 *   `checkCsrfOrigin` directly, so the protection survives a
 *   middleware matcher change. Both layers fail open on an
 *   absent Origin, so non-browser callers (curl, cron-job.org,
 *   Stripe webhooks, server-to-server) are unaffected.
 */
import type { NextRequest } from 'next/server';
import { forbidden } from './responses';

/** Mutating HTTP methods — the only methods a CSRF forgery can use. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * True when this request is a mutating call to the API surface
 * (`/api/...` + POST/PUT/PATCH/DELETE). Used by the root
 * middleware (Sections 21–25, Stage G, G-P1-3) to apply the
 * Origin check uniformly to every cookie-authenticated mutation
 * instead of relying on each of the 103 mutating route files to
 * remember it: the audit counted 80 route files that reference
 * `requireAuth`/`requireAdmin` (file-level; the audit's own
 * handler-level count was 56 cookie-auth mutating files) and only
 * 4 of them called `checkCsrfOrigin`. GETs are never checked —
 * no route in the tree mutates on GET, and a forged GET that
 * carries cookies is exactly what SameSite=Lax already stops
 * from changing state.
 */
export function isMutatingApiRequest(request: NextRequest): boolean {
  return (
    MUTATING_METHODS.has(request.method.toUpperCase()) &&
    request.nextUrl.pathname.startsWith('/api/')
  );
}

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
