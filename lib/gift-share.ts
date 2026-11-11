/**
 * Gift Finder shareable URLs (Section 14, chunk 9) — pure helpers, no I/O.
 *
 * The same pattern as the quiz `?answers=` URL: the Gift Finder inputs
 * travel in the query string, so a shared link reopens the same
 * search. Parameters:
 * - `occasion` — must be one of the picker's occasions, else dropped.
 * - `budget` — free text (the same text the budget box accepts);
 *   trimmed, capped at 100 chars, else dropped.
 * - `country` — must be a region code from lib/region, else dropped.
 * - `interests` — comma-separated free text, trimmed, capped at 500
 *   chars, else dropped.
 *
 * Invalid values are DROPPED, never coerced into a guessed default:
 * the page keeps its own defaults for anything missing. Parsing never
 * throws — an unparseable query string yields an empty result.
 */

export interface GiftShareParams {
  occasion?: string;
  budgetText?: string;
  country?: string;
  interests?: string;
}

const MAX_BUDGET_LENGTH = 100;
const MAX_INTERESTS_LENGTH = 500;

/** Build a shareable /gifts URL carrying the current inputs. */
export function buildGiftShareUrl(baseUrl: string, params: GiftShareParams): string {
  const clean = baseUrl.replace(/\/+$/, '');
  const search = new URLSearchParams();
  if (params.occasion) search.set('occasion', params.occasion);
  if (params.budgetText) search.set('budget', params.budgetText);
  if (params.country) search.set('country', params.country);
  if (params.interests) search.set('interests', params.interests);
  const query = search.toString();
  return query ? `${clean}/gifts?${query}` : `${clean}/gifts`;
}

/**
 * Parse a query string (with or without the leading `?`) into the
 * Gift Finder inputs it can honestly carry. `occasions` and
 * `countryCodes` are the picker's own option lists — anything outside
 * them is dropped, never defaulted.
 */
export function parseGiftShareParams(
  search: string,
  occasions: string[],
  countryCodes: string[]
): GiftShareParams {
  const out: GiftShareParams = {};
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const occasion = params.get('occasion');
    if (occasion !== null && occasions.includes(occasion)) out.occasion = occasion;
    const budget = params.get('budget');
    if (budget !== null) {
      const trimmed = budget.trim();
      if (trimmed !== '' && trimmed.length <= MAX_BUDGET_LENGTH) out.budgetText = trimmed;
    }
    const country = params.get('country');
    if (country !== null && countryCodes.includes(country)) out.country = country;
    const interests = params.get('interests');
    if (interests !== null) {
      const trimmed = interests.trim();
      if (trimmed !== '' && trimmed.length <= MAX_INTERESTS_LENGTH) out.interests = trimmed;
    }
  } catch {
    // Unparseable query string: return whatever was parsed so far.
  }
  return out;
}
