'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  MIN_REVIEWS_FOR_SCORE,
  lifespanForCategory,
  reliabilityFromReviews,
} from '@/services/durability';

/**
 * AI Product Durability & Longevity Predictor — category range plus a
 * review-gated reliability score.
 *
 * HONESTY, enforced in the UI:
 * - The lifespan is a TYPICAL RANGE FOR THE CATEGORY, labeled as such
 *   — never this product's measured lifespan.
 * - The reliability score appears ONLY when at least
 *   MIN_REVIEWS_FOR_SCORE real reviews exist; otherwise the UI reads
 *   "insufficient review data — reliability score unavailable" and
 *   shows NO number. Price is never used as durability evidence.
 * - "No repair-log data available for this product" is stated
 *   plainly — no repair statistics, failure rates, or brand
 *   reliability rankings are ever invented.
 */
export function DurabilityPredictor({
  category,
  totalReviews,
  averageRating,
  verifiedReviews,
}: {
  category: string | null;
  totalReviews: number;
  averageRating: number | null;
  verifiedReviews: number;
}) {
  const range = lifespanForCategory(category);
  const reliability = reliabilityFromReviews({ totalReviews, averageRating, verifiedReviews });

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="text-base">Durability &amp; longevity — estimate</CardTitle>
        <CardDescription>
          An estimate, not a measurement of this product. Lifespan figures are typical for the
          category; reliability comes only from real reviews when enough of them exist.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {range ? (
          <p>
            <span className="font-medium">Typical lifespan for this category:</span>{' '}
            {range.minYears}–{range.maxYears} years. {range.note} This is typical for{' '}
            {category} products in general — not a measurement of this specific product.
          </p>
        ) : (
          <p className="text-muted-foreground">
            No typical lifespan range is recorded for this product&apos;s category, so no lifespan
            estimate is shown rather than a guessed one.
          </p>
        )}
        {reliability.score !== null ? (
          <p>
            <span className="font-medium">Reliability score (review-based):</span>{' '}
            {reliability.score}/100, from an average rating of{' '}
            {reliability.averageRating?.toFixed(1)} across {reliability.totalReviews} reviews (
            {reliability.verifiedReviews} verified). This reflects buyer ratings, not lab testing.
          </p>
        ) : (
          <p className="text-muted-foreground">
            Reliability score unavailable — insufficient review data (needs at least{' '}
            {MIN_REVIEWS_FOR_SCORE} reviews; this product has {reliability.totalReviews}). No score
            is estimated from price or category.
          </p>
        )}
        <p className="text-muted-foreground">
          No repair-log data available for this product. Repair history, failure rates, and brand
          reliability rankings are not tracked in SmartBuy, so none are shown here. If reviews
          arrive later, the review-based reliability score activates automatically.
        </p>
      </CardContent>
    </Card>
  );
}
