/**
 * Section 20, §12 #66 — transparent Product Data Quality Score.
 *
 * This is a DATA-quality score, never a product-quality score: it
 * measures how complete, verifiable, and fresh the RECORD about a
 * product is — never whether the product itself is good. The label
 * "Data quality score" must be used everywhere it is shown, and the
 * score is always shown with its breakdown (dimension scores +
 * missing fields), never as a bare number.
 *
 * Why this exists: the only score before it was `confidence_score`
 * (services/pipeline/normalization.ts) — a field-presence count
 * floored at 50, computed nowhere at intake, and fed into the Deal
 * Score and AI ranking as if completeness were product quality
 * (audit §1 P0-5). This scorer replaces nothing by itself (the
 * decoupling is audit §12 #67, another worker's item); it gives
 * admins and the /admin/ai panel a second, honest number that:
 *   - has NO floor (a name-only record scores what it scores);
 *   - is a pure function of stored fields, so it is computed on
 *     read and is always current — there is no stored column to go
 *     stale, and no migration to apply for it;
 *   - names every missing field, so an admin can see exactly what
 *     would raise the score instead of guessing.
 *
 * Dimensions (weights sum to 100):
 *   identity            15 — name / brand / category / description present
 *   spec completeness   20 — stored product_attributes count (bands)
 *   image availability  15 — valid http(s) image_url + product_images rows
 *   price freshness     20 — age of the last price check vs STALE_PRICE_DAYS
 *   merchant reliability 10 — merchant listings present and in stock
 *   GTIN validity       10 — GTIN present AND GS1 check digit valid
 *   source attribution  10 — price source recorded + verified_at recorded
 *
 * Unknown context (a count the caller could not read) counts as
 * missing, never as present: a dimension the caller cannot prove
 * scores 0 and lists the field as missing. The caller must pass
 * what it actually read — never a guessed count.
 */

import { STALE_PRICE_DAYS, getPriceAgeDays } from '@/lib/price-freshness';
import type { PriceVerificationStatus } from './price-verification';

/** The label to use everywhere this score is shown. */
export const DATA_QUALITY_SCORE_LABEL = 'Data quality score';

/** Minimal product shape the scorer needs — a subset of `Product`
 *  (types/index.ts) so callers can pass a row, a Product, or a
 *  partial test fixture. Every field is optional: missing fields
 *  score 0 in their dimension and are listed as missing. */
export interface QualityScoreProductInput {
  name?: string | null;
  slug?: string | null;
  brand?: string | null;
  category?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  gtin?: string | null;
  priceVerificationStatus?: PriceVerificationStatus | string | null;
  priceVerifiedAt?: string | null;
  /** Fallback "last checked" when no price_history point is known. */
  dataFreshness?: string | null;
  updatedAt?: string | null;
}

/** What the caller actually read about a product beyond its own
 *  row. All optional; null/undefined means "not read" and is
 *  treated as missing (scores 0), never invented. */
export interface QualityScoreContext {
  /** Stored product_attributes rows for the product. */
  specCount?: number | null;
  /** Stored product_images rows for the product. */
  imageCount?: number | null;
  /** merchant_products rows for the product. */
  merchantCount?: number | null;
  /** merchant_products rows in stock for the product. */
  inStockMerchantCount?: number | null;
  /** merchant_products price_source of the cheapest listing. */
  priceSource?: string | null;
  /** Newest price_history recorded_at for the product. */
  lastPriceRecordedAt?: string | null;
}

export interface QualityScoreDimension {
  key: string;
  label: string;
  /** Weight of this dimension in the total (weights sum to 100). */
  weight: number;
  /** Dimension score, 0–100. */
  score: number;
  /** Weighted contribution to the total, 0–weight. */
  points: number;
  /** Fields whose absence lowered this dimension (empty = complete). */
  missingFields: string[];
}

export interface ProductQualityScore {
  /** Total, 0–100, weighted sum of the dimensions. NO floor. */
  score: number;
  /** 'good' ≥ 80, 'fair' ≥ 50, else 'poor'. A label, not a verdict. */
  grade: 'good' | 'fair' | 'poor';
  dimensions: QualityScoreDimension[];
  /** Every missing field across dimensions, de-duplicated. */
  missingFields: string[];
  /** The verification status this score was computed against. */
  priceVerificationStatus: PriceVerificationStatus;
  /** Age in whole days of the last price check, or null (unknown). */
  priceAgeDays: number | null;
}

export type DataQualityGrade = ProductQualityScore['grade'];

export function dataQualityGrade(score: number): DataQualityGrade {
  if (score >= 80) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}

/**
 * GS1 check-digit validation for GTIN-8 / GTIN-12 / GTIN-13 /
 * GTIN-14. Spaces and hyphens are ignored; anything else (letters,
 * wrong length, bad check digit) is invalid. A valid check digit
 * proves the number is well-formed, not that the GTIN is registered
 * or belongs to this product — the score calls it "valid format",
 * never "verified GTIN".
 */
