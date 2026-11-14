/**
 * FINAL 100% Product & Real Data Completion — F-P1-06: the
 * whole-record "fully verified" definition.
 *
 * Before this module, "verified" was a PRICE-level concept with a
 * product-level label stuck on it: `price_verification_status` +
 * `price_verified_at` (+ freshness) decided every "verified"
 * label, and no code anywhere computed whether a whole PRODUCT
 * record was verified. The closest were the 5-state taxonomy
 * (`getDataQualityState` — price-centric, and its `partial` state
 * is earnable by a single field) and the 7-dimension quality
 * score (a completeness/freshness score, explicitly NOT a
 * verification verdict).
 *
 * This module is THE one definition: a single pure function,
 * `isFullyVerified`, over the whole record. It is pure (no DB, no
 * network, no clock except the `now` parameter), it returns a
 * per-criterion breakdown (not just a boolean) so a surface can
 * say WHAT is missing, and it fails closed: anything unknown —
 * a count the caller did not read, a listing whose reality was
 * not proven — counts as missing, never as present.
 *
 * CRITERIA (all must pass):
 *   identity      — name, brand, category, description present.
 *   model         — a model number is recorded, where applicable
 *                   (caller passes modelNumberApplicable: false
 *                   for products that genuinely have none).
 *   gtin          — a GTIN is recorded AND GS1-valid. A valid
 *                   check digit proves the number is well-formed,
 *                   not that it belongs to this product — so GTIN
 *                   is necessary here, never sufficient on its own.
 *   specs         — at least one stored product_attributes row.
 *   image         — a valid http(s) image URL, or at least one
 *                   stored product_images row.
 *   merchant      — at least one merchant listing AND at least one
 *                   listing proven to be a real listing (a
 *                   merchant SKU recorded — a search URL with no
 *                   SKU is not a listing match). The caller proves
 *                   this; the function never guesses it from a row
 *                   count, because the whole seeded catalog has
 *                   rows and zero real listings.
 *   attribution   — a price source is recorded for the cheapest
 *                   listing (a source the price can be traced to).
 *   freshPrice    — the price is 'verified' AND the check is fresh
 *                   (age <= STALE_PRICE_DAYS). A verified stamp
 *                   with no check date, or an expired check, fails.
 *   verifiedAt    — a verification timestamp is recorded at all
 *                   (listed separately so a dateless stamp is
 *                   named, not silently folded into freshPrice).
 *
 * PUBLISHING GATE: publishing today requires almost nothing — a
 * listing existing is the bar — and this function does NOT change
 * that: it is the gate's VERDICT, consulted at publish time
 * (intake approve reports it) and on the data-quality surfaces,
 * not a blocker that would hold the entire current catalog
 * unpublished. A product is "fully verified" only when every
 * criterion passes; anything else is published-but-not-verified,
 * and the missing list says exactly what would close the gap.
 * No product in the current catalog can pass: 0/10 have specs,
 * images, GTINs, model numbers, or verified prices — which is
 * the honest state, not a reason to weaken the definition.
 */

import { STALE_PRICE_DAYS, getPriceAgeDays } from '@/lib/price-freshness';
import {
  datelessVerifiedReason,
  expiredVerifiedCheckReason,
  freshVerifiedCheckReason,
  neverVerifiedReason,
} from '@/lib/verification/price-state-reasons';
import { validateGtin } from '@/lib/gtin';
import { validateImageUrl } from '@/lib/image-url';
import type { PriceVerificationStatus } from '@/services/price-verification';

export type FullyVerifiedCheckKey =
  | 'identity'
  | 'model'
  | 'gtin'
  | 'specs'
  | 'image'
  | 'merchant'
  | 'attribution'
  | 'freshPrice'
  | 'verifiedAt';

export interface FullyVerifiedCheck {
  key: FullyVerifiedCheckKey;
  /** Short label for the criterion (render it). */
  label: string;
  passed: boolean;
  /** Why it passed, or what is missing (render it when failed). */
  reason: string;
}

