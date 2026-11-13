/**
 * FINAL 100% — model + brand normalization (F-P1-45, F-P1-46).
 *
 * Before this module there was NO model normalization anywhere in
 * the tree (audit Worker H §2): "SM-S928B", "sm-s928b" and
 * "SM S928B" were three different strings that could never match
 * each other, and `model_number` was never a match leg in any
 * matcher. Brand strings were likewise normalized ad hoc in each
 * caller (three equivalent-but-drifting normalizers).
 *
 * Rules (deliberately narrow — canonicalization must never invent
 * identity):
 * - `normalizeModel`: uppercase, strip every non-alphanumeric
 *   character (spaces, hyphens, underscores, dots, slashes).
 *   Nothing else is dropped: no digit/letter is ever removed, no
 *   leading zero is stripped, and no model is ever "corrected" to
 *   another model. "SM-S928B" / "sm s928b" / "SM_S928B" all become
 *   "SMS928B"; "SM-S928B" and "SM-S928C" stay different.
 * - `normalizeBrand`: lowercase, collapse non-alphanumerics to
 *   single spaces, then apply the small alias map below (legal /
 *   corporate spellings to the canonical short brand). The alias
 *   map is explicit and versioned in code — a brand is never
 *   fuzzy-matched into an alias; aliases are exact after
 *   normalization only.
 * - `modelsMatch` / `modelsConflict`: two models match when both
 *   are present and their normalized forms are equal; they
 *   conflict when both are present and their normalized forms
 *   differ. A missing model is NEITHER a match NOR a conflict —
 *   absence of evidence is never evidence of a different model.
 *   A conflict is a VETO: no matcher in this codebase may
 *   auto-merge two rows whose models conflict (see
 *   services/matching-review.ts).
 */

export function normalizeModel(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized === '' ? null : normalized;
}

/** True when both models are present and normalize to the same value. */
export function modelsMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const normA = normalizeModel(a);
  const normB = normalizeModel(b);
  return normA !== null && normB !== null && normA === normB;
}

/**
 * True when both models are present and normalize to DIFFERENT
 * values. Missing on either side is not a conflict.
 */
export function modelsConflict(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const normA = normalizeModel(a);
  const normB = normalizeModel(b);
  return normA !== null && normB !== null && normA !== normB;
}

/**
 * Canonical brand aliases: normalized corporate/legal spelling ->
 * canonical short brand. Exact-after-normalization only; the map
 * is the whole alias table (there is no brand alias table in the
 * DB — audit Worker H §1). Add a row here, with a test, when a
 * real second spelling of a brand is observed in a feed.
 */
export const BRAND_ALIASES: Readonly<Record<string, string>> = {
  'apple inc': 'apple',
  'apple computer': 'apple',
  'samsung electronics': 'samsung',
  'hewlett packard': 'hp',
  'hewlett packard enterprise': 'hp',
  'lg electronics': 'lg',
  'sony corporation': 'sony',
  'lenovo group': 'lenovo',
  'dell technologies': 'dell',
  'bose corporation': 'bose',
  'canon inc': 'canon',
  'gopro inc': 'gopro',
  'garmin ltd': 'garmin',
  'logitech international': 'logitech',
};

/** Canonical brand key: normalized, alias-resolved, or null when blank. */
export function normalizeBrand(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  if (normalized === '') return null;
  return BRAND_ALIASES[normalized] ?? normalized;
}

/** True when two brand strings are the same brand after canonicalization. */
export function brandsMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const normA = normalizeBrand(a);
  const normB = normalizeBrand(b);
  return normA !== null && normB !== null && normA === normB;
}
