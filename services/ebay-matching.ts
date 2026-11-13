/**
 * FINAL 100% — scored eBay listing matching (F-P1-43, F-P1-45,
 * F-P1-46).
 *
 * Replaces keyword containment matching (audit Worker H H-02):
 * the old `ebayListingMatchesProduct` returned true when EVERY
 * product-name token AND every brand token appeared in the title,
 * with no GTIN check and no model check — so "MacBook Air 13
 * 2020 Intel i5 8GB" matched product "MacBook Air 13" and its
 * asking price was upserted as that product's price. The only
 * guard was a fixed accessory-word blocklist.
 *
 * The scorer below scores over the legs that are actually
 * available (a missing GTIN or model is not evidence against a
 * match — it simply does not contribute), and hard-vetoes on
 * evidence AGAINST a match:
 * - name-token coverage (weight 50): the share of product-name
 *   tokens present in the title. Below 0.80 coverage the listing
 *   cannot be the product.
 * - brand tokens (weight 20): all brand tokens must be present.
 * - GTIN (weight 20, only when both sides carry one): a match
 *   adds the leg; a mismatch VETOES (different physical product).
 *   GTINs are compared digits-only via lib/gtin.ts — a listing
 *   GTIN that fails GS1 is ignored, never used as identity.
 * - model (weight 10, only when both sides carry one): the
 *   NORMALIZED model (lib/model-normalization.ts — "SM-S928B"
 *   variants match each other) must be equal; a mismatch VETOES.
 * - year-token veto: a 4-digit year token (19xx/20xx) in the
 *   title that is not in the product name rejects the listing —
 *   a different model year must never take another product's
 *   price.
 * - accessory-word veto: unchanged from the old matcher (a
 *   fixed list is a weak guard on its own, so it is now a veto
 *   inside a scored match, not the whole match).
 *
 * Decision: `auto` at score >= 0.85 over the available legs
 * (EBAY_MATCH_AUTO_THRESHOLD), `review` below it, `reject` on
 * any veto or on name coverage below 0.80. The old boolean
 * `ebayListingMatchesProduct` (kept in services/ebay-refresh.ts
 * for its existing callers/tests) is now `decision === 'auto'`.
 */

import { validateGtin } from '@/lib/gtin';
import { modelsConflict, modelsMatch, normalizeModel } from '@/lib/model-normalization';

/** Auto-accept a scored eBay match at or above this score (0–1). */
export const EBAY_MATCH_AUTO_THRESHOLD = 0.85;
/** Name-token coverage below this can never be the product. */
export const EBAY_MATCH_MIN_NAME_COVERAGE = 0.8;

export type EbayMatchDecision = 'auto' | 'review' | 'reject';

export interface EbayListingMatchInput {
  productName: string;
  productBrand: string | null;
  productModel?: string | null;
  productGtin?: string | null;
  listingTitle: string;
  listingGtin?: string | null;
}

export interface EbayListingMatchResult {
  decision: EbayMatchDecision;
  /** 0–1 score over the legs that were available, or null on veto. */
  score: number | null;
  /** Calibrated confidence for the decision (same as score when scored). */
  confidence: number | null;
  /** Which leg carried the match, strongest first. */
  matchedBy: 'gtin' | 'model' | 'name-brand' | 'name-brand-fuzzy' | null;
  /** Leg-by-leg breakdown, for the admin / log line. */
  legs: Record<string, number | null>;
  reasons: string[];
}

