/**
 * API v1 product AI review summary endpoint.
 * GET /api/v1/products/[slug]/review-summary — template-based textual
 * summary of a product's reviews (short summary, pros, cons, overall
 * verdict, verified-purchase split, most helpful review). The
 * components/products/ai-review-summarizer.tsx card renders this
 * response on the product page.
 *
 * Public (no auth required), like the reviews endpoint. Returns
 * data: null when the product has no reviews, so the UI can show its
 * existing "No reviews yet" empty state. Kept as a separate route so
 * the existing reviews API shape (which the product page normalises)
 * does not change.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getCachedProductBySlug } from '@/services/products';
import { getReviewAISummary } from '@/services/review-summary';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.review-summary', slug: params.slug });

  try {
    const supabase = await createSupabaseServerClient();
    const product = await getCachedProductBySlug(supabase, params.slug);

    if (!product) {
      return notFound('Product not found');
    }

    const summary = await getReviewAISummary(supabase, product.id);

    return apiSuccess(summary);
  } catch {
    return internalError('Failed to fetch review summary');
  }
}
