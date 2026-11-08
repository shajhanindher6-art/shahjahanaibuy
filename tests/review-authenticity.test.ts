import { describe, expect, it } from 'vitest';
import {
  analyzeReviewAuthenticity,
  type AuthenticityReview,
} from '@/services/review-authenticity';

let counter = 0;

function review(
  text: { title: string; content: string },
  opts: { rating?: number; verified?: boolean; day?: number } = {}
): AuthenticityReview {
  counter += 1;
  return {
    id: `r${counter}`,
    rating: opts.rating ?? 5,
    title: text.title,
    content: text.content,
    verifiedPurchase: opts.verified ?? true,
    createdAt: `2026-10-${String(opts.day ?? counter).padStart(2, '0')}T10:00:00.000Z`,
  };
}

// 10 genuinely varied reviews: no shared 4-gram, no duplicate text,
// spread over 10 days, mixed ratings, all verified, all long-form.
// Hand-checked: no 4 consecutive normalized words repeat across items.
const DISTINCT_TEXTS: Array<{ title: string; content: string }> = [
  { title: 'Great battery life', content: 'The battery easily lasts two full days of normal use.' },
  { title: 'Solid build quality', content: 'Feels premium in the hand and survived a drop onto tile.' },
  { title: 'Bright display', content: 'The screen stays readable in direct sunlight at noon.' },
  { title: 'Fast performance', content: 'Apps open instantly and games run without any stutter.' },
  { title: 'Decent camera', content: 'Daylight photos are sharp with natural looking colours.' },
  { title: 'Good value overall', content: 'For this price the feature set is hard to beat.' },
  { title: 'Comfortable to carry', content: 'Light enough to carry in a small bag all day.' },
  { title: 'Clear speakers', content: 'Voices in calls sound crisp even in a noisy room.' },
  { title: 'Charges quickly', content: 'A thirty minute charge gives me most of a day.' },
  { title: 'Easy setup', content: 'Pairing with my phone took under five minutes.' },
];

const VARIED_RATINGS = [5, 5, 4, 5, 4, 3, 5, 4, 5, 4];

function variedReviews(): AuthenticityReview[] {
  return DISTINCT_TEXTS.map((text, i) =>
    review(text, { rating: VARIED_RATINGS[i], day: i + 1 })
  );
}

function signalKeys(result: ReturnType<typeof analyzeReviewAuthenticity>): string[] {
  return result.signals.map((s) => s.key);
}

describe('analyzeReviewAuthenticity — baseline behavior (pre-natural)', () => {
  it('returns empty result for zero reviews', () => {
    const result = analyzeReviewAuthenticity([]);
    expect(result.totalReviews).toBe(0);
    expect(result.overallAverage).toBeNull();
    expect(result.trustedAverage).toBeNull();
    expect(result.trustedCount).toBe(0);
    expect(result.showWarning).toBe(false);
    expect(result.signals).toEqual([]);
  });

  it('never badges below 10 reviews, even with full 5-star skew', () => {
    const result = analyzeReviewAuthenticity(
      DISTINCT_TEXTS.slice(0, 5).map((text, i) => review(text, { day: i + 1 }))
    );
    expect(result.showWarning).toBe(false);
    expect(result.signals).toEqual([]);
  });

  it('10 varied reviews produce no signals at all', () => {
    const result = analyzeReviewAuthenticity(variedReviews());
    expect(result.totalReviews).toBe(10);
    expect(result.overallAverage).toBe(4.4);
    expect(result.trustedAverage).toBe(4.4);
    expect(result.trustedCount).toBe(10);
    expect(result.showWarning).toBe(false);
    expect(result.signals).toEqual([]);
  });

  it('fires rating-skew (strong) at 90% five-star', () => {
    const reviews = variedReviews().map((r, i) => ({
      ...r,
      rating: i === 9 ? 4 : 5,
    }));
    const result = analyzeReviewAuthenticity(reviews);
    expect(result.showWarning).toBe(true);
    expect(signalKeys(result)).toEqual(['rating-skew']);
    expect(result.signals[0].strength).toBe('strong');
  });

  it('fires duplicate-text (strong) on a 3-review identical cluster', () => {
    const identical = { title: 'Excellent product', content: 'Excellent product, works perfectly and I would buy it again.' };
    const reviews = [
      ...[0, 1, 2].map((i) => review(identical, { day: i + 1 })),
      ...DISTINCT_TEXTS.slice(0, 7).map((text, i) => review(text, { day: i + 4 })),
    ];
    const result = analyzeReviewAuthenticity(reviews);
    expect(result.showWarning).toBe(true);
    expect(signalKeys(result)).toContain('duplicate-text');
    // The 3 clustered reviews leave the trusted subset.
    expect(result.trustedCount).toBe(7);
  });
});

describe('analyzeReviewAuthenticity — natural NGrams repetition signal', () => {
  // Four reviews sharing the phrase "amazing product highly recommend"
  // but otherwise different: Jaccard ~0.18, so no duplicate-text signal.
  const SHARED_PHRASE_TEXTS: Array<{ title: string; content: string }> = [
    { title: 'Amazing product', content: 'Amazing product highly recommend, battery lasts all day and the screen stays bright.' },
    { title: 'Amazing product', content: 'Amazing product highly recommend, the camera takes sharp photos in daylight.' },
    { title: 'Amazing product', content: 'Amazing product highly recommend, build feels premium and solid in the hand.' },
    { title: 'Amazing product', content: 'Amazing product highly recommend, sound is clear with deep bass.' },
  ];

  function repetitionReviews(): AuthenticityReview[] {
    return [
      ...SHARED_PHRASE_TEXTS.map((text, i) =>
        review(text, { rating: [5, 4, 5, 4][i], day: i + 1 })
      ),
      ...DISTINCT_TEXTS.slice(0, 6).map((text, i) =>
        review(text, { rating: [5, 4, 3, 5, 4, 5][i], day: i + 5 })
      ),
    ];
  }

  it('fires repeated-phrasing (weak) when 4 of 10 share one phrase', () => {
    const result = analyzeReviewAuthenticity(repetitionReviews());
    expect(signalKeys(result)).toEqual(['repeated-phrasing']);
    const signal = result.signals[0];
    expect(signal.strength).toBe('weak');
    expect(signal.detail).toContain('amazing product highly recommend');
    expect(signal.detail).toContain('4 of 10');
    // A single weak signal alone never badges...
    expect(result.showWarning).toBe(false);
    // ...and repetition never excludes anyone from the trusted subset.
    expect(result.trustedCount).toBe(10);
  });

  it('badges when repetition pairs with a second weak signal', () => {
    // Same 10 reviews, but 8 of them unverified: unverified-ratio
    // (0.8 >= 0.8, weak) + repeated-phrasing (weak) = badge.
    const reviews = repetitionReviews().map((r, i) => ({
      ...r,
      verifiedPurchase: i >= 8,
    }));
    const result = analyzeReviewAuthenticity(reviews);
    expect(result.showWarning).toBe(true);
    expect(signalKeys(result).sort()).toEqual([
      'repeated-phrasing',
      'unverified-ratio',
    ]);
  });

  it('does not fire on genuinely varied reviews', () => {
    const result = analyzeReviewAuthenticity(variedReviews());
    expect(signalKeys(result)).not.toContain('repeated-phrasing');
  });
});
