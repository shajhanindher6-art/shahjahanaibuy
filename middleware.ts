import { updateSession } from '@/lib/supabase/middleware';
import { getRegionByCountry } from '@/lib/region';
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
 *   Switcher choice always wins over detection.
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
      });
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
