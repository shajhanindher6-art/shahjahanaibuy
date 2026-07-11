/**
 * API v1 analytics endpoint.
 * GET /api/v1/analytics — aggregate analytics dashboard data for the authenticated user.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'analytics' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();

    // Event counts grouped by type.
    const { data: eventData, error: eventError } = await supabase
      .from('analytics_events')
      .select('event_type');
    const eventsByType: Record<string, number> = {};
    if (!eventError && eventData) {
      for (const row of eventData as Array<Record<string, unknown>>) {
        const type = String(row.event_type ?? 'unknown');
        eventsByType[type] = (eventsByType[type] ?? 0) + 1;
      }
    }

    // Affiliate clicks — total conversions and revenue.
    const { data: clickData, error: clickError } = await supabase
      .from('affiliate_clicks')
      .select('clicked_price');
    let totalConversions = 0;
    let totalRevenue = 0;
    if (!clickError && clickData) {
      totalConversions = clickData.length;
      for (const row of clickData as Array<Record<string, unknown>>) {
        if (typeof row.clicked_price === 'number') {
          totalRevenue += row.clicked_price;
        }
      }
    }

    // Active subscriber count.
    const { count: activeSubscribers, error: subError } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    const summary = {
      eventsByType,
      affiliate: {
        totalConversions,
        totalRevenue,
      },
      subscriptions: {
        activeCount: subError ? 0 : (activeSubscribers ?? 0),
      },
    };

    return apiSuccess(summary);
  } catch {
    return internalError('Failed to fetch analytics');
  }
}
