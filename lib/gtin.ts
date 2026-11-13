/**
 * Section 20, §12 #31 — GS1 GTIN validation + normalization.
 *
 * Pure functions, no DB, no network. A GTIN is a GS1 identifier
 * (GTIN-8 / GTIN-12 / GTIN-13 / GTIN-14 — EAN-8, UPC-A, EAN-13,
 * ITF-14). Before this module the only check anywhere was zod
 * `.max(50)` and intake passed the value verbatim, so a typo'd
 * GTIN was stored as if it were a real product identity.
 *
 * Validation rule (GS1 check digit): strip spaces and hyphens,
 * require all digits and a length of 8, 12, 13 or 14, then verify
 * the final digit: reading the other digits right-to-left,
 * multiply alternate digits by 3 and 1, sum them, and the check
 * digit is (10 - (sum mod 10)) mod 10.
 *
 * Normalization is loss-free for real GTINs (digits only) — it
 * only removes the separators humans type (`978-0-2013-7962-4`
 * and `9780201379624` are the same GTIN). An empty / blank value
 * normalizes to null (absent), never to an empty string.
 */

/** Lengths GS1 defines for a GTIN. */
export const GTIN_LENGTHS = [8, 12, 13, 14] as const;

/** Canonical GTIN: digits only, no separators. */
export function normalizeGtin(value: string | null | undefined): string | null {
  if (value == null) return null;
  const digits = value.replace(/[\s-]/g, '');
  return digits === '' ? null : digits;
}

export interface GtinValidation {
  valid: boolean;
  /** Digits-only GTIN when valid, otherwise null. */
  normalized: string | null;
  /** Human-readable reason when invalid, otherwise null. */
  reason: string | null;
}

/**
 * Validate a GTIN value. Returns `{ valid: true, normalized }`
 * for a GS1-valid GTIN, otherwise `{ valid: false, reason }`.
 * A null / undefined / blank value is INVALID here — callers
 * that treat GTIN as optional must check for absence first
 * (see `normalizeGtin`, which maps absence to null).
 */
export function validateGtin(value: string | null | undefined): GtinValidation {
  if (value == null || String(value).trim() === '') {
    return { valid: false, normalized: null, reason: 'GTIN is empty' };
  }
  const digits = normalizeGtin(value);
  if (digits === null) {
    return { valid: false, normalized: null, reason: 'GTIN is empty' };
  }
  if (!/^\d+$/.test(digits)) {
    return {
      valid: false,
      normalized: null,
      reason: 'GTIN must contain digits only (spaces and hyphens are allowed as separators)',
    };
  }
  if (!GTIN_LENGTHS.includes(digits.length as (typeof GTIN_LENGTHS)[number])) {
    return {
      valid: false,
      normalized: null,
      reason: `GTIN must be 8, 12, 13 or 14 digits long, got ${digits.length}`,
    };
  }
  const body = digits.slice(0, -1);
  const checkDigit = Number(digits[digits.length - 1]);
  let sum = 0;
  for (let i = body.length - 1, position = 0; i >= 0; i--, position++) {
    sum += Number(body[i]) * (position % 2 === 0 ? 3 : 1);
  }
  const expected = (10 - (sum % 10)) % 10;
  if (expected !== checkDigit) {
    return {
      valid: false,
      normalized: null,
      reason: `GTIN check digit is wrong (expected ${expected}, got ${checkDigit})`,
    };
  }
  return { valid: true, normalized: digits, reason: null };
}

/** Convenience boolean wrapper around `validateGtin`. */
export function isValidGtin(value: string | null | undefined): boolean {
  return validateGtin(value).valid;
}
