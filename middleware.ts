import { updateSession } from '@/lib/supabase/middleware';
import { getRegionByCountry, languageForCountry } from '@/lib/region';
import type { NextRequest } from 'next/server';

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
  const response = await updateSession(request);

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