const ACCESSORY_WORDS = new Set([
  'case',
  'cover',
  'charger',
  'cable',
  'keyboard',
  'screen',
  'protector',
  'stand',
  'mount',
  'bag',
  'sleeve',
  'skin',
  'replacement',
  'battery',
  'adapter',
  'dock',
  'stylus',
  'strap',
  'band',
  'lens',
  'filter',
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

const YEAR_TOKEN = /^(19|20)\d{2}$/;

function yearTokens(tokens: string[]): Set<string> {
  return new Set(tokens.filter((t) => YEAR_TOKEN.test(t)));
}

export function scoreEbayListingMatch(input: EbayListingMatchInput): EbayListingMatchResult {
  const titleTokens = new Set(tokenize(input.listingTitle));
  const nameTokens = tokenize(input.productName);
  const reasons: string[] = [];

  if (nameTokens.length === 0) {
    return {
      decision: 'reject',
      score: null,
      confidence: null,
      matchedBy: null,
      legs: { nameCoverage: null, brand: null, gtin: null, model: null },
      reasons: ['Product has no name tokens to match on.'],
    };
  }

  // Veto 1 — accessory word in the title.
  for (const token of titleTokens) {
    if (ACCESSORY_WORDS.has(token)) {
      return {
        decision: 'reject',
        score: null,
        confidence: null,
        matchedBy: null,
        legs: { nameCoverage: null, brand: null, gtin: null, model: null },
        reasons: [`Listing title contains accessory word "${token}" — an accessory is never the product.`],
      };
    }
  }

  // Veto 2 — year token in the title that the product name does not carry.
  const productYears = yearTokens(nameTokens);
  const titleYears = yearTokens([...titleTokens]);
  for (const year of titleYears) {
    if (!productYears.has(year)) {
      return {
        decision: 'reject',
        score: null,
        confidence: null,
        matchedBy: null,
        legs: { nameCoverage: null, brand: null, gtin: null, model: null },
        reasons: [
          `Listing title carries model year ${year} which the product name does not — a different model year must never take this product's price.`,
        ],
      };
    }
  }

  // Leg 1 — name-token coverage (weight 50).
  const presentNameTokens = nameTokens.filter((t) => titleTokens.has(t));
  const nameCoverage = presentNameTokens.length / nameTokens.length;
  if (nameCoverage < EBAY_MATCH_MIN_NAME_COVERAGE) {
    return {
      decision: 'reject',
      score: null,
      confidence: null,
      matchedBy: null,
      legs: { nameCoverage, brand: null, gtin: null, model: null },
      reasons: [
        `Name-token coverage ${(nameCoverage * 100).toFixed(0)}% is below the ${Math.round(EBAY_MATCH_MIN_NAME_COVERAGE * 100)}% minimum (${presentNameTokens.length}/${nameTokens.length} product-name tokens in the title).`,
      ],
    };
  }

  // Leg 2 — brand tokens (weight 20): every brand token must be present.
  let brandScore: number | null = null;
  if (input.productBrand) {
    const brandTokens = tokenize(input.productBrand);
    if (brandTokens.length > 0) {
      const brandPresent = brandTokens.every((t) => titleTokens.has(t));
      if (!brandPresent) {
        return {
          decision: 'reject',
          score: null,
          confidence: null,
          matchedBy: null,
          legs: { nameCoverage, brand: null, gtin: null, model: null },
          reasons: [`Brand token(s) "${input.productBrand}" are not all in the listing title.`],
        };
      }
      brandScore = 1;
    }
  }

  // Leg 3 — GTIN (weight 20, only when both sides carry a GS1-valid one).
  // A mismatch VETOES: a different GTIN is a different physical product.
  let gtinScore: number | null = null;
  const productGtinCheck = input.productGtin ? validateGtin(input.productGtin) : null;
  const listingGtinCheck = input.listingGtin ? validateGtin(input.listingGtin) : null;
  const productGtin = productGtinCheck?.valid ? productGtinCheck.normalized : null;
  const listingGtin = listingGtinCheck?.valid ? listingGtinCheck.normalized : null;
  if (productGtin && listingGtin) {
    if (productGtin !== listingGtin) {
      return {
        decision: 'reject',
        score: null,
        confidence: null,
        matchedBy: null,
        legs: { nameCoverage, brand: brandScore, gtin: 0, model: null },
        reasons: [
          `GTIN mismatch: product GTIN ${productGtin} differs from listing GTIN ${listingGtin} — a different physical product.`,
        ],
      };
    }
    gtinScore = 1;
    reasons.push(`GTIN matches (${productGtin}).`);
  }

  // Leg 4 — model (weight 10, only when the product model is
  // shown in the title). Normalized comparison (F-P1-46):
  // "SM-S928B" variants match. A missing model in a title is NOT
  // a veto — eBay titles routinely omit the model number. The
  // two-sided veto (both sides carry a model and they differ)
  // lives in scoreEbayListingMatchWithModel below.
  let modelScore: number | null = null;
  const productModel = normalizeModel(input.productModel);
  if (productModel) {
    const titleCompact = input.listingTitle.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (titleCompact.includes(productModel)) {
      modelScore = 1;
      reasons.push(`Model matches (normalized ${productModel}).`);
    } else {
      // The product carries a model the title does not show.
      // That is NOT a veto: eBay titles routinely omit the
      // model number. The leg simply does not contribute, and
      // the score is computed over the legs that did apply.
      // (A veto applies only when BOTH sides carry a model and
      // they differ — see scoreEbayListingMatchWithModel.)
      modelScore = null;
      reasons.push(
        `Product model ${productModel} is not shown in the listing title — the model leg does not contribute (a missing model in a title is not evidence against the match).`
      );
    }
  }

  // Weighted score over the legs that applied.
  const NAME_WEIGHT = 50;
  const BRAND_WEIGHT = 20;
  const GTIN_WEIGHT = 20;
  const MODEL_WEIGHT = 10;
  let earned = nameCoverage * NAME_WEIGHT;
  let available = NAME_WEIGHT;
  if (brandScore !== null) {
    earned += brandScore * BRAND_WEIGHT;
    available += BRAND_WEIGHT;
  }
  if (gtinScore !== null) {
    earned += gtinScore * GTIN_WEIGHT;
    available += GTIN_WEIGHT;
  }
  if (modelScore !== null) {
    earned += modelScore * MODEL_WEIGHT;
    available += MODEL_WEIGHT;
  }
  const score = available > 0 ? earned / available : 0;
  const matchedBy: EbayListingMatchResult['matchedBy'] =
    gtinScore === 1 ? 'gtin' : modelScore === 1 ? 'model' : nameCoverage === 1 ? 'name-brand' : 'name-brand-fuzzy';
  if (score >= EBAY_MATCH_AUTO_THRESHOLD) {
    reasons.push(`Scored match ${score.toFixed(2)} >= auto threshold ${EBAY_MATCH_AUTO_THRESHOLD}.`);
    return {
      decision: 'auto',
      score,
      confidence: score,
      matchedBy,
      legs: { nameCoverage, brand: brandScore, gtin: gtinScore, model: modelScore },
      reasons,
    };
  }
  reasons.push(
    `Scored match ${score.toFixed(2)} is below the auto threshold ${EBAY_MATCH_AUTO_THRESHOLD} — held for manual review, never auto-recorded as this product's price.`
  );
  return {
    decision: 'review',
    score,
    confidence: score,
    matchedBy,
    legs: { nameCoverage, brand: brandScore, gtin: gtinScore, model: modelScore },
    reasons,
  };
}

/**
 * The two-sided model check: when the LISTING carries its own
 * model number (structured field, never scraped from a title),
 * both models present and different is a veto; both present and
 * equal is the strongest model leg. Use this whenever the caller
 * has a listing-side model; `scoreEbayListingMatch` alone can
 * only confirm a product model shown in the title, never veto
 * on a listing-side model it cannot see.
 */
export function scoreEbayListingMatchWithModel(
  input: EbayListingMatchInput & { listingModel?: string | null }
): EbayListingMatchResult {
  const base = scoreEbayListingMatch(input);
  if (base.decision === 'reject') return base;
  const listingModel = normalizeModel(input.listingModel);
  const productModel = normalizeModel(input.productModel);
  if (listingModel && productModel) {
    if (modelsConflict(productModel, listingModel)) {
      return {
        decision: 'reject',
        score: null,
        confidence: null,
        matchedBy: null,
        legs: { ...base.legs, model: 0 },
        reasons: [
          ...base.reasons,
          `Model mismatch: product model ${productModel} differs from listing model ${listingModel} — a different model.`,
        ],
      };
    }
    if (modelsMatch(productModel, listingModel)) {
      return { ...base, matchedBy: 'model', reasons: [...base.reasons, `Model matches (normalized ${productModel}).`] };
    }
  }
  return base;
}
