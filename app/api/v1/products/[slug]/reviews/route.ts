/**
 * API v1 product reviews endpoint.
 * GET  /api/v1/products/[slug]/reviews — paginated reviews for a product.
 * POST /api/v1/products/[slug]/reviews — create a review (auth required).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  notFound,
  internalError,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { getCachedProductBySlug, incrementViewCount } from '@/services/products';
import {
  getReviews,
  getReviewSummary,
  createReview,
  type CreateReviewInput,
} from '@/services/reviews';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.reviews', slug: params.slug });

  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 10)));
    const rating = searchParams.get('rating')
      ? Number(searchParams.get('rating'))
      : undefined;

    const supabase = await createSupabaseServerClient();
    const product = await getCachedProductBySlug(supabase, params.slug);

    if (!product) {
      return notFound('Product not found');
    }

    const [reviews, summary] = await Promise.all([
      getReviews(supabase, product.id, { page, pageSize, rating }),
      getReviewSummary(supabase, product.id),
    ]);

    return apiSuccess(
      { reviews: reviews.reviews, summary },
      200,
      {
        page: reviews.page,
        pageSize: reviews.pageSize,
        total: reviews.total,
        totalPages: reviews.totalPages,
      }
    );
  } catch {
    return internalError('Failed to fetch reviews');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.reviews.create', slug: params.slug });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { rating, title, content, verifiedPurchase } = body ?? {};

    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      return badRequest('rating must be a number between 1 and 5');
    }

    const supabase = await createSupabaseServerClient();
    const product = await getCachedProductBySlug(supabase, params.slug);

    if (!product) {
      return notFound('Product not found');
    }

    const input: CreateReviewInput = {
      rating,
      title: typeof title === 'string' ? title : undefined,
      content: typeof content === 'string' ? content : undefined,
      verifiedPurchase: typeof verifiedPurchase === 'boolean' ? verifiedPurchase : false,
    };

    const review = await createReview(supabase, auth.userId, product.id, input);

    if (!review) {
      return internalError('Failed to create review');
    }

    // Increment view count as a popularity signal (best-effort).
    void incrementViewCount(supabase, product.id);

    return apiSuccess(review, 201);
  } catch {
    return internalError('Failed to create review');
  }
}
