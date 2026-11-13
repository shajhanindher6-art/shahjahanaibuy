/**
 * FINAL 100% — model identity precision (F-P1-07, F-P1-27).
 *
 * Live truth: 0/10 products carry a model number (migration 055
 * unapplied, owner-gated), and three live names are FAMILY names,
 * not single models — "MacBook Air 13", "Dell XPS 13",
 * "Lenovo ThinkPad X1". A price cannot be matched to one buyable
 * item without a model + a generation, and no code may guess
 * either: a generation guessed from a family name would be
 * fabrication.
 *
 * This module is the code half:
 * - `validateModelNumber` — the intake/admin rule for a model
 *   number value: trimmed, 1–100 chars, letters/digits/spaces/
 *   hyphens/dots/slashes only, and it must contain at least one
 *   digit (a digit-less value is a family word, not a model).
 *   Fail-closed: an invalid value is rejected with a reason,
 *   never stored, never "fixed up".
 * - `assessIdentityPrecision` — labels a product's identity as
 *   precise only when BOTH a model number AND a generation are
 *   recorded (generation = a year like "2024", a chip like "M4",
 *   or "Gen 11" — supplied by the caller, never inferred from
 *   the name). Anything less is flagged "imprecise" with the
 *   exact gap named, so product surfaces can say so honestly
 *   instead of presenting a family name as a single model.
 * - `modelNumberMissingReason` — the honest-empty wording for
 *   the model-number column while migration 055 is unapplied:
 *   the column does not exist yet, so absence is "not recorded",
 *   never "no model".
 */

export interface ModelNumberValidation {
  valid: boolean;
  /** Trimmed model number when valid, otherwise null. */
  normalized: string | null;
  /** Human-readable reason when invalid, otherwise null. */
  reason: string | null;
}

const MODEL_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _\-./]*$/;

/**
 * Validate a model-number value. A null/blank value is INVALID
 * here — callers that treat the model as optional must check for
 * absence first and render the honest-empty state instead.
 */
export function validateModelNumber(
  value: string | null | undefined
): ModelNumberValidation {
  if (value == null || String(value).trim() === '') {
    return { valid: false, normalized: null, reason: 'Model number is empty' };
  }
  const normalized = String(value).trim().replace(/\s+/g, ' ');
  if (normalized.length > 100) {
    return {
      valid: false,
      normalized: null,
      reason: 'Model number must be at most 100 characters',
    };
  }
  if (!MODEL_NUMBER_PATTERN.test(normalized)) {
    return {
      valid: false,
      normalized: null,
      reason:
        'Model number may contain only letters, digits, spaces, hyphens, dots and slashes',
    };
  }
  if (!/\d/.test(normalized)) {
    return {
      valid: false,
      normalized: null,
      reason:
        'Model number must contain at least one digit — a digit-less value is a family name, not a model',
    };
  }
  return { valid: true, normalized, reason: null };
}

export type IdentityPrecision = 'precise' | 'imprecise';

export interface IdentityPrecisionAssessment {
  precision: IdentityPrecision;
  /** Short label for product surfaces. */
  label: string;
  /** The exact gap(s), empty when precise. */
  reasons: string[];
}

/**
 * Assess whether a product's identity names ONE buyable item.
 * Precise only when a model number AND a generation are both
 * recorded. The generation is never inferred from the name —
 * the caller supplies it (e.g. from a `generation` column or a
 * model number that itself carries one, such as "M4"). A family
 * name with no model is imprecise even when the name looks
 * specific ("MacBook Air 13" is a family, not a model).
 */
export function assessIdentityPrecision(input: {
  name: string | null | undefined;
  modelNumber?: string | null | undefined;
  /** Year / chip / generation string, when recorded. Never inferred. */
  generation?: string | null | undefined;
}): IdentityPrecisionAssessment {
  const reasons: string[] = [];
  const model = input.modelNumber?.trim() ? input.modelNumber.trim() : null;
  const generation = input.generation?.trim() ? input.generation.trim() : null;
  if (!model) {
    reasons.push('Model number is not recorded — the name may be a family name, not a single model');
  }
  if (!generation) {
    reasons.push('Generation is not recorded — the model alone does not pin one buyable item');
  }
  if (reasons.length === 0) {
    return {
      precision: 'precise',
      label: 'Exact model recorded',
      reasons: [],
    };
  }
  return {
    precision: 'imprecise',
    label: 'Family name — exact model not recorded',
    reasons,
  };
}

/**
 * Honest-empty wording for the model-number field while the
 * column is unavailable (migration 055 unapplied). The value is
 * absent because it was never recorded, not because the product
 * has no model.
 */
export function modelNumberMissingReason(columnExists: boolean): string {
  return columnExists
    ? 'Model number not recorded'
    : 'Model number not recorded (model-number column not yet applied)';
}
