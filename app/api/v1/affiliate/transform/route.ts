/**
 * API v1 affiliate transform endpoint — Step B.
 * POST /api/v1/affiliate/transform — batch-transform client-rendered
 * store links (e.g. the arbitrage table) through the geo affiliate
 * engine, server-side.
 *
 * Body: { urls: string[] } (1–20 URLs, each ≤ 2048 chars).
 * Response: { urls: (string | null)[] } in the same order, plus
 * meta.affiliateEnabled. A URL that cannot be transformed (unknown
 * host, unparseable, over the length cap) is returned unchanged;
 * a non-string entry returns null.
 *
 * ANTI-ABUSE: only hostnames from the stores directory
 * (LOCAL_STORES + GLOBAL_STORES websiteUrl hosts) or the big-retailer
 * families (see isTransformableHost) are transformed. Anything else
 * passes through untouched, so this endpoint can never wrap
 * arbitrary URLs through an affiliate redirect.
 *
 * No tag values are ever returned as config — only final URLs, the
 * same strings the shopper would see in a link href.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, badRequest } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  buildGeoAffiliateUrl,
  isGeoAffiliateEnabled,
  isTransformableHost,
  resolveGeoCountry,
} from '@/services/affiliate-geo';
import { LOCAL_STORES, GLOBAL_STORES } from '@/lib/stores';

const MAX_URLS = 20;
const MAX_URL_LEN = 2048;

function knownStoreHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const store of [...LOCAL_STORES, ...GLOBAL_STORES]) {
    try {
      hosts.add(new URL(store.websiteUrl).hostname.toLowerCase());
    } catch {
      // A malformed registry URL simply contributes no host.
    }
  }
  return hosts;
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'affiliate.transform' });

  // Pure URL transform, no DB write — still cap per IP so the
  // batch endpoint cannot be used as a free proxy loop.
  // In-memory bucket (per instance).
  const limited = rateLimitResponse(`affiliate.transform:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const body: unknown = await request.json().catch(() => null);
  const urls = (body ?? {}) as Record<string, unknown>;
  const list = urls.urls;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_URLS) {
    return badRequest('urls must be a non-empty array of at most 20 URLs');
  }

  const country = resolveGeoCountry(
    request.headers.get('x-vercel-ip-country'),
    request.cookies.get('sb-country')?.value ?? null
  );
  const hosts = knownStoreHosts();

  const out = list.map((entry) => {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > MAX_URL_LEN) {
      return null;
    }
    let host: string;
    try {
      host = new URL(entry).hostname.toLowerCase();
    } catch {
      return entry;
    }
    if (!isTransformableHost(host, hosts)) return entry;
    return buildGeoAffiliateUrl(entry, country);
  });

  return apiSuccess({ urls: out }, 200, {
    affiliateEnabled: isGeoAffiliateEnabled(),
  });
}
