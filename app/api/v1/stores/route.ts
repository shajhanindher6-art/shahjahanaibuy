/**
 * Section 8 — local-first + international stores endpoint
 * (public read, no auth).
 * GET /api/v1/stores?country=<CC>&q=<product name, optional>
 *
 * Resolves the visitor's country from the Vercel geo header
 * (IP-derived country code only — the IP itself is never stored),
 * then the saved `sb-country` cookie, then the US fallback, and
 * returns BOTH buckets, local first:
 *   - `local`: the country's own CONFIRMED local stores only
 *     ([] when the country has none — never silently filled).
 *   - `international`: worldwide retailers, excluding any store
 *     already in `local` by slug.
 *
 * Both buckets are search links only — no price, stock, deal, or
 * partnership is claimed. `searchUrl` is included only when `q`
 * is given (the product name to search for on the store's site).
 * An explicit `country` query param, when it names a real region,
 * overrides detection (preview / switcher use); an invalid code
 * is ignored and detection applies instead.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, badRequest } from '@/lib/api/responses';
import {
  logApiRequest,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import {
  buildStoreSearchUrl,
  getStoresSplit,
  type LocalStore,
} from '@/lib/stores';
import { FALLBACK_REGION, getRegionByCountry } from '@/lib/region';
import { resolveServerCountry } from '@/lib/platform-geo';

export const dynamic = 'force-dynamic';

interface StoreEntry {
  name: string;
  slug: string;
  countryCode: string;
  websiteUrl: string;
  searchUrl: string | null;
}

function toEntry(store: LocalStore, query: string | null): StoreEntry {
  return {
    name: store.name,
    slug: store.slug,
    countryCode: store.countryCode,
    websiteUrl: store.websiteUrl,
    searchUrl: query ? buildStoreSearchUrl(store, query) : null,
  };
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'stores' });
  const limited = await rateLimitResponse(
    `stores:${getClientIp(request)}`,
    120
  );
  if (limited) return limited;

  const params = request.nextUrl.searchParams;
  const rawQuery = params.get('q');
  let query: string | null = null;
  if (rawQuery !== null) {
    const trimmed = rawQuery.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      return badRequest(
        'Search query must be 1-200 characters when provided'
      );
    }
    query = trimmed;
  }

  const detected = resolveServerCountry({
    headerCountry: request.headers.get('x-vercel-ip-country'),
    cookieCountry: request.cookies.get('sb-country')?.value ?? null,
  });
  const requested = (params.get('country') ?? '').trim().toUpperCase();
  const countryCode =
    requested && getRegionByCountry(requested)
      ? requested
      : detected.countryCode;
  const source =
    requested && getRegionByCountry(requested) ? 'saved' : detected.source;
  const region = getRegionByCountry(countryCode) ?? FALLBACK_REGION;
  const split = getStoresSplit(countryCode);

  return apiSuccess({
    country: countryCode,
    countryName: region.name,
    source,
    hasLocal: split.hasLocal,
    local: split.local.map((store) => toEntry(store, query)),
    international: split.international.map((store) =>
      toEntry(store, query)
    ),
  });
}
