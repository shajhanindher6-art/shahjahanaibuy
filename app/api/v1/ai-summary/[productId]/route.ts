/**
 * API v1 AI product summary endpoint.
 * GET /api/v1/ai-summary/[productId] — deterministic
 * (template-based, no LLM) summary with pros, cons, and
 * alternatives. (Section 21, Stage E, E-P2-4: was "AI-generated",
 * which overstates a deterministic-only engine.)
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import { getProductById, getProductBySlug } from '@/services/products';
import { getAISummary } from '@/services/ai-summary';

// Section 14, Chunk 1 — live per-request data: never statically prerendered.
export const dynamic = 'force-dynamic';
// Section 19, Phase 1 (§12 #10) — expensive inline AI work runs under
// maxDuration 60 (matching the 5 cron routes), not the platform default.
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  logApiRequest(request, { endpoint: 'ai-summary', productId: params.productId });
  const startedAt = Date.now();
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`ai-summary.productId:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.productId);
    const product = isUuid
      ? await getProductById(supabase, params.productId)
      : await getProductBySlug(supabase, params.productId);

    if (!product) {
      return notFound('Product not found');
    }

    const summary = await getAISummary(supabase, product);

    if (!summary) {
      return notFound('Unable to generate AI summary');
    }

    return apiSuccess(summary, 200);
  } catch (err) {
    logApiError(err, { request, route: 'ai-summary', status: 500, startedAt });
    return internalError('Failed to generate AI summary');
  }
}
