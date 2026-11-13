/**
 * API v1 recommendation feedback endpoint (Section 19, Phase 4, §12 #42).
 * POST /api/v1/recommendations/feedback { productId, feedback: 'dismissed' | 'undismiss' }
 *
 * A dismiss lands the product in the user's own "Not interested"
 * list (services/recommendation-feedback.ts), and
 * `getRecommendations` excludes it from then on — the feedback
 * loop is real: dismiss → the product is not recommended again.
 * `undismiss` removes it from that list, making it recommendable
 * again. Only dismiss/undismiss exist: a thumbs-up IS the save
 * (POST /api/v1/recommendations/saved), and a free-text reason has
 * nowhere honest to live until a dedicated feedback table exists
 * (see the limitation note in services/recommendation-feedback.ts).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError, validationError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import { validateBody, recommendationProductSchema } from '@/lib/api/validation';
import {
  dismissRecommendation,
  undismissRecommendation,
} from '@/services/recommendation-feedback';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'recommendations.feedback' });
  const limited = await rateLimitResponse(`recommendations.feedback:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    // Final 100%, F-P1-60 — schema validation for productId
    // (the route keeps its own `feedback` enum check + message).
    const validation = validateBody(recommendationProductSchema, body ?? {});
    // Narrowing check (not invalidBodyResponse — it does not narrow
    // the union, so validation.data would not type-check). Same 400
    // as invalidBodyResponse: the first error, same message.
    if (!validation.success) {
      const firstError = Object.values(validation.errors).flat()[0];
      return badRequest(firstError ?? 'Invalid request body');
    }
    const productId = typeof validation.data.productId === 'string' ? validation.data.productId.trim() : '';
    const feedback = body?.feedback;
    if (!productId) return validationError('productId is required.');
    if (feedback !== 'dismissed' && feedback !== 'undismiss') {
      return validationError("feedback must be 'dismissed' or 'undismiss'.");
    }

    const supabase = await createSupabaseServerClient();
    if (feedback === 'dismissed') {
      const result = await dismissRecommendation(supabase, auth.userId, productId);
      if (!result) {
        return internalError(
          'Could not dismiss this recommendation yet — the feedback store is not set up. Nothing was dismissed.'
        );
      }
      return apiSuccess(result, 200);
    }
    const undismissed = await undismissRecommendation(supabase, auth.userId, productId);
    return apiSuccess({ undismissed }, 200);
  } catch (err) {
    logApiError(err, { request, route: 'recommendations.feedback', status: 500 });
    return internalError('Failed to record recommendation feedback');
  }
}