export function isValidGtin(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return false;
  if (digits.length !== 8 && digits.length !== 12 && digits.length !== 13 && digits.length !== 14) {
    return false;
  }
  const body = digits.slice(0, -1);
  const check = Number(digits[digits.length - 1]);
  let sum = 0;
  // GS1 mod-10: from the right of the body, alternate ×3 / ×1,
  // starting with ×3 on the digit next to the check digit.
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** True for an http(s) URL — the same rule the admin edit form
 *  enforces before an image_url is stored. `data:` / `javascript:`
 *  / relative URLs are not valid product images. */
export function isValidImageUrl(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function dimension(
  key: string,
  label: string,
  weight: number,
  score: number,
  missingFields: string[]
): QualityScoreDimension {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return {
    key,
    label,
    weight,
    score: clamped,
    points: Math.round((clamped * weight) / 100),
    missingFields,
  };
}

/**
 * Compute the transparent data-quality breakdown for one product.
 * Pure function — no DB, no network, no clock except the `now`
 * parameter (default: now), so tests can pin the freshness
 * dimension. The total is the weighted sum of the dimensions with
 * NO floor: a record with only a name scores in the teens, and
 * that is the honest number.
 */
export function computeProductQualityScore(
  product: QualityScoreProductInput,
  context: QualityScoreContext = {},
  now: Date = new Date()
): ProductQualityScore {
  const dimensions: QualityScoreDimension[] = [];

  // Identity (15): name / brand / category / description.
  {
    const missing: string[] = [];
    let points = 0;
    if (hasText(product.name)) points += 5;
    else missing.push('name');
    if (hasText(product.brand)) points += 4;
    else missing.push('brand');
    if (hasText(product.category)) points += 3;
    else missing.push('category');
    if (hasText(product.description)) points += 3;
    else missing.push('description');
    dimensions.push(dimension('identity', 'Identity', 15, (points / 15) * 100, missing));
  }

  // Spec completeness (20): bands over the stored attribute count.
  // No category spec template exists yet (audit §12 #28, another
  // worker), so bands are absolute counts, not "of N expected".
  {
    const count = context.specCount ?? null;
    const missing: string[] = [];
    let score: number;
    if (count === null || count <= 0) {
      score = 0;
      missing.push('specs');
    } else if (count <= 2) {
      score = 40;
      missing.push('more specs');
    } else if (count <= 5) {
      score = 70;
      missing.push('more specs');
    } else {
      score = 100;
    }
    dimensions.push(dimension('specs', 'Spec completeness', 20, score, missing));
  }

  // Image availability (15): valid image_url + gallery rows.
  {
    const missing: string[] = [];
    let score = 0;
    if (isValidImageUrl(product.imageUrl)) score += 67;
    else missing.push('image URL');
    const imageCount = context.imageCount ?? null;
    if (imageCount !== null && imageCount > 0) score += 33;
    else missing.push('product images');
    dimensions.push(dimension('images', 'Image availability', 15, score, missing));
  }

  // Price freshness (20): age of the newest price check —
  // price_history recorded_at first, then price_verified_at, then
  // the product row's data_freshness stamp. Unknown age scores 0:
  // "not stale" is not "fresh" (see lib/price-freshness.ts).
  let priceAgeDays: number | null = null;
  {
    const missing: string[] = [];
    const lastCheck =
      context.lastPriceRecordedAt ?? product.priceVerifiedAt ?? product.dataFreshness ?? null;
    priceAgeDays = getPriceAgeDays(lastCheck, now);
    let score: number;
    if (priceAgeDays === null) {
      score = 0;
      missing.push('recent price check');
    } else if (priceAgeDays <= STALE_PRICE_DAYS) {
      score = 100;
    } else if (priceAgeDays <= 30) {
      score = 50;
      missing.push('recent price check');
    } else {
      score = 20;
      missing.push('recent price check');
    }
    dimensions.push(dimension('priceFreshness', 'Price freshness', 20, score, missing));
  }

  // Merchant reliability (10): listings present and in stock.
  {
    const missing: string[] = [];
    const merchantCount = context.merchantCount ?? null;
    const inStock = context.inStockMerchantCount ?? null;
    let score: number;
    if (merchantCount === null || merchantCount <= 0) {
      score = 0;
      missing.push('merchant listings');
    } else if (merchantCount >= 2 && (inStock ?? 0) > 0) {
      score = 100;
    } else if ((inStock ?? 0) > 0) {
      score = 60;
      missing.push('second merchant listing');
    } else {
      score = 30;
      missing.push('in-stock merchant listing');
    }
    dimensions.push(dimension('merchants', 'Merchant reliability', 10, score, missing));
  }

  // GTIN validity (10): present AND GS1 check digit valid.
  {
    const missing: string[] = [];
    let score: number;
    if (!hasText(product.gtin)) {
      score = 0;
      missing.push('GTIN');
    } else if (isValidGtin(product.gtin)) {
      score = 100;
    } else {
      score = 0;
      missing.push('valid GTIN');
    }
    dimensions.push(dimension('gtin', 'GTIN validity', 10, score, missing));
  }

  // Source attribution (10): price source recorded + verified_at.
  {
    const missing: string[] = [];
    let score = 0;
    if (hasText(context.priceSource)) score += 50;
    else missing.push('price source');
    if (hasText(product.priceVerifiedAt)) score += 50;
    else missing.push('price verified date');
    dimensions.push(dimension('attribution', 'Source attribution', 10, score, missing));
  }

  const total = dimensions.reduce((sum, d) => sum + d.points, 0);
  const missingFields = [...new Set(dimensions.flatMap((d) => d.missingFields))];
  const status: PriceVerificationStatus =
    product.priceVerificationStatus === 'verified' ||
    product.priceVerificationStatus === 'stale'
      ? product.priceVerificationStatus
      : 'unverified';

  return {
    score: total,
    grade: dataQualityGrade(total),
    dimensions,
    missingFields,
    priceVerificationStatus: status,
    priceAgeDays,
  };
}
