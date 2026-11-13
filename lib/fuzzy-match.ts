/**
 * Section 21–25, Stage C — shared near-miss (fuzzy) matching helpers.
 *
 * Pure functions, no DB, no network. Three catalog paths need the
 * same question — "is this near-miss the same thing as that known
 * value, or a genuinely new one?" — and each used to answer it
 * differently (exact-only in brand/category auto-create, exact-only
 * in CSV review, token-Jaccard ≥0.75 only in pipeline dedup):
 *
 * - `tokenSimilarity`: order-free Jaccard over normalized tokens
 *   (the pipeline dedup measure; "MacBook Air 13" vs "Air 13
 *   MacBook" scores 1, "MacBook Air 13" vs "MacBook Pro 13" 0.5).
 * - `bigramSimilarity`: Dice coefficient over character bigrams —
 *   catches singular/plural and typo near-misses token Jaccard
 *   misses ("headphone" vs "headphones" scores ~0.94, while their
 *   token sets are disjoint and score 0).
 * - `nearMissSimilarity`: the max of the two, so either kind of
 *   near-miss is caught. `NEAR_MISS_THRESHOLD` is 0.75, the same
 *   bar the pipeline dedup already uses — a near-miss match is
 *   never a certainty, only a candidate the caller must treat as
 *   a match (brand/category auto-create) or hold for review
 *   (CSV intake).
 *
 * Nothing here invents a value: a score below the threshold is
 * "no match", and the caller creates (or rejects) on that basis.
 */

export const NEAR_MISS_THRESHOLD = 0.75;

/** Lower-case, collapse all non-alphanumerics to single spaces. */
export function normalizeFuzzyText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Token-set Jaccard similarity between two strings (0 = no shared
 * token, 1 = identical token sets). Order-free.
 */
export function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeFuzzyText(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeFuzzyText(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared++;
  return shared / (tokensA.size + tokensB.size - shared);
}

function bigrams(value: string): Set<string> {
  const text = normalizeFuzzyText(value).replace(/ /g, '');
  const out = new Set<string>();
  for (let i = 0; i + 1 < text.length; i++) out.add(text.slice(i, i + 2));
  return out;
}

/**
 * Dice coefficient over character bigrams (0 = nothing shared,
 * 1 = identical strings). Single-character strings have no
 * bigrams and score 1 only when identical, 0 otherwise.
 */
export function bigramSimilarity(a: string, b: string): number {
  const normA = normalizeFuzzyText(a).replace(/ /g, '');
  const normB = normalizeFuzzyText(b).replace(/ /g, '');
  if (normA === normB) return 1;
  if (normA.length < 2 || normB.length < 2) return 0;
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const gram of setA) if (setB.has(gram)) shared++;
  return (2 * shared) / (setA.size + setB.size);
}

/**
 * Near-miss similarity: the stronger of token Jaccard and bigram
 * Dice. A rewording scores on tokens; a typo / singular-plural
 * scores on bigrams. Callers compare against
 * `NEAR_MISS_THRESHOLD` (0.75).
 */
export function nearMissSimilarity(a: string, b: string): number {
  return Math.max(tokenSimilarity(a, b), bigramSimilarity(a, b));
}

/** True when two strings are a near-miss of each other (≥0.75). */
export function isNearMiss(a: string, b: string): boolean {
  return nearMissSimilarity(a, b) >= NEAR_MISS_THRESHOLD;
}
