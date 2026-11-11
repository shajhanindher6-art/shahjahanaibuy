/**
 * Did-you-mean / typo correction for zero-result searches (Section 14,
 * Chunk 4 — B5).
 *
 * Pure functions, no database, no network. The caller passes the token
 * set from the catalog it actually fetched (product names, brands,
 * categories — the search page already fetches the full product list
 * for its facet dropdowns), and this module corrects the query's words
 * against that set with Levenshtein distance.
 *
 * The page NEVER auto-redirects: it offers one "Did you mean: X?"
 * link, and only the visitor's tap runs the corrected search.
 */

/** Catalog tokens, from the product list the page already fetched. */
export interface SearchCatalogTokens {
  names: string[];
  brands: string[];
  categories: string[];
}

/** Words that are never corrected: intent / filler / budget words. */
const SUGGESTION_STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'with', 'and', 'or', 'of', 'to', 'in', 'on',
  'under', 'over', 'below', 'above', 'between', 'from', 'up', 'is', 'it',
  'its', 'this', 'that', 'any', 'more', 'less', 'than', 'best', 'top',
  'cheap', 'cheapest', 'budget', 'affordable', 'premium', 'professional',
  'good', 'great', 'buy', 'find', 'show', 'me', 'please', 'vs', 'versus',
  'compare', 'without', 'not', 'no', 'except', 'excluding', 'has', 'have',
  'sasta', 'sasti', 'behtareen', 'mehenga', 'mehanga',
]);

/**
 * Levenshtein edit distance, with an early exit when the length
 * difference alone already exceeds `maxDistance` — the caller only
 * ever accepts small distances, so there is no need to fill the
 * whole matrix for wildly different words.
 */
export function levenshteinDistance(a: string, b: string, maxDistance = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** All searchable words in the catalog: name words + brands + categories. */
export function catalogTokenSet(catalog: SearchCatalogTokens): Set<string> {
  const tokens = new Set<string>();
  const addWords = (text: string) => {
    for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length >= 3) tokens.add(word);
    }
  };
  for (const name of catalog.names) addWords(name);
  for (const brand of catalog.brands) addWords(brand);
  for (const category of catalog.categories) addWords(category);
  return tokens;
}

/**
 * Correct a single mistyped token against the catalog token set.
 * Accepts distance 1 for short words (3–5 letters) and distance 2
 * for longer ones — a 2-edit correction on a 3-letter word would
 * match almost anything ("lap" → "gap"). Returns null when the token
 * is already a catalog token, too short, a stopword, or has no close
 * neighbour.
 */
export function correctToken(token: string, catalogTokens: Set<string>): string | null {
  const lower = token.toLowerCase();
  if (lower.length < 3) return null;
  if (SUGGESTION_STOPWORDS.has(lower)) return null;
  if (/^\d+$/.test(lower)) return null;
  if (catalogTokens.has(lower)) return null;
  const maxDistance = lower.length >= 6 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = maxDistance + 1;
  for (const candidate of catalogTokens) {
    const distance = levenshteinDistance(lower, candidate, maxDistance);
    if (distance > maxDistance) continue;
    // A 2-edit correction is only plausible when the word starts
    // the same way (a transposition or doubled letter preserves
    // the prefix) — without this, "toaster" corrects to "master"
    // (distance 2, unrelated word) and the suggestion is nonsense.
    if (distance === 2 && candidate.slice(0, 2) !== lower.slice(0, 2)) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
      if (distance === 1 && lower.length < 6) break;
    }
  }
  return bestDistance <= maxDistance ? best : null;
}

/**
 * Correct a whole query token by token, preserving word order and
 * every token that needs no correction (numbers, stopwords, exact
 * catalog words). Returns the corrected query, or null when nothing
 * changed — the caller shows "Did you mean: …?" only for a
 * non-null return, and never navigates on its own.
 */
export function suggestSearchCorrection(
  query: string,
  catalog: SearchCatalogTokens
): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const tokens = catalogTokenSet(catalog);
  if (tokens.size === 0) return null;
  const words = trimmed.split(/\s+/);
  let changed = false;
  const corrected = words.map((word) => {
    // Keep punctuation attached to a word out of the comparison
    // ("macbok," corrects to "macbook,"), and never touch a word
    // that carries a currency symbol or digit-led token.
    const match = /^([^a-z0-9]*)([a-z0-9]+)([^a-z0-9]*)$/i.exec(word);
    if (!match) return word;
    const [, prefix, core, suffix] = match;
    // A digit-led token ("13", "$1000", "1000xm5") is a number or a
    // model token, never a typo candidate — leave it alone.
    if (/^\d/.test(core)) return word;
    const fix = correctToken(core, tokens);
    if (!fix) return word;
    changed = true;
    return `${prefix}${fix}${suffix}`;
  });
  if (!changed) return null;
  const suggestion = corrected.join(' ');
  return suggestion.toLowerCase() === trimmed.toLowerCase() ? null : suggestion;
}

/**
 * Longest word of a multi-word query (Section 14, Chunk 4 — B13):
 * the autocomplete fallback token. The products API matches the
 * whole typed phrase, so "macbook 13" suggests nothing (the name
 * is "MacBook Air 13") — retrying with the longest token
 * ("macbook") still suggests the product the entry names. Null for
 * a single token (no fallback to try) or when no token is at least
 * 3 letters — a 1–2 letter token would match half the catalog.
 */
export function fallbackAutocompleteToken(term: string): string | null {
  const words = term.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length < 2) return null;
  // Only a word of 3+ letters can be a fallback — a 1–2 letter
  // token would match half the catalog ("13" alone is not a
  // useful suggestion query).
  const candidates = words.filter((w) => w.length >= 3);
  if (candidates.length === 0) return null;
  let longest = candidates[0];
  for (const word of candidates) {
    if (word.length > longest.length) longest = word;
  }
  return longest;
}
