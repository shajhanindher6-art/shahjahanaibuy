/**
 * AI review summary service (template-based, no external AI call — the
 * same approach as the existing AI product summary in ai-summary.ts).
 *
 * The existing reviews summary (services/reviews.ts getReviewSummary)
 * returns only numbers: average rating, total reviews and the 1–5
 * distribution. This service adds the textual layer the Reviews tab
 * was missing: a plain-language summary of what buyers like and what
 * they complain about, a verified-purchase split, an overall verdict
 * derived from the average rating, and the most helpful review.
 *
 * Themes are detected by keyword matching over review titles + content,
 * split by sentiment (rating >= 4 counts as positive evidence for a
 * theme, rating <= 2 as negative evidence, 3-star reviews as neutral
 * and ignored for themes). This is deliberately transparent and
 * deterministic: no review text is sent to any third party, and the
 * summary can only mention a theme when at least one real review
 * mentions it.
 *
 * Returns null when a product has no reviews, so callers can hide the
 * summary card and show the existing "No reviews yet" empty state.
 * Results are cached in memory (SWR, 10 minutes fresh / 1 hour stale)
 * because reviews change slowly.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { swrGet, cacheKey } from '@/lib/cache';
import { logger } from '@/lib/config/logger';
import type { ReviewAISummary, ReviewTheme } from '@/types/ai';

export type { ReviewAISummary, ReviewTheme } from '@/types/ai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewRow {
  rating: number;
  title: string | null;
  content: string | null;
  author_name: string | null;
  verified_purchase: boolean;
  helpful_count: number;
}

// ---------------------------------------------------------------------------
// Theme keywords
// ---------------------------------------------------------------------------

const THEMES: Array<{ theme: string; keywords: string[] }> = [
  { theme: 'Battery life', keywords: ['battery', 'charge', 'charging', 'lasts all day'] },
  { theme: 'Screen / display', keywords: ['screen', 'display', 'brightness', 'resolution', 'oled', 'retina'] },
  { theme: 'Performance / speed', keywords: ['fast', 'speed', 'performance', 'lag', 'slow', 'processor', 'chip'] },
  { theme: 'Camera', keywords: ['camera', 'photo', 'picture', 'video quality'] },
  { theme: 'Build quality', keywords: ['build', 'durable', 'sturdy', 'premium', 'plastic', 'fragile', 'broke'] },
  { theme: 'Sound / audio', keywords: ['sound', 'audio', 'speaker', 'bass', 'noise', 'headphone'] },
  { theme: 'Portability', keywords: ['light', 'lightweight', 'heavy', 'portable', 'carry', 'compact'] },
  { theme: 'Value for money', keywords: ['price', 'value', 'worth', 'expensive', 'cheap', 'affordable'] },
  { theme: 'Ease of use', keywords: ['easy', 'simple', 'setup', 'user-friendly', 'intuitive', 'complicated'] },
  { theme: 'Software', keywords: ['software', 'update', 'app', 'os', 'bug', 'crash'] },
];

function detectThemes(text: string): string[] {
  const found: string[] = [];
  for (const { theme, keywords } of THEMES) {
    if (keywords.some((kw) => text.includes(kw))) {
      found.push(theme);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

export async function getReviewAISummary(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ReviewAISummary | null> {
  const key = cacheKey('review-summary', productId);
  return swrGet<ReviewAISummary | null>(
    key,
    () => buildReviewAISummary(supabase, productId),
    600_000, // 10 minutes fresh
    3_600_000 // 1 hour stale
  );
}

async function buildReviewAISummary(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ReviewAISummary | null> {
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select('rating, title, content, author_name, verified_purchase, helpful_count')
      .eq('product_id', productId)
      .is('deleted_at', null)
      .order('helpful_count', { ascending: false })
      .limit(200);

    if (error || !data || data.length === 0) {
      if (error) {
        logger.warn('buildReviewAISummary: query failed', { error: error.message });
      }
      return null;
    }

    const reviews = data as unknown as ReviewRow[];
    const totalReviews = reviews.length;
    const ratingSum = reviews.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = ratingSum / totalReviews;

    const verified = reviews.filter((r) => r.verified_purchase);
    const verifiedAverageRating =
      verified.length > 0
        ? verified.reduce((sum, r) => sum + r.rating, 0) / verified.length
        : null;

    const themeCounts = new Map<string, { positiveCount: number; negativeCount: number }>();
    for (const review of reviews) {
      const text = `${review.title ?? ''} ${review.content ?? ''}`.toLowerCase();
      if (!text.trim()) continue;
      const themes = detectThemes(text);
      for (const theme of themes) {
        const entry = themeCounts.get(theme) ?? { positiveCount: 0, negativeCount: 0 };
        if (review.rating >= 4) entry.positiveCount++;
        else if (review.rating <= 2) entry.negativeCount++;
        themeCounts.set(theme, entry);
      }
    }

    const themes: ReviewTheme[] = [...themeCounts.entries()]
      .map(([theme, counts]) => ({ theme, ...counts }))
      .filter((t) => t.positiveCount + t.negativeCount > 0)
      .sort(
        (a, b) =>
          b.positiveCount + b.negativeCount - (a.positiveCount + a.negativeCount)
      )
      .slice(0, 6);

    const positives = themes
      .filter((t) => t.positiveCount > t.negativeCount)
      .sort((a, b) => b.positiveCount - a.positiveCount)
      .slice(0, 4)
      .map((t) => `Buyers praise its ${t.theme.toLowerCase()} (${t.positiveCount} mention${t.positiveCount === 1 ? '' : 's'})`);

    const concerns = themes
      .filter((t) => t.negativeCount >= t.positiveCount && t.negativeCount > 0)
      .sort((a, b) => b.negativeCount - a.negativeCount)
      .slice(0, 4)
      .map((t) => `Some buyers raise concerns about ${t.theme.toLowerCase()} (${t.negativeCount} mention${t.negativeCount === 1 ? '' : 's'})`);

    if (averageRating >= 4 && positives.length === 0) {
      positives.push('High overall satisfaction from reviewers');
    }
    if (averageRating > 0 && averageRating < 3 && concerns.length === 0) {
      concerns.push('Overall rating is below average');
    }

    const mostHelpfulRow = [...reviews].sort(
      (a, b) => b.helpful_count - a.helpful_count
    )[0];
    const mostHelpful =
      mostHelpfulRow && (mostHelpfulRow.content || mostHelpfulRow.title)
        ? {
            authorName: mostHelpfulRow.author_name,
            rating: mostHelpfulRow.rating,
            title: mostHelpfulRow.title,
            content: mostHelpfulRow.content,
            helpfulCount: mostHelpfulRow.helpful_count,
          }
        : null;

    const satisfaction =
      averageRating >= 4.5
        ? 'very positive'
        : averageRating >= 4
          ? 'positive'
          : averageRating >= 3
            ? 'mixed'
            : 'mostly negative';

    // Overall verdict: a single short judgement, so the UI can show it
    // as a badge without re-deriving it from the rating everywhere.
    const verdict =
      averageRating >= 4.5
        ? 'Highly Recommended'
        : averageRating >= 4
          ? 'Recommended'
          : averageRating >= 3
            ? 'Mixed Reviews'
            : averageRating >= 2
              ? 'Mostly Negative'
              : 'Not Recommended';

    const parts = [
      `Based on ${totalReviews} review${totalReviews === 1 ? '' : 's'}, buyers are ${satisfaction} about this product (average ${averageRating.toFixed(1)} out of 5).`,
    ];
    if (verifiedAverageRating !== null && verified.length > 0) {
      parts.push(
        `Verified buyers rate it ${verifiedAverageRating.toFixed(1)} on average (${verified.length} verified review${verified.length === 1 ? '' : 's'}).`
      );
    }
    if (themes.length > 0) {
      const top = themes[0];
      parts.push(
        `The most discussed topic is ${top.theme.toLowerCase()} (${top.positiveCount} positive, ${top.negativeCount} negative mentions).`
      );
    }

    return {
      productId,
      averageRating,
      totalReviews,
      verifiedAverageRating,
      verifiedCount: verified.length,
      summary: parts.join(' '),
      verdict,
      positives,
      concerns,
      themes,
      mostHelpful,
    };
  } catch (err) {
    logger.error('buildReviewAISummary: unexpected error', { error: String(err) });
    return null;
  }
}
