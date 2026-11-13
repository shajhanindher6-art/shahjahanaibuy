/**
 * API v1 product reviews endpoint.
 * GET  /api/v1/products/[slug]/reviews — paginated reviews for a product.
 * POST /api/v1/products/[slug]/reviews — create a review (auth required).
 *
 * Photo reviews (Section 3 #12): a photo may be attached ONLY with the
 * reviewer's explicit consent (multipart field `photoConsent: "true"`).
 * Without consent the file is never uploaded and never stored — the
 * review is still saved, with `photoStatus: "not_consented"`. When the
 * `review-photos` bucket (migration 028) is not configured, the upload
 * fails safely: the review is still saved and the response says so
 * honestly (`photoStatus: "not_stored"`) instead of pretending the
 * photo was stored.
 *
 * Verified-purchase rules are unchanged: the form never sets
 * `verifiedPurchase` — that flag stays false for form submissions
 * (see components/products/verified-buyer-badge.tsx).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  notFound,
  internalError,
} from '@/lib/api/responses';
import {
  logApiRequest,
  requireAuth,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { getCachedProductBySlug, incrementViewCount } from '@/services/products';
import { cacheKey, invalidateCache } from '@/lib/cache';
import {
  getReviews,
  getReviewSummary,
  createReview,
  type CreateReviewInput,
} from '@/services/reviews';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

/** Max review-photo size: 5 MB. Larger files are refused, not resized. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const REVIEW_PHOTOS_BUCKET = 'review-photos';

type PhotoStatus = 'stored' | 'not_stored' | 'not_consented' | 'invalid';

/**
 * Public URLs of consented review photos, keyed by review id.
 * Fail-safe: the review_photos table or the bucket may not exist yet
 * (migration 028 not run) — then this returns {} and the reviews
 * still render, just without photos.
 */
async function getReviewPhotoUrls(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  reviewIds: string[]
): Promise<Record<string, string[]>> {
  if (reviewIds.length === 0) return {};
  try {
    const { data, error } = await supabase
      .from('review_photos')
      .select('review_id, storage_path')
      .in('review_id', reviewIds);
    if (error || !data) return {};

    const urls: Record<string, string[]> = {};
    for (const row of data as Array<{ review_id: string; storage_path: string }>) {
      const { data: publicUrl } = supabase.storage
        .from(REVIEW_PHOTOS_BUCKET)
        .getPublicUrl(row.storage_path);
      if (!publicUrl?.publicUrl) continue;
      if (!urls[row.review_id]) urls[row.review_id] = [];
      urls[row.review_id].push(publicUrl.publicUrl);
    }
    return urls;
  } catch {
    return {};
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.reviews', slug: params.slug });

  const limited = await rateLimitResponse(`products-reviews:${getClientIp(request)}`, 60);
  if (limited) return limited;

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

    // Consented photo URLs (fail-safe: {} when the table/bucket is missing).
    const photos = await getReviewPhotoUrls(
      supabase,
      reviews.reviews.map((r) => r.id)
    );

    return apiSuccess(
      { reviews: reviews.reviews, summary, photos },
      200,
      {
        page: reviews.page,
        pageSize: reviews.pageSize,
        total: reviews.total,
        totalPages: reviews.totalPages,
      }
    );
  } catch (err) {
    logApiError(err, { request, route: 'products.reviews.get', status: 500 });
    return internalError('Failed to fetch reviews');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.reviews.create', slug: params.slug });

  const limited = await rateLimitResponse(`products-reviews-create:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    // Two request shapes, one review path:
    // - JSON (existing clients): { rating, title, content }.
    // - multipart/form-data (photo reviews): same fields plus an
    //   optional `photo` file and `photoConsent: "true" | "false"`.
    const contentType = request.headers.get('content-type') ?? '';
    let rating: unknown;
    let title: unknown;
    let content: unknown;
    let verifiedPurchase = false;
    let photo: File | null = null;
    let photoConsent = false;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      rating = Number(form.get('rating'));
      title = form.get('title');
      content = form.get('content');
      photoConsent = form.get('photoConsent') === 'true';
      const file = form.get('photo');
      photo = file instanceof File && file.size > 0 ? file : null;
    } else {
      const body = await request.json();
      rating = body?.rating;
      title = body?.title;
      content = body?.content;
      verifiedPurchase = typeof body?.verifiedPurchase === 'boolean' ? body.verifiedPurchase : false;
    }

    if (typeof rating !== 'number' || Number.isNaN(rating) || rating < 1 || rating > 5) {
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
      // Multipart callers cannot set this at all; JSON callers pass
      // it through as before (the form never sends it).
      verifiedPurchase,
    };

    const review = await createReview(supabase, auth.userId, product.id, input);

    if (!review) {
      return internalError('Failed to create review');
    }

    // --- Consented photo upload (Section 3 #12) ---
    // The review is already saved at this point. A photo is uploaded
    // ONLY when the reviewer explicitly consented; every failure mode
    // below leaves the review saved and reports honestly.
    let photoStatus: PhotoStatus | undefined;
    let photoMessage: string | undefined;
    if (photo) {
      if (!photoConsent) {
        // Consent is the gate: no consent, no upload, no storage.
        photoStatus = 'not_consented';
        photoMessage =
          'Your review was saved. The photo was not uploaded because you did not consent to storing it.';
      } else if (!photo.type.startsWith('image/')) {
        photoStatus = 'invalid';
        photoMessage = 'Your review was saved. The photo was not stored — only image files are accepted.';
      } else if (photo.size > MAX_PHOTO_BYTES) {
        photoStatus = 'invalid';
        photoMessage = 'Your review was saved. The photo was not stored — photos must be 5 MB or smaller.';
      } else {
        const safeName = photo.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'photo';
        const storagePath = `${auth.userId}/${review.id}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from(REVIEW_PHOTOS_BUCKET)
          .upload(storagePath, photo, {
            contentType: photo.type,
            upsert: false,
          });

        if (uploadError) {
          // Most likely the bucket does not exist yet (migration 028
          // not run) — honest message, review stays saved.
          photoStatus = 'not_stored';
          photoMessage =
            'Your review was saved. The photo could not be stored — photo storage is not configured yet — so it was not uploaded.';
        } else {
          const { error: rowError } = await supabase.from('review_photos').insert({
            review_id: review.id,
            user_id: auth.userId,
            storage_path: storagePath,
            consent_given_at: new Date().toISOString(),
          });
          if (rowError) {
            // Record the consent row failed: remove the orphan file
            // (best effort) so no unrecorded photo lingers.
            await supabase.storage.from(REVIEW_PHOTOS_BUCKET).remove([storagePath]);
            photoStatus = 'not_stored';
            photoMessage =
              'Your review was saved. The photo could not be recorded, so it was not kept.';
          } else {
            photoStatus = 'stored';
          }
        }
      }
    }

    // Invalidate the AI Review Summary cache for this product so the
    // new review is picked up by the summarizer on the next fetch
    // instead of waiting out its 10-minute fresh / 1-hour stale
    // window. Note: the cache is per server instance, so on a
    // multi-instance host a stale copy may still serve briefly
    // until its own window expires.
    invalidateCache(cacheKey('review-summary', product.id));

    // Increment view count as a popularity signal (best-effort).
    void incrementViewCount(supabase, product.id);

    return apiSuccess(
      {
        ...review,
        ...(photoStatus ? { photoStatus } : {}),
        ...(photoMessage ? { photoMessage } : {}),
      },
      201
    );
  } catch (err) {
    logApiError(err, { request, route: 'products.reviews.post', status: 500 });
    return internalError('Failed to create review');
  }
}
