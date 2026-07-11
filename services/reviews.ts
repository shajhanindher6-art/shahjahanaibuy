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
 */
export async function getReviewSummary(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ReviewSummary> {
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select('rating')
      .eq('product_id', productId)
      .is('deleted_at', null)
      .limit(10000);

    if (error || !data) {
      if (error) logger.warn('getReviewSummary: query failed', { error: error.message });
      return { averageRating: 0, totalReviews: 0, ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    }

    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalReviews = 0;
    let ratingSum = 0;

    for (const row of data) {
      const rating = row.rating;
      ratingDistribution[rating] = (ratingDistribution[rating] ?? 0) + 1;
      ratingSum += rating;
      totalReviews++;
    }

    const averageRating = totalReviews > 0 ? ratingSum / totalReviews : 0;

    return { averageRating, totalReviews, ratingDistribution };
  } catch (err) {
    logger.error('getReviewSummary: unexpected error', { error: String(err) });
    return { averageRating: 0, totalReviews: 0, ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
  }
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
