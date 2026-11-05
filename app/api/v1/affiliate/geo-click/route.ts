/**
 * API v1 geo affiliate click beacon — Phase 3 Prep.
 * POST /api/v1/affiliate/geo-click — record an outbound merchant-link
 * click for the geo-targeted affiliate engine.
 *
 * DELIBERATELY SEPARATE from POST /api/v1/affiliate/click: the older
 * route requires an affiliate_link_id row and runs on the anon client,
 * whose INSERT policy (migration 015) allows authenticated users only
 * — so it cannot track logged-out clicks at all. This beacon needs
 * no link row and no sign-in: it logs the product, the retailer
 * name, the clicked merchant URL, and the geo country, via the
 * service-role client (server env only, never the browser).
 *
 * PRIVACY, BY DESIGN: no IP address, no user agent, no user id is
 * ever stored. Country comes from the server's own geo signal
 * (Vercel header first, saved region cookie second) — the client
 * never sends a location. Target URLs are merchant search links,
 * never user-typed queries.
 *
 * FAIL-OPEN, ALWAYS: the response is always success, even when the
 * service client is unconfigured or the table is missing (the owner
 * runs supabase/add-affiliate-geo-clicks.sql once). Tracking must
 * never break navigation or leak whether a row was stored beyond
 * the harmless `tracked` flag.
 *
 * STEP C STAGE 1 — HOST VALIDATION: a click is stored only when its
 * target host is trackable (same allowlist as the transform endpoint
 * plus go.skimresources.com, see isTrackableClickHost). Anything else
 * is dropped silently with tracked:false. This is a garbage filter,
 * not volume control — burst detection lives in the reporting layer.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  isTrackableClickHost,
  resolveGeoCountryOrNull,
} from '@/services/affiliate-geo';
import { LOCAL_STORES, GLOBAL_STORES } from '@/lib/stores';

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

function asCappedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, max);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'affiliate.geo-click' });

  // The beacon is anonymous by design; the per-IP cap (60/min) sits
  // in front of the existing host validation + burst flagging so a
  // flood cannot fill the table. Fail-open contract is unchanged:
  // over the limit the beacon answers 429 instead of tracking.
  // Redis-backed when Upstash is configured, in-memory fallback otherwise.
  const limited = await rateLimitResponse(`affiliate.geo-click:${getClientIp(request)}`, 60);
  if (limited) return limited;

  let tracked = false;
  try {
    const body: unknown = await request.json().catch(() => null);
    const obj = (body ?? {}) as Record<string, unknown>;

    const targetUrl = asCappedString(obj.targetUrl, 2048);
    const productSlug = asCappedString(obj.productSlug, 200);
    const productId = asCappedString(obj.productId, 100);
    // BUGFIX (2026-11-05): the page beacon sends `merchantName`,
    // but this route only read `retailerName` — so retailer_name was
    // always null and every insert failed 23502. Accept both names.
    const retailerName = asCappedString(
      obj.retailerName ?? obj.merchantName,
      100
    );

    // A click without a valid merchant URL is not trackable; still
    // answer success so the beacon never disturbs navigation.
    // Step C Stage 1: the host must be trackable too — a junk host
    // (anything outside the retailer/directory allowlist and
    // Skimlinks) is dropped, never stored.
    const hostOk =
      targetUrl &&
      isHttpUrl(targetUrl) &&
      isTrackableClickHost(new URL(targetUrl).hostname, knownStoreHosts());
    if (targetUrl && isHttpUrl(targetUrl) && !hostOk) {
      console.warn('[affiliate-geo-click] non-trackable host, click not stored', {
        host: new URL(targetUrl).hostname,
      });
    }
    if (hostOk) {
      // Null when no geo signal resolves — never a guessed country.
      const country = resolveGeoCountryOrNull(
        request.headers.get('x-vercel-ip-country'),
        request.cookies.get('sb-country')?.value ?? null
      );
      const supabase = createSupabaseServiceClient();
      if (!supabase) {
        console.warn(
          '[affiliate-geo-click] service client unavailable; click not stored (SUPABASE_SERVICE_ROLE_KEY missing)'
        );
      } else {
        const { error } = await supabase.from('affiliate_geo_clicks').insert({
          product_id: productId,
          product_slug: productSlug,
          retailer_name: retailerName,
          target_url: targetUrl,
          country_code: country,
        });
        if (error) {
          console.error('[affiliate-geo-click] insert error', {
            code: (error as { code?: unknown }).code ?? null,
            message: error.message,
          });
        } else {
          tracked = true;
        }
      }
    }
  } catch {
    // Beacon failures are silent by design; navigation continues.
  }

  return apiSuccess({ tracked });
}
