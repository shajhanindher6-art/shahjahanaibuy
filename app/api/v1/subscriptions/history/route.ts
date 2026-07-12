/**
 * Billing history endpoint.
 * GET /api/v1/subscriptions/history — fetches the user's billing history.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { getBillingHistory } from '@/services/stripe';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'subscriptions.history' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const history = await getBillingHistory(supabase, auth.userId);
    return apiSuccess(history);
  } catch {
    return internalError('Failed to fetch billing history');
  }
}
