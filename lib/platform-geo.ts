/**
 * Section 8 — visitor-country resolution for the local-first /
 * international split, with the detection source attached.
 *
 * HOW DETECTION WORKS (no IP address is ever stored):
 *   1. `ip` — the Vercel geo header (`x-vercel-ip-country`) on
 *      the current request. Vercel derives it from the visitor's
 *      IP, but SmartBuy never sees or stores that IP: only the
 *      two-letter country code reaches the app, and the click
 *      beacon stores country + product + retailer + link only.
 *   2. `saved` — the visitor's own `sb-country` cookie. This is
 *      either a manual Country Switcher choice (which always wins
 *      over detection elsewhere) or a cookie the middleware set
 *      from an earlier detection. The server cannot tell those
 *      two apart, so this source is labelled "your saved country",
 *      never "IP detected".
 *   3. `fallback` — no signal resolved at all, so the display
 *      falls back to US. The UI must say so instead of pretending
 *      the visitor is in the US.
 *
 * Precedence mirrors services/affiliate-geo.ts
 * (resolveGeoCountryOrNull): the header is checked first, then
 * the cookie. An invalid or unknown code never propagates — it
 * falls through to the next signal, then to the US fallback.
 * A manual choice made in the browser (RegionProvider) always
 * wins client-side; this module is the server-side equivalent
 * for API routes and server pages.
 */

import { getRegionByCountry } from '@/lib/region';
import { GEO_FALLBACK_COUNTRY } from '@/services/affiliate-geo';

/** Where the visitor's country came from. */
export type GeoDetectionSource = 'ip' | 'saved' | 'fallback';

export interface ResolvedVisitorCountry {
  /** Country code the page/API should use (always a valid code). */
  countryCode: string;
  /** How that code was resolved. */
  source: GeoDetectionSource;
  /**
   * The raw detected/saved code, or null when nothing resolved
   * (source is then 'fallback' and countryCode is the US fallback).
   */
  detectedCountryCode: string | null;
}

/**
 * Resolve the visitor's country from a request's geo header and
 * country cookie. Pure — no I/O, so it is unit-testable.
 */
export function resolveServerCountry(args: {
  headerCountry?: string | null;
  cookieCountry?: string | null;
}): ResolvedVisitorCountry {
  const header = (args.headerCountry ?? '').trim().toUpperCase();
  if (header && getRegionByCountry(header)) {
    return { countryCode: header, source: 'ip', detectedCountryCode: header };
  }
  const cookie = (args.cookieCountry ?? '').trim().toUpperCase();
  if (cookie && getRegionByCountry(cookie)) {
    return { countryCode: cookie, source: 'saved', detectedCountryCode: cookie };
  }
  return {
    countryCode: GEO_FALLBACK_COUNTRY,
    source: 'fallback',
    detectedCountryCode: null,
  };
}

/**
 * One-line, honest label for the detection source, for the
 * product-page and homepage store sections. The region name is
 * passed in so this module never has to look it up.
 */
export function geoSourceLabel(
  source: GeoDetectionSource,
  regionName: string
): string {
  if (source === 'ip') {
    return `Detected from your location: ${regionName}. Change it anytime with the Country Switcher.`;
  }
  if (source === 'saved') {
    return `Using your saved country: ${regionName}. Change it anytime with the Country Switcher.`;
  }
  return `Country could not be detected, so worldwide stores are shown first. Pick your country with the Country Switcher to see local stores first.`;
}
