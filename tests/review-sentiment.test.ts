import { describe, expect, it } from 'vitest';
import {
  analyzeReviews,
  type SentimentReviewInput,
} from '@/services/review-sentiment';

function review(
  partial: Partial<SentimentReviewInput> & { content: string | null }
): SentimentReviewInput {
  return {
    rating: 5,
    title: null,
    verified_purchase: true,
    ...partial,
  };
}

function aspect(result: NonNullable<ReturnType<typeof analyzeReviews>>, id: string) {
  return result.aspects.find((a) => a.aspect === id);
}

describe('analyzeReviews — baseline behavior (pre-natural)', () => {
  it('returns null for empty input', () => {
    expect(analyzeReviews([])).toBeNull();
  });

  it('gives verified reviews priority in the headline', () => {
    const result = analyzeReviews([
      review({ rating: 5, content: 'great product, excellent battery', verified_purchase: true }),
      review({ rating: 1, content: 'terrible product, awful battery', verified_purchase: false }),
      review({ rating: 1, content: 'terrible product, awful battery', verified_purchase: false }),
    ]);
    expect(result).not.toBeNull();
    expect(result!.basis).toBe('verified');
    expect(result!.basisReviews).toBe(1);
    expect(result!.totalReviews).toBe(3);
    expect(result!.verifiedCount).toBe(1);
    expect(result!.overall).toBe('positive');
    expect(result!.lowConfidence).toBe(true);
    expect(aspect(result!, 'battery')?.sentiment).toBe('positive');
  });

  it('flips polarity on negation: "not good" stays negative', () => {
    const result = analyzeReviews([
      review({ rating: 2, content: 'not good battery life' }),
    ]);
    expect(aspect(result!, 'battery')?.sentiment).toBe('negative');
  });

  it('treats "cheap" as positive for price but negative for build', () => {
    const result = analyzeReviews([
      review({ rating: 5, content: 'cheap price, good value' }),
      review({ rating: 2, content: 'feels cheap, plastic build' }),
    ]);
    expect(aspect(result!, 'price')?.sentiment).toBe('positive');
    expect(aspect(result!, 'build')?.sentiment).toBe('negative');
  });

  it('scores Roman Urdu through the lexicon, untouched by AFINN', () => {
    const result = analyzeReviews([
      review({ rating: 5, content: 'battery behtareen hai, backup acha hai' }),
      review({ rating: 2, content: 'qeemat bohat mehngi hai' }),
    ]);
    expect(aspect(result!, 'battery')?.sentiment).toBe('positive');
    expect(aspect(result!, 'price')?.sentiment).toBe('negative');
  });

  it('marks 1-2 reviews as low confidence', () => {
    const one = analyzeReviews([review({ rating: 5, content: 'great product' })]);
    expect(one!.lowConfidence).toBe(true);
    const three = analyzeReviews([
      review({ rating: 5, content: 'great product' }),
      review({ rating: 4, content: 'good product' }),
      review({ rating: 5, content: 'excellent product' }),
    ]);
    expect(three!.lowConfidence).toBe(false);
  });
});

describe('analyzeReviews — natural AFINN gap-filler', () => {
  it('scores AFINN-only vocabulary: "outstanding" is positive', () => {
    // 'outstanding' is in AFINN (score 5) but NOT in the lexicon, so
    // before natural this review scored 0 (mixed). AFINN average over
    // [outstanding, display] = 5/2 = 2.5 -> +1.
    const result = analyzeReviews([review({ rating: 3, content: 'outstanding display' })]);
    expect(aspect(result!, 'display')?.sentiment).toBe('positive');
    expect(result!.pros).toContain('Display');
  });

  it('scores AFINN-only vocabulary: "mediocre" is negative', () => {
    // 'mediocre' is in AFINN (score -3) but NOT in the lexicon.
    // AFINN average over [mediocre, display] = -3/2 = -1.5 -> -1.
    const result = analyzeReviews([review({ rating: 3, content: 'mediocre display' })]);
    expect(aspect(result!, 'display')?.sentiment).toBe('negative');
    expect(result!.cons).toContain('Display');
  });

  it('lexicon wins when it has an opinion: AFINN never overrides it', () => {
    // Lexicon: 'good' x2 = +2. AFINN average over
    // [good, good, hate, hate, hate] = (3+3-3-3-3)/5 = -0.6 -> -1,
    // but the gap-filler rule applies AFINN only when the lexicon
    // score is exactly 0, so the verdict stays positive.
    const result = analyzeReviews([
      review({ rating: 3, content: 'good good hate hate hate' }),
    ]);
    expect(aspect(result!, 'overall')?.sentiment).toBe('positive');
  });

  it('documents the whole-text limit: AFINN cannot split mixed aspects', () => {
    // Threshold boundary: "mediocre display, outstanding camera" has no
    // lexicon words, and whole-text AFINN (-3 + 5) / 4 = 0.5 -> +1, so
    // the +1 applies to BOTH aspects (AFINN sees the whole review, not
    // per-aspect text). Both aspects come out positive.
    const boundary = analyzeReviews([
      review({ rating: 3, content: 'mediocre display, outstanding camera' }),
    ]);
    expect(aspect(boundary!, 'display')?.sentiment).toBe('positive');
    expect(aspect(boundary!, 'camera')?.sentiment).toBe('positive');

    // Dilution to zero: "mediocre display, like the camera" averages
    // (-3 + 2) / 5 = -0.2, below the 0.5 threshold, so no adjustment
    // fires and both aspects stay mixed.
    const diluted = analyzeReviews([
      review({ rating: 3, content: 'mediocre display, like the camera' }),
    ]);
    expect(aspect(diluted!, 'display')?.sentiment).toBe('mixed');
    expect(aspect(diluted!, 'camera')?.sentiment).toBe('mixed');
  });
});
