/**
 * API v1 dashboard drops-to-watch endpoint — AI Glass dashboard.
 * GET /api/v1/dashboard/drops-to-watch — the signed-in user's
 * tracked products whose real price history simulates a future
 * drop window (Option 10 drop-window simulator, reused — no second
 * engine, no new formula).
 *
 * Auth required and owner-scoped: only the caller's own wishlist
 * items are considered. At most 6 tracked products are simulated.
 * Only status === 'simulated' is returned; 'not_enough_data' and
 * 'no_drops' are never presented as an upcoming drop. An empty
 * list is honest — it means nothing the user tracks simulates a
 * drop right now, not that the feature is broken.
 *
 * Every value is a simulation from real recorded points, never a
 * forecast: windowDays and the target range are ranges, never a
 * single date or price, and the UI must label them as simulated.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { getUserTracking } from '@/services/tracking';
import { getCachedPriceHistory } from '@/services/price-history';
import { simulateDropWindow } from '@/services/drop-window';
import { qualifiesAsDropToWatch } from '@/services/dashboard-helpers';

const MAX_PRODUCTS = 6;

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'dashboard.drops-to-watch' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const tracking = await getUserTracking(supabase, auth.userId);
    const items = tracking.items.slice(0, MAX_PRODUCTS);

    const drops = [];
    for (const item of items) {
      const { history } = await getCachedPriceHistory(supabase, item.product.id, {
        limit: 100,
      });
      const points = history
        .map((h) => ({ price: Number(h.price), recordedAt: h.recordedAt }))
        .filter((h) => Number.isFinite(h.price) && h.recordedAt);
      const sim = simulateDropWindow(points);
      if (!qualifiesAsDropToWatch(sim.status)) continue;
      drops.push({
        productId: item.product.id,
        productName: item.product.name,
        productSlug: item.product.slug,
        currentPrice: history.length > 0 ? history[0].price : null,
        windowDays: sim.windowDays,
        simulatedTargetRangeUsd: sim.simulatedTargetRangeUsd,
        confidence: sim.confidence,
        reason: sim.reason,
      });
    }

    return apiSuccess(drops, 200, {
      trackedCount: tracking.items.length,
      simulatedCount: drops.length,
    });
  } catch {
    return internalError('Failed to fetch drops to watch');
  }
}
