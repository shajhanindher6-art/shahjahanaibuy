/**
 * API v1 user preferences endpoint.
 * GET /api/v1/preferences — fetch the authenticated user's preferences.
 * PUT /api/v1/preferences — upsert the authenticated user's preferences.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  getUserPreferences,
  upsertUserPreferences,
  type UpdatePreferencesInput,
} from '@/services/user-preferences';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'preferences' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`preferences:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const preferences = await getUserPreferences(supabase, auth.userId);

    return apiSuccess(preferences, 200);
  } catch {
    return internalError('Failed to fetch preferences');
  }
}

export async function PUT(request: NextRequest) {
  logApiRequest(request, { endpoint: 'preferences.update' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`preferences:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const {
      budgetMin,
      budgetMax,
      favoriteBrands,
      favoriteCategories,
      preferredRetailers,
      notificationEmail,
      notificationPush,
    } = body ?? {};

    const input: UpdatePreferencesInput = {};

    if (budgetMin !== undefined) input.budgetMin = typeof budgetMin === 'number' ? budgetMin : null;
    if (budgetMax !== undefined) input.budgetMax = typeof budgetMax === 'number' ? budgetMax : null;
    if (Array.isArray(favoriteBrands)) input.favoriteBrands = favoriteBrands;
    if (Array.isArray(favoriteCategories)) input.favoriteCategories = favoriteCategories;
    if (Array.isArray(preferredRetailers)) input.preferredRetailers = preferredRetailers;
    if (typeof notificationEmail === 'boolean') input.notificationEmail = notificationEmail;
    if (typeof notificationPush === 'boolean') input.notificationPush = notificationPush;

    const supabase = await createSupabaseServerClient();
    const preferences = await upsertUserPreferences(supabase, auth.userId, input);

    if (!preferences) {
      return internalError('Failed to update preferences');
    }

    return apiSuccess(preferences, 200);
  } catch {
    return internalError('Failed to update preferences');
  }
}
