/**
 * Reviews data access service.
 * Reads from and writes to the `reviews` table (migration 006).
 *
 * All functions accept an `AnySupabaseClient` so they work with both the
 * browser (anon, RLS-enforced) and server (service role) clients.
 *
 * Database snake_case columns are mapped to camelCase TypeScript properties.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { swrGet, cacheKey } from '@/lib/cache';
import { logger } from '@/lib/config/logger';
import type { Review } from '@/types/catalog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewListOptions {
  page?: number;
  pageSize?: number;
  rating?: number;
}

export interface ReviewListResult {
  reviews: Review[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ReviewSummary {
  averageRating: number;
  totalReviews: number;
  ratingDistribution: Record<number, number>;
}

export interface CreateReviewInput {
  rating: number;
  title?: string;
  content?: string;
  verifiedPurchase?: boolean;
}

// ---------------------------------------------------------------------------
// Row → domain mapper
// ---------------------------------------------------------------------------

interface ReviewRow {
  id: string;
  product_id: string;
  review_source_id: string | null;
  user_id: string | null;
  author_name: string | null;
  rating: number;
  title: string | null;
  content: string | null;
  verified_purchase: boolean;
  helpful_count: number;
  source_url: string | null;
  created_at: string;
  updated_at: string;
}

function mapReview(row: ReviewRow): Review {
  return {
    id: row.id,
    productId: row.product_id,
    reviewSourceId: row.review_source_id,
    userId: row.user_id,
    authorName: row.author_name,
    rating: row.rating,
    title: row.title,
    content: row.content,
    verifiedPurchase: row.verified_purchase,
    helpfulCount: row.helpful_count,
    sourceUrl: row.source_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetch paginated reviews for a product.
 *
 * @param options.page     Page number (1-based, default 1).
 * @param options.pageSize Page size (default 10, max 100).
 * @param options.rating   Filter by exact rating (1-5).
 */
export async function getReviews(
  supabase: AnySupabaseClient,
  productId: string,
  options: ReviewListOptions = {}
): Promise<ReviewListResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 10));
  const offset = (page - 1) * pageSize;

  try {
    let query = supabase
      .from('reviews')
      .select('id, product_id, review_source_id, user_id, author_name, rating, title, content, verified_purchase, helpful_count, source_url, created_at, updated_at', {
        count: 'exact',
      })
      .eq('product_id', productId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (options.rating) {
      query = query.eq('rating', options.rating);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.warn('getReviews: query failed', { error: error.message });
      return { reviews: [], total: 0, page, pageSize, totalPages: 0 };
    }

    const reviews = (data ?? []).map((row) => mapReview(row as ReviewRow));
    const total = count ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    return { reviews, total, page, pageSize, totalPages };
  } catch (err) {
    logger.error('getReviews: unexpected error', { error: String(err) });
    return { reviews: [], total: 0, page, pageSize, totalPages: 0 };
  }
}

/**
 * Compute a review summary for a product.
 * Returns `{ averageRating, totalReviews, ratingDistribution }`.
 * `ratingDistribution` is a map of rating (1-5) → count.
 *
 * Section 18, item 27 — aggregate in Postgres, not in JS: the old
 * code pulled up to 10,000 `rating` rows and counted/averaged them
 * in a loop. Now five COUNT queries (one per rating, `head: true`
 * so Postgres returns only the count and transfers zero rows) run
 * in parallel, and the average is derived from the distribution
 * (Σ rating × count / total). Exact because `reviews.rating` is
 * CHECK-constrained to 1–5 (migration 006) — no row can fall
 * outside the five buckets. Any count query failing returns the
 * zeroed summary, exactly as a failed row-pull did before.
 */
export async function getReviewSummary(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ReviewSummary> {
  const empty: ReviewSummary = {
    averageRating: 0,
    totalReviews: 0,
    ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };
  try {
    const counts = await Promise.all(
      [1, 2, 3, 4, 5].map(async (rating) => {
        const { count, error } = await supabase
          .from('reviews')
          .select('*', { count: 'exact', head: true })
          .eq('product_id', productId)
          .is('deleted_at', null)
          .eq('rating', rating);
        if (error) {
          logger.warn('getReviewSummary: count query failed', {
            rating,
            error: error.message,
          });
          return null;
        }
        return count ?? 0;
      })
    );
    if (counts.some((c) => c === null)) return empty;

    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalReviews = 0;
    let ratingSum = 0;
    for (let i = 0; i < counts.length; i++) {
      const rating = i + 1;
      const count = counts[i] as number;
      ratingDistribution[rating] = count;
      totalReviews += count;
      ratingSum += rating * count;
    }

    const averageRating = totalReviews > 0 ? ratingSum / totalReviews : 0;

    return { averageRating, totalReviews, ratingDistribution };
  } catch (err) {
    logger.error('getReviewSummary: unexpected error', { error: String(err) });
    return empty;
  }
}

/**
 * Section 18, item 26 — cached review summary for the product
 * page. `getProductSeo` is called twice per request
 * (`generateMetadata` + the page body); the numeric summary is
 * wrapped in `swrGet` (10 min fresh / 1 h stale — reviews change
 * slowly, same TTLs as the AI review summary) so the second call
 * serves the first call's result instead of re-querying.
 */
export async function getCachedReviewSummary(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ReviewSummary> {
  return swrGet<ReviewSummary>(
    cacheKey('review-summary-numbers', productId),
    () => getReviewSummary(supabase, productId),
    600_000, // 10 minutes fresh
    3_600_000 // 1 hour stale
  );
}

/**
 * Create a user-submitted review.
 *
 * @param userId    The authenticated user's ID.
 * @param productId The product being reviewed.
 * @param data      Review payload: rating (1-5), optional title, content, verifiedPurchase.
 * @returns The created review, or `null` on failure.
 */
export async function createReview(
  supabase: AnySupabaseClient,
  userId: string,
  productId: string,
  data: CreateReviewInput
): Promise<Review | null> {
  try {
    const { data: inserted, error } = await supabase
      .from('reviews')
      .insert({
        product_id: productId,
        user_id: userId,
        rating: data.rating,
        title: data.title ?? null,
        content: data.content ?? null,
        verified_purchase: data.verifiedPurchase ?? false,
        helpful_count: 0,
      })
      .select('id, product_id, review_source_id, user_id, author_name, rating, title, content, verified_purchase, helpful_count, source_url, created_at, updated_at')
      .maybeSingle();

    if (error || !inserted) {
      if (error) logger.warn('createReview: insert failed', { error: error.message });
      return null;
    }

    return mapReview(inserted as ReviewRow);
  } catch (err) {
    logger.error('createReview: unexpected error', { error: String(err) });
    return null;
  }
}
