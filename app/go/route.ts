/**
 * /go redirect hub (Section 15, A6) — tracking wrapper, 0 new links.
 *
 * GET /go?u=<target>&s=<product-slug>&m=<merchant-name>
 *
 * Validates the target with isTrackableClickHost (MANDATORY — without
 * it this endpoint would be an open redirector), records the click in
 * the same affiliate_geo_clicks table the /api/v1/affiliate/geo-click
 * beacon writes to, then redirects (302) to the target.
 *
 * - Missing target, non-http(s) target, or unlisted host → 400,
 *   NEVER a redirect.
 * - Recording is FAIL-OPEN: when the service client is unconfigured
 *   or the insert fails, the redirect still happens — tracking must
 *   never break navigation (same contract as the geo-click beacon).
 * - No tag values live in this file (env only, via existing helpers).
 *   This route never transforms a URL; it wraps the destination
 *   exactly as given.
 * - Rate-limited 60/min/IP, same as the geo-click beacon.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { badRequest } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/config/logger';
import {
  isTrackableClickHost,
  resolveGeoCountryOrNull,
} from '@/services/affiliate-geo';
import { LOCAL_STORES, GLOBAL_STORES } from '@/lib/stores';

export const dynamic = 'force-dynamic';

/** Directory hosts, as in the geo-click route: the caller passes the
 *  stores directory's websiteUrl hosts into isTrackableClickHost. */
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

function asCappedString(value: string | null, max: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, max);
}

/**
 * Best-effort click record, mirroring the geo-click beacon exactly:
 * same table, same fields, same privacy (no IP, no user agent, no
 * user id — country from the server's own geo signal only). Never
 * throws; a failure only means the click was not stored.
 */
async function recordGoClick(
  request: NextRequest,
  targetUrl: string,
  productSlug: string | null,
  merchantName: string | null
): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      logger.warn(
        '[go] service client unavailable; click not stored (SUPABASE_SERVICE_ROLE_KEY missing)'
      );
      return;
    }
    const country = resolveGeoCountryOrNull(
      request.headers.get('x-vercel-ip-country'),
      request.cookies.get('sb-country')?.value ?? null
    );
    const { error } = await supabase.from('affiliate_geo_clicks').insert({
      product_id: null,
      product_slug: productSlug,
      retailer_name: merchantName,
      target_url: targetUrl,
      country_code: country,
    });
    if (error) {
      logger.error('[go] insert error', {
        code: (error as { code?: unknown }).code ?? null,
        message: error.message,
      });
    }
  } catch {
    // Silent by design — tracking must never break navigation.
  }
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'go.redirect' });

  // Same per-IP cap as the geo-click beacon (60/min); a flood of
  // redirects must not fill the click table.
  const limited = await rateLimitResponse(`go:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const target = asCappedString(request.nextUrl.searchParams.get('u'), 2048);
  if (!target) {
    return badRequest('Missing target URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return badRequest('Target URL is not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return badRequest('Target URL must use http or https');
  }

  // The allowlist check: the ONLY gate between this endpoint and
  // becoming an open redirector. Unlisted hosts are rejected, never
  // redirected — including lookalike hosts such as amazon.evil.com.
  if (!isTrackableClickHost(parsed.hostname, knownStoreHosts())) {
    logger.warn('[go] non-trackable host, redirect refused', {
      host: parsed.hostname,
    });
    return badRequest('Target host is not a trackable merchant host');
  }

  const productSlug = asCappedString(request.nextUrl.searchParams.get('s'), 200);
  const merchantName = asCappedString(request.nextUrl.searchParams.get('m'), 100);

  // Fail-open: the redirect happens even if recording fails.
  await recordGoClick(request, target, productSlug, merchantName);

  return NextResponse.redirect(target, 302);
}
