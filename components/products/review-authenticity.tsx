'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AUTH_THRESHOLDS,
  analyzeReviewAuthenticity,
  type AuthenticityReview,
} from '@/services/review-authenticity';

/**
 * True Fake Review & Paid Rating Filter — pattern analysis over the
 * product's REAL reviews, rendered in the Reviews tab next to (not
 * instead of) the sentiment summary. It reads the same reviews table
 * as the sentiment engine and never contradicts it.
 *
 * HONESTY, enforced in the UI:
 * - 0 reviews → "No reviews to analyze": no score, no badge, no
 *   rating. Nothing is analyzed from nothing.
 * - Badge wording is patterns, not proof: "Some reviews show
 *   patterns consistent with incentivized reviews — treat ratings
 *   with caution". No reviewer is named or accused.
 * - The trusted average is shown ONLY when the trusted subset is
 *   non-empty, next to the overall average with both counts.
 * - Thresholds are stated in the UI (see below), so a badge is never
 *   a black box. This detects patterns; it does not prove a review
 *   was paid for.
 */
export function ReviewAuthenticity({
  reviews,
}: {
  /** The product's real reviews (same data as the Reviews tab list). */
  reviews: AuthenticityReview[];
}) {
  const result = useMemo(() => analyzeReviewAuthenticity(reviews), [reviews]);

  if (result.totalReviews === 0) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Review authenticity check</CardTitle>
          <CardDescription>No reviews to analyze.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            When reviews arrive, this check scans them for suspicious patterns (rating skew,
            duplicate text, timing bursts) and reports an unbiased rating from the trusted subset.
            With no reviews, no score or badge is shown.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Review authenticity check</CardTitle>
        <CardDescription>
          Pattern analysis only — it detects suspicious patterns; it does not prove any review was
          paid for.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {result.showWarning ? (
          <div>
            <Badge variant="destructive">
              Patterns consistent with incentivized reviews — treat ratings with caution
            </Badge>
            <p className="mt-2 text-muted-foreground">
              Some reviews show patterns consistent with incentivized reviews. This is a pattern
              finding, not proof that any specific review was paid for, and no reviewer is named
              here.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">
            No suspicious review patterns detected at the stated thresholds.
          </p>
        )}
        <p>
          Overall average: <span className="font-medium">{result.overallAverage?.toFixed(1)}</span>{' '}
          from {result.totalReviews} reviews
          {result.trustedAverage !== null && (
            <>
              {' · '}Trusted-subset average:{' '}
              <span className="font-medium">{result.trustedAverage.toFixed(1)}</span> from{' '}
              {result.trustedCount} trusted reviews (verified, or non-duplicate and not
              short/generic)
            </>
          )}
          {result.trustedAverage === null && (
            <span className="text-muted-foreground">
              {' · '}No trusted subset — every review failed the pattern checks, so no unbiased
              average is shown rather than a guessed one.
            </span>
          )}
        </p>
        {result.signals.length > 0 && (
          <ul className="space-y-1 text-muted-foreground">
            {result.signals.map((s) => (
              <li key={s.key}>
                <span className="font-medium text-foreground">
                  {s.strength === 'strong' ? 'Strong signal' : 'Weak signal'}:
                </span>{' '}
                {s.detail}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Thresholds: badge needs at least {AUTH_THRESHOLDS.minReviewsForBadge} reviews and either
          one strong signal (≥{Math.round(AUTH_THRESHOLDS.skewFiveStarShare * 100)}% five-star,
          a duplicate-text cluster of ≥{AUTH_THRESHOLDS.duplicateClusterMin}, or ≥
          {AUTH_THRESHOLDS.burstMinReviews} reviews within{' '}
          {AUTH_THRESHOLDS.burstWindowHours} hours) or two weak signals (≥
          {Math.round(AUTH_THRESHOLDS.unverifiedShareWeak * 100)}% unverified, or ≥
          {Math.round(AUTH_THRESHOLDS.shortGenericShareWeak * 100)}% short/generic). A single weak
          signal alone never triggers a badge.
        </p>
      </CardContent>
    </Card>
  );
}
