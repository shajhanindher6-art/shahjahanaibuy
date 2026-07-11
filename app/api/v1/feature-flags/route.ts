/**
 * API v1 feature flags endpoint.
 * GET /api/v1/feature-flags — returns all feature flags.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { FEATURE_FLAG_DEFAULTS } from '@/lib/config/feature-flags';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'feature-flags' });

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
  } catch {
    return internalError('Failed to fetch feature flags');
  }
}