export interface FullyVerifiedInput {
  name?: string | null;
  brand?: string | null;
  category?: string | null;
  description?: string | null;
  /** Recorded model number, or null. */
  modelNumber?: string | null;
  /** False for products that genuinely have no model number. */
  modelNumberApplicable?: boolean;
  gtin?: string | null;
  imageUrl?: string | null;
  priceVerificationStatus?: PriceVerificationStatus | string | null;
  priceVerifiedAt?: string | null;
  /** Age in whole days of the last verification check (null = unknown). */
  priceAgeDays?: number | null;
  /** Stored product_attributes rows (null = not read → missing). */
  specCount?: number | null;
  /** Stored product_images rows (null = not read → missing). */
  imageCount?: number | null;
  /** merchant_products rows (null = not read → missing). */
  merchantCount?: number | null;
  /**
   * True when at least one listing is proven to be a real listing
   * (a merchant SKU recorded, not a search URL). Null = unknown
   * → missing. The caller proves this; a row count cannot.
   */
  hasRealMerchantListing?: boolean | null;
  /** True when a price source is recorded for the cheapest listing. */
  hasPriceSource?: boolean | null;
  /** Clock for the age computation (default: now). Tests pin it. */
  now?: Date;
}

export interface FullyVerifiedResult {
  /** True only when EVERY criterion passes. */
  fullyVerified: boolean;
  /** One entry per criterion, in definition order. */
  checks: FullyVerifiedCheck[];
  /** Labels of the failed criteria (empty = fully verified). */
  missing: string[];
  /**
   * One plain-language line per failed criterion, in definition
   * order — render these next to the verdict, never a bare
   * true/false.
   */
  reasons: string[];
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isFullyVerified(input: FullyVerifiedInput): FullyVerifiedResult {
  const now = input.now ?? new Date();
  const checks: FullyVerifiedCheck[] = [];

  // Identity: name / brand / category / description.
  {
    const missing: string[] = [];
    if (!hasText(input.name)) missing.push('name');
    if (!hasText(input.brand)) missing.push('brand');
    if (!hasText(input.category)) missing.push('category');
    if (!hasText(input.description)) missing.push('description');
    checks.push({
      key: 'identity',
      label: 'Identity',
      passed: missing.length === 0,
      reason:
        missing.length === 0
          ? 'Name, brand, category and description are recorded.'
          : `Missing identity fields: ${missing.join(', ')}.`,
    });
  }

  // Model number, where applicable.
  {
    const applicable = input.modelNumberApplicable !== false;
    if (!applicable) {
      checks.push({
        key: 'model',
        label: 'Model number',
        passed: true,
        reason: 'No model number applies to this product.',
      });
    } else if (hasText(input.modelNumber)) {
      checks.push({
        key: 'model',
        label: 'Model number',
        passed: true,
        reason: 'A model number is recorded.',
      });
    } else {
      checks.push({
        key: 'model',
        label: 'Model number',
        passed: false,
        reason: 'No model number is recorded.',
      });
    }
  }

  // GTIN: present AND GS1-valid.
  {
    if (!hasText(input.gtin)) {
      checks.push({
        key: 'gtin',
        label: 'GTIN',
        passed: false,
        reason: 'No GTIN is recorded.',
      });
    } else if (validateGtin(input.gtin as string).valid) {
      checks.push({
        key: 'gtin',
        label: 'GTIN',
        passed: true,
        reason: 'A GS1-valid GTIN is recorded.',
      });
    } else {
      checks.push({
        key: 'gtin',
        label: 'GTIN',
        passed: false,
        reason: 'The recorded GTIN fails GS1 validation.',
      });
    }
  }

  // Specs: at least one stored row.
  {
    const count = input.specCount ?? null;
    checks.push({
      key: 'specs',
      label: 'Specifications',
      passed: count !== null && count > 0,
      reason:
        count !== null && count > 0
          ? `${count} specification${count === 1 ? '' : 's'} recorded.`
          : 'No specifications are recorded.',
    });
  }

  // Image: a valid URL, or at least one stored gallery row.
  {
    const urlValid =
      typeof input.imageUrl === 'string' && validateImageUrl(input.imageUrl).valid;
    const galleryCount = input.imageCount ?? null;
    const passed = urlValid || (galleryCount !== null && galleryCount > 0);
    checks.push({
      key: 'image',
      label: 'Image',
      passed,
      reason: passed
        ? 'A valid image is recorded.'
        : 'No valid image URL and no stored product image.',
    });
  }

  // Merchant mapping: a listing exists AND one is a real listing.
  {
    const count = input.merchantCount ?? null;
    if (count === null || count <= 0) {
      checks.push({
        key: 'merchant',
        label: 'Merchant listing',
        passed: false,
        reason: 'No merchant listing is recorded.',
      });
    } else if (input.hasRealMerchantListing === true) {
      checks.push({
        key: 'merchant',
        label: 'Merchant listing',
        passed: true,
        reason: 'At least one listing is a real merchant listing (SKU recorded).',
      });
    } else {
      checks.push({
        key: 'merchant',
        label: 'Merchant listing',
        passed: false,
        reason:
          'Merchant rows exist, but none is proven to be a real listing (no merchant SKU recorded — search URLs are not listings).',
      });
    }
  }

  // Source attribution: a price source is recorded.
  {
    checks.push({
      key: 'attribution',
      label: 'Source attribution',
      passed: input.hasPriceSource === true,
      reason:
        input.hasPriceSource === true
          ? 'A price source is recorded for the cheapest listing.'
          : 'No price source is recorded.',
    });
  }

  // Fresh verified price: status 'verified' + a fresh check.
  // S2-6: the reasons below are built by the shared builder
  // (lib/verification/price-state-reasons.ts), the same builder
  // lib/verification/price-state.ts uses — the wordings are
  // identical to before this refactor.
  {
    const status = input.priceVerificationStatus;
    const age =
      input.priceAgeDays !== undefined
        ? input.priceAgeDays
        : getPriceAgeDays(input.priceVerifiedAt ?? null, now);
    if (status !== 'verified') {
      checks.push({
        key: 'freshPrice',
        label: 'Fresh verified price',
        passed: false,
        reason: neverVerifiedReason({ subject: 'price', verb: 'verified', unknownAge: false }),
      });
    } else if (age === null) {
      checks.push({
        key: 'freshPrice',
        label: 'Fresh verified price',
        passed: false,
        reason: datelessVerifiedReason({ cannotBeShownCurrent: false }),
      });
    } else if (age <= STALE_PRICE_DAYS) {
      checks.push({
        key: 'freshPrice',
        label: 'Fresh verified price',
        passed: true,
        reason: freshVerifiedCheckReason(age, STALE_PRICE_DAYS, {
          verb: 'verified',
          windowClause: false,
        }),
      });
    } else {
      checks.push({
        key: 'freshPrice',
        label: 'Fresh verified price',
        passed: false,
        reason: expiredVerifiedCheckReason(age, STALE_PRICE_DAYS, {
          once: false,
          expiredSuffix: false,
        }),
      });
    }
  }

  // Verification timestamp recorded at all.
  {
    checks.push({
      key: 'verifiedAt',
      label: 'Verification timestamp',
      passed: hasText(input.priceVerifiedAt),
      reason: hasText(input.priceVerifiedAt)
        ? 'A verification timestamp is recorded.'
        : 'No verification timestamp is recorded.',
    });
  }

  const failed = checks.filter((c) => !c.passed);
  return {
    fullyVerified: failed.length === 0,
    checks,
    missing: failed.map((c) => c.label),
    reasons: failed.map((c) => c.reason),
  };
}
