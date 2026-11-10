/**
 * API v1 dashboard landed-cost endpoint — Option 12 delta.
 * GET /api/v1/dashboard/landed-cost?country=PK — compact landed-cost
 * estimates for the signed-in user's tracked products in their
 * region, for the dashboard widget. This is a SUMMARY, not a second
 * calculator: it reuses the exact same logic as the product-page
 * Landed Cost Calculator and the region-arbitrage table —
 *   - duty: documented 10% placeholder default (DEFAULT_DUTY_PCT),
 *     0 for a domestic US row and 0 under the US de minimis
 *     threshold ($800, the only asserted threshold);
 *   - tax: the standard rate from services/tax-estimator.ts where
 *     listed; null (tax excluded, row flagged) where unknown —
 *     no rate is ever invented;
 *   - shipping: excluded (0) — the full calculator takes the
 *     user's real shipping quote;
 *   - FX: the same daily feed as /api/v1/fx-rates (getFxRates),
 *     with source + fetchedAt so the widget can show the honest
 *     "last updated" line.
 *
 * Auth required and owner-scoped: only the caller's own wishlist
 * items are considered (getUserTracking, same as drops-to-watch).
 * At most 6 tracked products. Items with no recorded price are
 * skipped — an estimate needs a real price — and counted in meta
 * so the widget can say so honestly. An empty list means the user
 * tracks nothing (or nothing priced), not that the feature broke.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getRegionByCountry, type Region } from '@/lib/region';
import { getUserTracking } from '@/services/tracking';
import {
  DEFAULT_DUTY_PCT,
  estimateLandingPrice,
  standardRateForCountry,
} from '@/services/tax-estimator';
import { deMinimisForCountry } from '@/services/duty-optimizer';
import { convertUsdWithRates, getFxRates } from '@/services/fx-rates';

const MAX_PRODUCTS = 6;

export interface LandedCostWidgetItem {
  productId: string;
  productName: string;
  productSlug: string;
  priceUsd: number;
  dutyUsd: number;
  /** Null when the region has no listed standard tax rate. */
  taxUsd: number | null;
  landedUsd: number;
  landedLocal: number;
  /** True when tax is unknown for the region (landed excludes tax). */
  taxUnknown: boolean;
  /** True when the US de minimis threshold made duty + tax 0. */
  dutyFree: boolean;
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'dashboard.landed-cost' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`dashboard.landed-cost:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    // Visitor region from the widget's query param (the client
    // reads it from RegionProvider, the same region the dashboard
    // already prices in). Invalid or missing codes fall back to US.
    const requested = request.nextUrl.searchParams.get('country');
    const region: Region =
      getRegionByCountry(requested) ??
      ({ code: 'US', name: 'United States', currency: 'USD', locale: 'en-US' } as Region);
    const countryCode = region.code;

    const supabase = await createSupabaseServerClient();
    const [tracking, fx] = await Promise.all([
      getUserTracking(supabase, auth.userId),
      getFxRates(),
    ]);
    const items = tracking.items.slice(0, MAX_PRODUCTS);

    const standard = standardRateForCountry(countryCode);
    const threshold = deMinimisForCountry(countryCode);

    const priced: LandedCostWidgetItem[] = [];
    let unpricedCount = 0;
    for (const item of items) {
      const price = item.currentPrice;
      if (price === null || !Number.isFinite(price)) {
        unpricedCount += 1;
        continue;
      }
      // Same branches as the product-page calculator: US de minimis
      // under the threshold is duty- and tax-free; otherwise the
      // estimator formula with the placeholder duty and the listed
      // standard tax rate (or no tax when the rate is unknown).
      const thresholdApplies = threshold !== null && price < threshold;
      let dutyUsd: number;
      let taxUsd: number | null;
      let landedUsd: number;
      if (thresholdApplies) {
        dutyUsd = 0;
        taxUsd = 0;
        landedUsd = Math.round(price * 100) / 100;
      } else {
        const est = estimateLandingPrice({
          priceUsd: price,
          dutyPct: DEFAULT_DUTY_PCT,
          vatPct: standard ? standard.ratePct : 0,
          shippingUsd: 0,
        });
        dutyUsd = est.dutyUsd;
        taxUsd = standard ? est.vatUsd : null;
        landedUsd = est.priceUsd + est.dutyUsd + (taxUsd ?? 0);
      }
      priced.push({
        productId: item.product.id,
        productName: item.product.name,
        productSlug: item.product.slug,
        priceUsd: Math.round(price * 100) / 100,
        dutyUsd,
        taxUsd,
        landedUsd: Math.round(landedUsd * 100) / 100,
        landedLocal: convertUsdWithRates(landedUsd, region.currency, fx.rates),
        taxUnknown: !thresholdApplies && standard === null,
        dutyFree: thresholdApplies,
      });
    }

    return apiSuccess(
      {
        country: countryCode,
        countryName: region.name,
        currency: region.currency,
        locale: region.locale,
        dutyPct: DEFAULT_DUTY_PCT,
        taxRatePct: standard ? standard.ratePct : null,
        taxLabel: standard ? standard.label : null,
        items: priced,
        fx: { source: fx.source, fetchedAt: fx.fetchedAt, provider: fx.provider },
      },
      200,
      { trackedCount: tracking.items.length, pricedCount: priced.length, unpricedCount }
    );
  } catch {
    return internalError('Failed to fetch landed-cost estimates');
  }
}
