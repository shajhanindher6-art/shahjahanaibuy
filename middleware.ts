import { updateSession } from '@/lib/supabase/middleware';
import { getRegionByCountry, languageForCountry } from '@/lib/region';
import { buildCsp } from '@/lib/csp';
import { resolveSlugRequest } from '@/lib/middleware/slug-exists';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Root middleware. Existing behaviour is preserved: updateSession
 * still refreshes the Supabase session and redirects authenticated
 * users away from auth pages. Region detection is additive only:
 *
 * - When the visitor has NO saved `sb-country` cookie, and Vercel
 *   supplies a geo country header (x-vercel-ip-country) for a
 *   country in the region registry, set `sb-country` on the
 *   response so the client provider starts in the right region.
 * - A saved choice is never overwritten here — a manual Country
 *   Switcher choice always wins over detection. The same rule
 *   holds for the sb-language cookie seeded below from geo
 *   detection: it is only set when no language cookie exists.
 * - Outside Vercel (local dev, no geo header) nothing is set and
 *   the client falls back to its IP lookup / browser guess.
 */
export async function middleware(request: NextRequest) {
  // CSP Phase 2: one fresh nonce per request. It travels to the page
  // render as the x-nonce request header (Next.js applies it to its
  // own inline scripts) and back to the browser in the CSP response
  // header below. A UUID is a valid nonce value (hex + hyphens only).
  // Set on the request BEFORE updateSession, because updateSession
  // builds its NextResponse from this same request object.
  const nonce = crypto.randomUUID();
  request.headers.set('x-nonce', nonce);

  // Soft-404 (2026-11-12): the [slug]/layout.tsx existence checks
  // cannot produce HTTP 404 live — the root app/loading.tsx streams
  // its shell with 200 before any async notFound() runs (proven in
  // a minimal Next 13.5.9 repro). This pre-render check runs before
  // any rendering or session work: an unknown slug is rewritten to
  // /__smartbuy_not_found__, a path that matches NO route, so Next
  // returns its routing-level 404 (the real app/not-found.tsx UI,
  // HTTP 404) without rendering anything through the loading
  // boundary — the browser URL stays on the requested slug.
  // (Two alternatives were PROVEN not to work in the repro while
  // the root loading.tsx exists: rewriting to a sync route that
  // calls notFound() still streams the shell with 200, and the
  // layout check itself is what failed live in the first place.
  // The nonexistent-path rewrite is the only variant that returned
  // 404 with the real not-found UI. NEVER create a route at
  // /__smartbuy_not_found__ — it would silently break this.)
  // Fail-open: on any check error the request proceeds exactly as
  // before (the session refresh, CSP and region cookies below are
  // untouched). A session refresh is skipped for 404s — bots hitting
  // bad slugs need no auth state — but the CSP header is still set.
  if ((await resolveSlugRequest(request.nextUrl.pathname)) === 'rewrite') {
    const gone = NextResponse.rewrite(
      new URL('/__smartbuy_not_found__', request.url)
    );
    gone.headers.set('Content-Security-Policy', buildCsp(nonce));
    return gone;
  }

  const response = await updateSession(request);

  // The CSP header lives here now (per-request nonce), NOT in
  // next.config.js — a static header there cannot carry a nonce.
  response.headers.set('Content-Security-Policy', buildCsp(nonce));

  const saved = request.cookies.get('sb-country')?.value;
  if (!saved) {
    const geoCountry = request.headers.get('x-vercel-ip-country');
    if (geoCountry && getRegionByCountry(geoCountry)) {
      response.cookies.set('sb-country', geoCountry.toUpperCase(), {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
        // Production is HTTPS-only (Vercel), so the cookie must never
        // travel over plain HTTP. Local dev stays http, where a
        // secure cookie would never be set.
        secure: process.env.NODE_ENV === 'production',
      });
      // First-paint language support (see RegionProvider header
      // note): seed an sb-language cookie from the same geo
      // detection, ONLY when the visitor has no language cookie
      // yet — a manual Language Switcher choice writes its own
      // cookie and is never overwritten here. The client provider
      // still lets a saved localStorage language win over this
      // cookie and heals the cookie to it, so this seed can only
      // ever be a default, never an override.
      if (!request.cookies.get('sb-language')?.value) {
        response.cookies.set('sb-language', languageForCountry(geoCountry), {
          path: '/',
          maxAge: 60 * 60 * 24 * 365,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        });
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
