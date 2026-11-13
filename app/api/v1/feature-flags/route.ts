/**
 * API v1 feature flags endpoint.
 * GET /api/v1/feature-flags — returns all feature flags.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { FEATURE_FLAG_DEFAULTS } from '@/lib/config/feature-flags';
import type { NextRequest } from 'next/server';

import { logApiError } from '@/lib/api/error-logging';
export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'feature-flags' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`feature-flags:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from('feature_flags').select('key, enabled');

    if (error || !data) {
      return apiSuccess(FEATURE_FLAG_DEFAULTS);
    }

    const flags: Record<string, boolean> = {};
    for (const row of data) {
      flags[row.key] = row.enabled;
    }

    return apiSuccess(flags);
  } catch (err) {
    logApiError(err, { request, route: 'feature-flags', status: 500 });
    return internalError('Failed to fetch feature flags');
  }
}
