/**
 * AI-powered product search service.
 * Parses natural language queries, extracts intent, and searches products
 * with intelligent scoring.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { swrGet, cacheKey } from '@/lib/cache';
import type { Product } from '@/types';
import type { AISearchResult, ParsedSearchIntent, SearchFilters, SearchHistoryEntry } from '@/types/ai';
import {
  parseBudgetFromQuery,
  parsePriceBandFromQuery,
  stripBudgetFromQuery,
  formatOriginalAmount,
} from './currency';
import { getLatestPrices } from './price-history';
import { predictPriceDrop } from './ai-predictions';
import { dealScoreForDisplay } from '@/lib/deal-score';
import { discountPercent } from '@/lib/deal-math';
import { PUBLISHED_PRODUCT_STATUS, normalizePriceVerificationStatus } from '@/services/price-verification';
import {
  FEW_SEARCH_RESULTS,
  levenshteinDistance,
  suggestSearchCorrection,
  type SearchCatalogTokens,
} from '@/lib/search-suggestions';

// ---------------------------------------------------------------------------
// Intent parsing
// ---------------------------------------------------------------------------

/** Word-boundary test for a keyword in lower-cased text. Short
 *  tokens (5g, 4k, ram, ssd) need the boundary — a bare includes()
 *  would match "ram" inside "program" — while multi-word phrases
 *  match by inclusion. */
export function textContainsKeyword(text: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  if (/[^a-z0-9]/.test(kw)) return text.toLowerCase().includes(kw);
  return new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text.toLowerCase());
}

function escapeRegExp(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Description-keyword attributes: the ONLY attribute source is
 * name + description text (product_attributes has 0 rows), so a
 * match is always a description-keyword match, never a spec match
 * — the search explanation says so. Keys are the values stored in
 * ParsedSearchIntent.attributes and in AISearchResult.matchedAttributes.
 */
export const ATTRIBUTE_KEYWORDS: Record<string, string[]> = {
  battery: ['battery life', 'long battery'],
  weight: ['lightweight', 'light weight', 'portable'],
  resolution: ['4k', 'ultra hd'],
  display: ['oled'],
  waterproof: ['waterproof', 'water resistant'],
  ram: ['ram'],
  storage: ['storage', 'ssd', 'hard drive', '512gb', '256gb', '1tb'],
  'screen-size': ['screen size', '13-inch', '14-inch', '15-inch', '16-inch', '17-inch'],
  'noise-cancelling': ['noise cancelling', 'noise-cancelling', 'noise cancellation'],
  touchscreen: ['touchscreen', 'touch screen'],
  '5g': ['5g'],
  'refresh-rate': ['refresh rate', '120hz', '144hz', '60hz'],
};

/** Human labels for the attribute keys above (badges + explanations). */
export const ATTRIBUTE_LABELS: Record<string, string> = {
  battery: 'Long battery',
  weight: 'Lightweight',
  resolution: '4K',
  display: 'OLED',
  waterproof: 'Waterproof',
  ram: 'RAM',
  storage: 'Storage',
  'screen-size': 'Screen size',
  'noise-cancelling': 'Noise cancelling',
  touchscreen: 'Touchscreen',
  '5g': '5G',
  'refresh-rate': 'Refresh rate',
};

/** Values stored in ParsedSearchIntent.attributes per key. */
const ATTRIBUTE_VALUES: Record<string, string> = {
  battery: 'long',
  weight: 'light',
  resolution: '4k',
  display: 'oled',
  waterproof: 'true',
  ram: 'yes',
  storage: 'yes',
  'screen-size': 'yes',
  'noise-cancelling': 'yes',
  touchscreen: 'yes',
  '5g': 'yes',
  'refresh-rate': 'yes',
};

/**
 * Roman Urdu first-turn intent aliases (B8): Roman Urdu is
 * handled in follow-ups and Product-QA already, but the first-turn
 * parser was English-only, so "sasta laptop" yielded no
 * price-led intent. Aliases are replaced (word-boundary) before
 * intent detection — no new intent kinds, just the same
 * best/cheap/premium intents the English words already produce.
 */
const ROMAN_URDU_INTENT_ALIASES: Array<[RegExp, string]> = [
  [/\bsast[ai]\b/g, 'cheap'],
  [/\bbehtareen\b/g, 'best'],
  [/\bsab\s?se\s+acha\b/g, 'best'],
  [/\bmeh[e]ng[ai]\b/g, 'premium'],
  [/\bmehanga\b/g, 'premium'],
];

const NEGATION_WORDS = ['not', 'without', 'no', 'except', 'excluding'] as const;
const NEGATION_PATTERN = `(?:${NEGATION_WORDS.join('|')})`;

const KNOWN_BRANDS = ['apple', 'samsung', 'sony', 'dell', 'hp', 'lenovo', 'asus', 'acer', 'canon', 'nikon', 'lg', 'google', 'microsoft', 'bose', 'jbl', 'anker', 'razer', 'logitech', 'garmin', 'fitbit', 'xiaomi', 'oneplus'];

/** Words that may never be treated as an excluded term: budget /
 *  category / filler words after a negation ("no more than $500"
 *  excludes nothing). */
const NEGATION_STOPWORDS = new Set([
  'a', 'an', 'the', 'any', 'more', 'less', 'than', 'with', 'for', 'and', 'or', 'of', 'to', 'in', 'on',
  'is', 'it', 'its', 'this', 'that', 'under', 'below', 'above', 'over', 'between', 'from', 'up',
  'laptop', 'phone', 'camera', 'watch', 'headphones', 'tablet', 'tv', 'gaming', 'keyboard', 'mouse',
  'monitor', 'speaker', 'smartphone', 'notebook', 'ultrabook', 'macbook', 'iphone', 'android',
  'dslr', 'mirrorless', 'smartwatch', 'earbuds', 'airpods', 'headset', 'ipad', 'kindle',
  'television', 'xbox', 'playstation', 'nintendo', 'switch', 'display', 'screen',
]);

const CATEGORY_KEYWORD_SET = new Set(
  ['laptop', 'notebook', 'ultrabook', 'macbook', 'phone', 'smartphone', 'iphone', 'android',
    'samsung galaxy', 'camera', 'dslr', 'mirrorless', 'camcorder', 'gopro', 'watch', 'smartwatch',
    'apple watch', 'garmin', 'fitbit', 'headphones', 'earbuds', 'airpods', 'headset', 'tablet',
    'ipad', 'kindle', 'tv', 'television', 'oled', 'qled', 'smart tv', 'gaming', 'xbox',
    'playstation', 'ps5', 'nintendo', 'switch', 'keyboard', 'mechanical keyboard', 'mouse',
    'gaming mouse', 'monitor', 'display', 'screen', 'speaker', 'bluetooth speaker', 'soundbar']
);

/**
 * Negation / exclusion intent (B2): "laptop not Apple" / "phone
 * without OLED" / "headphones no noise cancelling". Returns the
 * excluded brands (capitalized, same form as `brands`) and the
 * excluded description-keyword terms. A negated brand is never
 * also a positive brand — the caller removes it from `brands`.
 */
export function parseNegations(lower: string): { excludedBrands: string[]; excludedTerms: string[] } {
  const excludedBrands: string[] = [];
  for (const brand of KNOWN_BRANDS) {
    if (new RegExp(`\\b${NEGATION_PATTERN}\\s+${escapeRegExp(brand)}\\b`).test(lower)) {
      excludedBrands.push(brand.charAt(0).toUpperCase() + brand.slice(1));
    }
  }
  const excludedTerms: string[] = [];
  const pushTerm = (term: string) => {
    if (!excludedTerms.includes(term)) excludedTerms.push(term);
  };
  for (const keywords of Object.values(ATTRIBUTE_KEYWORDS)) {
    for (const kw of keywords) {
      if (new RegExp(`\\b${NEGATION_PATTERN}\\s+${escapeRegExp(kw)}\\b`).test(lower)) {
        pushTerm(kw);
      }
    }
  }
  // Generic fallback: the single word after a negation word, when
  // it is not a brand, a category word, or a stopword — so
  // "without silk" still excludes "silk" even though it is not a
  // known attribute keyword.
  const generic = new RegExp(`\\b${NEGATION_PATTERN}\\s+([a-z][a-z0-9-]{2,})`, 'g');
  let m: RegExpExecArray | null;
  while ((m = generic.exec(lower)) !== null) {
    const token = m[1];
    if (KNOWN_BRANDS.includes(token)) continue;
    if (CATEGORY_KEYWORD_SET.has(token)) continue;
    if (NEGATION_STOPWORDS.has(token)) continue;
    if (Object.values(ATTRIBUTE_KEYWORDS).flat().includes(token)) continue;
    pushTerm(token);
  }
  return { excludedBrands, excludedTerms };
}

/**
 * Remove the negated phrases ("not Apple", "without OLED") from a
 * query so the remainder can be used as product search terms —
 * otherwise the ilike match would search for the literal phrase
 * "laptop not apple" and return nothing.
 */
export function stripNegatedPhrases(query: string, intent: ParsedSearchIntent): string {
  let out = query;
  for (const phrase of [...intent.excludedBrands, ...intent.excludedTerms]) {
    // A space in a phrase matches a space or a hyphen in the query
    // ("noise cancelling" also strips "noise-cancelling").
    const pattern = escapeRegExp(phrase).replace(/ /g, '[ -]');
    out = out.replace(
      new RegExp(`\\b${NEGATION_PATTERN}\\s+${pattern}\\b`, 'gi'),
      ' '
    );
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Tokenized search (Section 14, Chunk 4 — B1)
// ---------------------------------------------------------------------------

/**
 * Words that carry no product meaning in a search query — intent
 * words ("best", "cheap"), filler ("for", "the") and the negation
 * words themselves (negated phrases are stripped before this runs).
 * They must never become match tokens: requiring a product to
 * contain "cheap" would empty almost every search.
 */
const SEARCH_TOKEN_STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'with', 'and', 'or', 'of', 'to', 'in', 'on',
  'under', 'over', 'below', 'above', 'between', 'from', 'up', 'is', 'it',
  'its', 'this', 'that', 'any', 'more', 'less', 'than', 'best', 'top',
  'cheap', 'cheapest', 'budget', 'affordable', 'premium', 'professional',
  'good', 'great', 'buy', 'find', 'show', 'me', 'please', 'vs', 'versus',
  'compare', 'without', 'not', 'no', 'except', 'excluding', 'has', 'have',
]);

/**
 * Split a query into match tokens: budget expressions and negated
 * phrases are stripped first (same helpers the intent parser uses),
 * then the remainder is split on non-alphanumerics, stopwords and
 * one-letter fragments are dropped (a bare digit survives — "13"
 * in "MacBook Air 13" is a model token), and duplicates are removed.
 * "apple laptop" → ["apple", "laptop"]; "best laptop under $1000"
 * → ["laptop"]. Pure — unit-tested in tests/search-tokenization.
 */
export function tokenizeSearchTerms(query: string, intent: ParsedSearchIntent): string[] {
  const cleaned = stripNegatedPhrases(stripBudgetFromQuery(query), intent)
    .replace(/\bvs\.?\b|\bversus\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const tokens: string[] = [];
  for (const raw of cleaned.split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    if (raw.length < 2 && !/^\d+$/.test(raw)) continue;
    if (SEARCH_TOKEN_STOPWORDS.has(raw)) continue;
    if (tokens.includes(raw)) continue;
    tokens.push(raw);
  }
  return tokens;
}

/** A token matches text on a word boundary, or its plural ("laptop"
 *  also matches a "laptops" category — the plural form is a
 *  different word to the boundary test, but the same search). */
function tokenMatchesText(text: string, token: string): boolean {
  return textContainsKeyword(text, token) || textContainsKeyword(text, `${token}s`);
}

/**
 * Section 16, #37 — curated synonym map over the catalog's own
 * vocabulary (10 products: laptop / phone / headphones / tv /
 * tablet / watch / speaker / camera / console / monitor). A
 * synonym is only ever a word shoppers actually type for a
 * category the catalog carries — never a brand, never a spec, and
 * never a generated variant. "notebook" expands to "laptop";
 * "smartphone" / "cellphone" / "mobile" expand to "phone". The
 * map is deliberately small: a wrong synonym would surface
 * unrelated products, and a 10-product catalog needs no thesaurus.
 */
export const SEARCH_SYNONYMS: Record<string, string> = {
  notebook: 'laptop',
  netbook: 'laptop',
  smartphone: 'phone',
  cellphone: 'phone',
  mobile: 'phone',
  earbuds: 'headphones',
  earphones: 'headphones',
  television: 'tv',
  smartwatch: 'watch',
  tabletpc: 'tablet',
};

/**
 * Expand query tokens with their canonical synonyms (Section 16,
 * #37). The original token is kept first — the expanded token is
 * appended, never a replacement — so scoring still credits the
 * typed word and the "Matched: …" line can show the catalog word
 * that actually matched. Pure.
 */
export function expandSearchTokens(tokens: string[]): string[] {
  const expanded = [...tokens];
  for (const token of tokens) {
    const synonym = SEARCH_SYNONYMS[token];
    if (synonym && !expanded.includes(synonym)) expanded.push(synonym);
  }
  return expanded;
}

/**
 * Section 16, #37 — typo-tolerant word match. A token matches a
 * catalog word when the Levenshtein distance is small relative to
 * the token: distance ≤ 1 for tokens of 4–5 letters ("macbok" →
 * "macbook" is distance 1), ≤ 2 for tokens of 6+ letters. Tokens
 * shorter than 4 letters never fuzzy-match (a 1-edit distance on
 * "air" would match half the catalog). Exact word-boundary matches
 * always win first — this only runs when they fail — and the
 * did-you-mean correction (Section 15, B10) still reports the
 * corrected spelling, so the page never silently swaps the query.
 */
export function tokenMatchesWordFuzzy(token: string, word: string): boolean {
  if (token.length < 4 || word.length < 4) return false;
  const maxDistance = token.length >= 6 ? 2 : 1;
  return levenshteinDistance(token, word.toLowerCase(), maxDistance) <= maxDistance;
}

export interface TokenMatch {
  /** Tokens found anywhere in name/brand/category/description. */
  matchedTerms: string[];
  /** Tokens found in the product name (stronger signal). */
  nameMatchedTerms: string[];
}

/**
 * Which of the query's tokens a product actually carries — the
 * coverage signal behind the tokenized score (see aiSearch) and the
 * "Matched: …" line on the search card. Never a spec claim: it is
 * text matching over the four catalog text fields only.
 */
export function computeTokenMatches(
  tokens: string[],
  product: { name: string; brand: string | null; category: string | null; description: string | null }
): TokenMatch {
  const haystack = [product.name, product.brand ?? '', product.category ?? '', product.description ?? '']
    .join(' ')
    .toLowerCase();
  const nameLower = product.name.toLowerCase();
  const matchedTerms: string[] = [];
  const nameMatchedTerms: string[] = [];
  for (const token of tokens) {
    if (tokenMatchesText(haystack, token)) {
      matchedTerms.push(token);
      if (tokenMatchesText(nameLower, token)) nameMatchedTerms.push(token);
      continue;
    }
    // Section 16, #37 — typo-tolerant fallback: the token still
    // matches when it is within a small edit distance of a catalog
    // word in the same text. "macbok" matches the "macbook" in a
    // product name even when the zero-result retry never ran.
    const words = haystack.split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.some((w) => tokenMatchesWordFuzzy(token, w))) continue;
    matchedTerms.push(token);
    if (nameLower.split(/[^a-z0-9]+/).filter(Boolean).some((w) => tokenMatchesWordFuzzy(token, w))) {
      nameMatchedTerms.push(token);
    }
  }
  return { matchedTerms, nameMatchedTerms };
}

/** Sort keys the ai-search API accepts (same values as the search
 *  page's sort control, so the two can never drift apart silently). */
export type AISearchSortKey =
  | 'relevance'
  | 'price-asc'
  | 'price-desc'
  | 'match-desc'
  | 'deal-score'
  | 'rating-desc'
  | 'discount-desc';

export const AI_SEARCH_SORT_KEYS: AISearchSortKey[] = [
  'relevance',
  'price-asc',
  'price-desc',
  'match-desc',
  'deal-score',
  'rating-desc',
  'discount-desc',
];

/**
 * Candidate cap for one aiSearch call. The DB query fetches the
 * token-matched set unsliced (pagination happens after the
 * enrichment filters below), so the cap bounds that set — 200 is
 * far above the 10-product catalog today, and a larger catalog
 * still narrows through the token/category/brand match first.
 */
export const MAX_SEARCH_CANDIDATES = 200;

/** Price-band test shared by the band filter (same bands as the
 *  search page's facet: under $100 / $100–$500 / over $500). */
export function inSearchPriceBand(
  price: number,
  band: 'all' | 'under-100' | '100-500' | '500-plus'
): boolean {
  if (band === 'under-100') return price < 100;
  if (band === '100-500') return price >= 100 && price <= 500;
  return price > 500;
}

/**
 * Split an "X vs Y" compare query (B10). "compare" / "please
 * compare" leading the first side is stripped; a missing side (or
 * no `vs` / `versus` at all) returns null.
 */
export function parseCompareQuery(query: string): { first: string; second: string } | null {
  const parts = query.split(/\s+vs\.?\s+|\s+versus\s+/i);
  if (parts.length !== 2) return null;
  const first = parts[0].replace(/^(please\s+)?compare\s+/i, '').trim().replace(/\?+$/, '');
  const second = parts[1].trim().replace(/\?+$/, '');
  if (!first || !second) return null;
  return { first, second };
}

export interface CompareCandidate {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
}

const COMPARE_GENERIC_TOKENS = new Set([
  'air', 'pro', 'ultra', 'max', 'plus', 'mini', 'the', 'and', 'vs', 'versus', 'compare',
  'best', 'cheapest', 'cheaper', 'which', 'one', 'for', 'most', 'buyers', 'between',
]);

/**
 * Resolve both sides of a compare query against catalog rows, by
 * distinctive name/brand token coverage (same rule as the chat
 * compare matcher in services/personal-assistant.ts). Returns the
 * two rows in query order, or [] when either side cannot be
 * resolved — the caller then falls back to a normal search.
 * Names are short and known (MacBook Air 13, Dell XPS 13, …), so a
 * token-coverage match is deterministic; live-catalog verification
 * is still pending (see report).
 */
export function resolveComparePair<T extends CompareCandidate>(
  rows: T[],
  compareQuery: { first: string; second: string }
): T[] {
  const resolveSide = (side: string): T | null => {
    const lower = side.toLowerCase();
    let best: { row: T; score: number } | null = null;
    for (const row of rows) {
      const tokens = new Set<string>();
      for (const part of row.name.toLowerCase().split(/[^a-z0-9]+/)) {
        if (part.length >= 3 || /\d/.test(part)) tokens.add(part);
      }
      if (row.brand) tokens.add(row.brand.toLowerCase());
      let score = 0;
      for (const token of tokens) {
        if (COMPARE_GENERIC_TOKENS.has(token)) continue;
        if (new RegExp(`\\b${escapeRegExp(token)}\\b`).test(lower)) score += 1;
      }
      if (score > 0 && (!best || score > best.score)) best = { row, score };
    }
    return best?.row ?? null;
  };
  const first = resolveSide(compareQuery.first);
  const second = resolveSide(compareQuery.second);
  if (!first || !second || first.id === second.id) return [];
  return [first, second];
}

// ---------------------------------------------------------------------------
// Intent parsing
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  laptop: ['laptop', 'notebook', 'ultrabook', 'macbook'],
  phone: ['phone', 'smartphone', 'iphone', 'android', 'samsung galaxy'],
  camera: ['camera', 'dslr', 'mirrorless', 'camcorder', 'gopro'],
  watch: ['watch', 'smartwatch', 'apple watch', 'garmin', 'fitbit'],
  headphones: ['headphones', 'earbuds', 'airpods', 'headset'],
  tablet: ['tablet', 'ipad', 'kindle'],
  tv: ['tv', 'television', 'oled', 'qled', 'smart tv'],
  gaming: ['gaming', 'xbox', 'playstation', 'ps5', 'nintendo', 'switch'],
  keyboard: ['keyboard', 'mechanical keyboard'],
  mouse: ['mouse', 'gaming mouse'],
  monitor: ['monitor', 'display', 'screen'],
  speaker: ['speaker', 'bluetooth speaker', 'soundbar'],
};

// Budget parsing is delegated to services/currency.ts
// (parseBudgetFromQuery). The old regexes here captured only the
// digits and assumed USD, which is exactly how "under 20K PKR"
// became a $20,000 budget: "20K" was read as 20 (the K was
// dropped) and "20000 pkr" was read as $20,000 (the PKR was
// ignored). See currency.ts for the interpretation rules — there
// is no LLM system prompt in this codebase, this deterministic
// parser IS the query-understanding layer, so the rules are
// enforced in code there, not in prompt text.

const INTENT_KEYWORDS = [
  'best', 'top', 'cheap', 'budget', 'affordable', 'premium', 'professional',
  'for beginners', 'for gaming', 'for youtube', 'for students', 'for work',
  'for travel', 'for photography', 'for streaming',
];

export function parseSearchIntent(query: string): ParsedSearchIntent {
  // B8: Roman Urdu aliases first — the replacements feed the same
  // intent detection the English words use below.
  let lower = query.toLowerCase();
  for (const [pattern, replacement] of ROMAN_URDU_INTENT_ALIASES) {
    lower = lower.replace(pattern, replacement);
  }

  let category: string | null = null;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      category = cat;
      break;
    }
  }

  // B3: a price band is checked BEFORE the single-budget parser —
  // the symbol-first budget pattern would otherwise read the
  // band's lower end as the whole (max) budget. When a band is
  // present, `budget` is its max end and `budgetMin` its min end.
  const band = parsePriceBandFromQuery(query);
  const parsedBudget = band ? null : parseBudgetFromQuery(query);
  const budget = band ? band.budgetMaxUsd : (parsedBudget?.budgetUsd ?? null);
  const budgetMin = band ? band.budgetMinUsd : null;
  const budgetCurrency = band
    ? band.budgetCurrency
    : (parsedBudget?.budgetCurrency ?? null);
  const budgetOriginal = band
    ? band.budgetOriginalMax
    : (parsedBudget?.budgetOriginal ?? null);

  const knownBrands = KNOWN_BRANDS;
  const brands: string[] = [];
  for (const brand of knownBrands) {
    if (lower.includes(brand)) {
      brands.push(brand.charAt(0).toUpperCase() + brand.slice(1));
    }
  }

  // B2: negations — a negated brand is removed from the positive
  // brands above, and negated attribute keywords never become
  // positive attributes below.
  const { excludedBrands, excludedTerms } = parseNegations(lower);
  const excludedBrandSet = new Set(excludedBrands.map((b) => b.toLowerCase()));
  const positiveBrands = brands.filter((b) => !excludedBrandSet.has(b.toLowerCase()));
  const excludedTermSet = new Set(excludedTerms);

  // B7: attributes from the extended keyword map — matched against
  // the query text here; aiSearch matches the same map against
  // name + description text per product. A keyword that was
  // negated ("without OLED") is not a positive attribute.
  const attributes: Record<string, string> = {};
  for (const [key, keywords] of Object.entries(ATTRIBUTE_KEYWORDS)) {
    if (keywords.some((kw) => !excludedTermSet.has(kw) && textContainsKeyword(lower, kw))) {
      attributes[key] = ATTRIBUTE_VALUES[key];
    }
  }

  let intent = 'general';
  for (const keyword of INTENT_KEYWORDS) {
    // Word-boundary match, not includes(): a bare includes() made
    // every "laptop" query intent 'top' ("lapTOP" contains "top"),
    // which also broke the Roman Urdu aliases (B8) — "sasta
    // laptop" came out 'top' instead of 'cheap'. Multi-word
    // keywords ("for gaming") match by inclusion, single words by
    // boundary — see textContainsKeyword.
    if (textContainsKeyword(lower, keyword)) {
      intent = keyword;
      break;
    }
  }

  return {
    category,
    budget,
    budgetMin,
    budgetCurrency,
    budgetOriginal,
    brands: positiveBrands,
    excludedBrands,
    excludedTerms,
    attributes,
    intent,
    compareQuery: parseCompareQuery(query),
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface AISearchOptions {
  query: string;
  filters?: SearchFilters;
  page?: number;
  pageSize?: number;
  userId?: string;
  /**
   * Server-side sort (Section 14, Chunk 4 — B1). The page used to
   * sort one fetched page in memory, so page 1 of "price: low to
   * high" was the cheapest of an arbitrary first page, not the
   * cheapest matches. Defaults to 'relevance' (score desc).
   */
  sort?: AISearchSortKey;
}

export interface AISearchResults {
  results: AISearchResult[];
  parsedIntent: ParsedSearchIntent;
  total: number;
  page: number;
  pageSize: number;
  /**
   * The two products an "X vs Y" query resolved to (id/name/slug),
   * for the search page's "Compare these two" CTA. Empty/absent
   * when the query carried no `vs`, or when either side could not
   * be resolved to a catalog product.
   */
  compareProducts?: Array<{ id: string; name: string; slug: string }>;
  /**
   * A Levenshtein-corrected spelling of the query (Section 15,
   * B10), or null when no correction exists. Set in two cases:
   * (a) the zero-result fuzzy fallback ran — the returned results
   * are for the CORRECTED query (fuzzyCorrected true), so the
   * page must say so; (b) the search returned few results
   * (< FEW_SEARCH_RESULTS) and a correction exists — the page
   * offers it as "Did you mean: …?" instead of staying silent.
   * Never an auto-redirect: the page only offers the link.
   */
  didYouMean?: string | null;
  /** True when `results` are for didYouMean, not the typed query. */
  fuzzyCorrected?: boolean;
}

/**
 * Correct the query's typos against the live catalog's own words
 * (Section 15, B10 — the fuzzy fallback's correction step).
 * Fetches names/brands/categories (one bounded query, same
 * exclusion as the search itself) and runs the Levenshtein
 * did-you-mean over them. Returns the corrected query, or null
 * when nothing needs correcting or the catalog is empty. Pure
 * except for the one catalog read; never throws.
 */
export async function suggestFuzzyCorrection(
  supabase: AnySupabaseClient,
  query: string,
  intent: ParsedSearchIntent
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('products')
      .select('name, brand, category')
      .is('deleted_at', null)
      .neq('slug', 'sample-laptop')
      .limit(MAX_SEARCH_CANDIDATES);
    const rows = (data ?? []) as Array<{
      name: string;
      brand: string | null;
      category: string | null;
    }>;
    if (rows.length === 0) return null;
    const catalog: SearchCatalogTokens = {
      names: rows.map((r) => r.name),
      brands: rows.map((r) => r.brand ?? '').filter(Boolean),
      categories: rows.map((r) => r.category ?? '').filter(Boolean),
    };
    // An unresolved "X vs Y" query corrects its first side — the
    // side the main search actually ran with.
    const source = intent.compareQuery ? intent.compareQuery.first : query;
    return suggestSearchCorrection(source, catalog);
  } catch {
    return null;
  }
}

export async function aiSearch(
  supabase: AnySupabaseClient,
  options: AISearchOptions
): Promise<AISearchResults> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
  const sort: AISearchSortKey = options.sort ?? 'relevance';

  const parsedIntent = parseSearchIntent(options.query);

  try {
    // B10: resolve an "X vs Y" query BEFORE the text search. When
    // both sides resolve to catalog products, those two rows ARE
    // the result set — the normal text search (which ilike-matches
    // the whole "X vs Y" string and returns ~nothing) never runs.
    // When either side cannot be resolved, the search below falls
    // back to the first side (see searchTerms) and compareProducts
    // stays empty, so no CTA renders.
    let compareProducts: Array<{ id: string; name: string; slug: string }> = [];
    let presetRows: Array<Record<string, unknown>> | null = null;
    if (parsedIntent.compareQuery) {
      try {
        const { data: catalogRows } = await supabase
          .from('products')
          .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at')
          .is('deleted_at', null)
          .neq('slug', 'sample-laptop')
          // Section 17, Stage C item 15: a pending product is not
          // a compare candidate. On 42703 (migration 045
          // unapplied) this select errors, data is null, and the
          // pair stays empty — the normal search below (which
          // retries without the filter) is the designed fallback.
          .eq('status', PUBLISHED_PRODUCT_STATUS)
          .order('confidence_score', { ascending: false })
          .limit(50);
        const pair = resolveComparePair(
          (catalogRows ?? []) as unknown as Array<CompareCandidate & Record<string, unknown>>,
          parsedIntent.compareQuery
        );
        if (pair.length === 2) {
          presetRows = pair as unknown as Array<Record<string, unknown>>;
          compareProducts = pair.map((p) => ({ id: p.id, name: p.name, slug: p.slug }));
        }
      } catch {
        // Resolution failure falls through to the normal search.
      }
    }

    // B1 (Section 14, Chunk 4) — tokenized matching. The old code
    // ilike-matched the WHOLE stripped query as one phrase, so
    // "apple laptop" only matched a field containing that exact
    // phrase (almost never) and multi-word searches returned ~0
    // unless a category/brand filter rescued them. Tokens are now
    // matched OR-style — any token in name/brand/category/
    // description qualifies a product — and ranked by coverage (see
    // computeTokenMatches + the score below). OR, not AND: AND
    // would regress queries whose words are split across fields the
    // descriptions never carry ("noise cancelling headphones" — the
    // descriptions carry no "noise"), because the category filter
    // could no longer rescue them. A compare query that could not
    // be resolved to two catalog products falls back to searching
    // its first side, not the whole "X vs Y" string.
    const compareQuery = parsedIntent.compareQuery;
    let tokens = compareQuery
      ? tokenizeSearchTerms(compareQuery.first, parsedIntent)
      : tokenizeSearchTerms(options.query, parsedIntent);
    // Section 16, #37 — synonym expansion: the expanded tokens
    // drive the candidate query AND the coverage score, so
    // "notebook" finds laptops. The original token stays first in
    // the list, so matchedTerms still credits the typed word when
    // it matches, and the expanded word when only it does.
    tokens = expandSearchTokens(tokens);

    const budget = options.filters?.budgetMax ?? parsedIntent.budget;
    // B3: the band's lower end is a hard filter too (priced
    // products below it are dropped; unpriced products are kept,
    // the same convention as the max-budget filter below).
    const budgetMin = options.filters?.budgetMin ?? parsedIntent.budgetMin;

    // The candidate query, as a builder: the fuzzy fallback below
    // (Section 15, B10) re-runs it with corrected tokens, so it
    // is built here rather than inline — same filters both times
    // (only the text tokens change; the parsed category/brand
    // intent still applies). Server-side pagination contract
    // (B1): the DB query fetches the candidate set (capped at
    // MAX_SEARCH_CANDIDATES) WITHOUT a range; every filter that
    // needs enriched data runs server-side below, and only then
    // is the requested page sliced out — so `total` is the
    // filtered count and page / pageSize / total agree.
    const buildCandidateQuery = (matchTokens: string[], withStatus = true) => {
      let candidateQuery = supabase
        .from('products')
        .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at', {
          count: 'exact',
        })
        .is('deleted_at', null)
        // Exclude the database health-check row ('sample-laptop') —
        // same exclusion as services/products.ts getProducts. Without
        // it, search still surfaced the row even though the public
        // products API and /brands + /categories pages exclude it.
        // The row itself stays in the live database for health
        // checks — it is never deleted here.
        .neq('slug', 'sample-laptop');

      // Section 17, Stage C item 15: public search lists published
      // products only. `withStatus` is false on the 42703 retry
      // (migration 045 unapplied) — see the await site below.
      if (withStatus) {
        candidateQuery = candidateQuery.eq('status', PUBLISHED_PRODUCT_STATUS);
      }

      if (matchTokens.length > 0) {
        const tokenOr = matchTokens
          .flatMap((t) => [
            `name.ilike.%${t}%`,
            `description.ilike.%${t}%`,
            `brand.ilike.%${t}%`,
            `category.ilike.%${t}%`,
          ])
          .join(',');
        candidateQuery = candidateQuery.or(tokenOr);
      }

      if (parsedIntent.category) {
        candidateQuery = candidateQuery.ilike('category', `%${parsedIntent.category}%`);
      }

      if (parsedIntent.brands.length > 0) {
        const brandFilter = parsedIntent.brands.map((b) => `brand.ilike.%${b}%`).join(',');
        candidateQuery = candidateQuery.or(brandFilter);
      }

      if (options.filters?.category) {
        candidateQuery = candidateQuery.eq('category', options.filters.category);
      }
      if (options.filters?.brand) {
        candidateQuery = candidateQuery.eq('brand', options.filters.brand);
      }

      return candidateQuery
        .order('confidence_score', { ascending: false })
        .order('view_count', { ascending: false })
        .limit(MAX_SEARCH_CANDIDATES);
    };

    // Section 17, Stage C item 15: retry without the status
    // filter when the live table predates migration 045 (42703) —
    // pre-migration rows were already public. The fuzzy retry
    // below reuses the same flag so it never re-tries a filter
    // the table does not have.
    let statusFilterWorks = true;
    let { data, error } = presetRows
      ? { data: presetRows, error: null }
      : await buildCandidateQuery(tokens, true);
    if (!presetRows && error && (error as { code?: string }).code === '42703') {
      statusFilterWorks = false;
      ({ data, error } = await buildCandidateQuery(tokens, false));
    }

    // Section 15, B10 — fuzzy fallback: the Levenshtein
    // did-you-mean used to exist only for zero results ON THE
    // PAGE, and the search itself never retried, so a typo'd
    // query ("macbok") returned nothing even though the catalog
    // holds the product. When the token search finds nothing, the
    // query is corrected against the catalog's own words and run
    // ONCE more with the corrected tokens. The corrected spelling
    // is returned as didYouMean with fuzzyCorrected=true, so the
    // page can say the results are for the corrected query — it
    // never silently swaps the query. A compare pair that
    // resolved skips this (those two rows ARE the answer). When
    // the retry also finds nothing, didYouMean is still returned
    // so the page can offer it on the empty state.
    let didYouMean: string | null = null;
    let fuzzyCorrected = false;
    if (!presetRows && !error && (data ?? []).length === 0) {
      const corrected = await suggestFuzzyCorrection(supabase, options.query, parsedIntent);
      if (corrected) {
        didYouMean = corrected;
        const correctedTokens = expandSearchTokens(tokenizeSearchTerms(corrected, parsedIntent));
        if (correctedTokens.length > 0 && correctedTokens.join(' ') !== tokens.join(' ')) {
          const retry = await buildCandidateQuery(correctedTokens, statusFilterWorks);
          if (!retry.error && (retry.data ?? []).length > 0) {
            data = retry.data;
            tokens = correctedTokens;
            fuzzyCorrected = true;
          }
        }
      }
    }

    if (error) {
      logger.warn('aiSearch: query failed', { error: error.message });
      return { results: [], parsedIntent, total: 0, page, pageSize };
    }

    const products = (data ?? []) as unknown as Array<Record<string, unknown>>;
    let results: AISearchResult[] = products.map((row) => {
      const product: Product = {
        id: row.id as string,
        name: row.name as string,
        slug: row.slug as string,
        description: row.description as string | null,
        brand: row.brand as string | null,
        category: row.category as string | null,
        imageUrl: row.image_url as string | null,
        gtin: row.gtin as string | null,
        confidenceScore: row.confidence_score as number,
        // Section 20, §12 #82 — populate the verification rollup
        // (same 045 note as ai-deals.ts).
        priceVerificationStatus: normalizePriceVerificationStatus(
          row.price_verification_status
        ),
        dataFreshness: row.data_freshness as string,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      };

      const matchedAttributes: string[] = [];
      if (parsedIntent.category && product.category?.toLowerCase().includes(parsedIntent.category)) {
        matchedAttributes.push('category');
      }
      if (parsedIntent.brands.length > 0 && product.brand && parsedIntent.brands.some((b) => product.brand?.toLowerCase().includes(b.toLowerCase()))) {
        matchedAttributes.push('brand');
      }
      // B7: the parsed attributes were dead data — now each one is
      // matched against this product's name + description text
      // (same keyword map the parser used). A match is a
      // description-keyword match, never a spec match (see the
      // explanation), and it scores the same +15 as category/brand.
      if (Object.keys(parsedIntent.attributes).length > 0) {
        const haystack = [product.name, product.description ?? '', product.brand ?? '', product.category ?? '']
          .join(' ')
          .toLowerCase();
        for (const [key, keywords] of Object.entries(ATTRIBUTE_KEYWORDS)) {
          if (!(key in parsedIntent.attributes)) continue;
          if (keywords.some((kw) => textContainsKeyword(haystack, kw))) {
            matchedAttributes.push(key);
          }
        }
      }
      if (compareProducts.length === 2) matchedAttributes.push('compare');

      // B1: token coverage scores the result (+5 per matched token,
      // +5 more when the token is in the name) and is reported back
      // as matchedTerms, so the card can say which words matched
      // instead of only "matches your search query".
      const { matchedTerms, nameMatchedTerms } = computeTokenMatches(tokens, {
        name: product.name,
        brand: product.brand,
        category: product.category,
        description: product.description,
      });

      const score = Math.min(
        100,
        (product.confidenceScore ?? 50) +
          matchedAttributes.length * 15 +
          matchedTerms.length * 5 +
          nameMatchedTerms.length * 5
      );
      const explanation = buildSearchExplanation(product, parsedIntent, matchedAttributes, matchedTerms);

      return {
        product,
        score,
        matchedAttributes,
        matchedTerms,
        aiExplanation: explanation,
        currentPrice: null,
        discountPercent: null,
        stores: [],
        rating: null,
        ratingCount: 0,
      };
    });

    // B2: exclusion hard filter — a product whose brand was
    // excluded, or whose name/description/brand/category text
    // carries an excluded term, is dropped (not merely demoted).
    // Applied here, before prices are fetched, so excluded rows
    // never cost a price lookup or appear in the total.
    if (parsedIntent.excludedBrands.length > 0 || parsedIntent.excludedTerms.length > 0) {
      const excludedBrandSet = new Set(parsedIntent.excludedBrands.map((b) => b.toLowerCase()));
      results = results.filter((r) => {
        const brandLower = (r.product.brand ?? '').toLowerCase();
        if (brandLower && [...excludedBrandSet].some((b) => brandLower.includes(b))) {
          return false;
        }
        const haystack = [r.product.name, r.product.brand ?? '', r.product.category ?? '', r.product.description ?? '']
          .join(' ')
          .toLowerCase();
        return !parsedIntent.excludedTerms.some((t) => textContainsKeyword(haystack, t.toLowerCase()));
      });
    }

    // Section 16, #37 — zero-coverage filter: the candidate query
    // above is substring ilike (%phone% also matches the
    // "headphones" category), so a candidate can arrive here
    // carrying NONE of the query's tokens — "smartphone" (expanded
    // to "phone") returned the Sony headphones as a second result
    // even though no token matches it by word boundary or fuzzy
    // distance. computeTokenMatches is the word-boundary/fuzzy
    // rule the search actually promises, so when the query
    // produced tokens (and this is not an explicit "X vs Y" pair,
    // whose sides are the answer by name), drop candidates with
    // no matched term. Token-less queries (e.g. "a", which
    // tokenizes to nothing) keep the whole candidate set — there
    // is nothing to match against, and the discount-desc sort
    // relies on that.
    if (presetRows === null && tokens.length > 0) {
      results = results.filter((r) => r.matchedTerms.length > 0);
    }

    // Latest prices for every result (awaited before sorting).
    // Cards need a real price to show, and the budget claim below
    // needs a real price to check against — without this, the
    // explanation claimed "within your budget" for products whose
    // price was never looked up (e.g. a $1,199 flagship shown for
    // a ~$71 PKR budget). A null price means "not listed", never
    // a reason to claim the product is in budget. One batched
    // query (getLatestPrices) instead of one price_history query
    // per result — the old N+1 broke nothing at 10 products, but
    // it scaled with the page, not the catalog.
    const latestPrices = await getLatestPrices(
      supabase,
      results.map((r) => r.product.id)
    );
    const priceChecks = results.map((r) => ({
      result: r,
      price: latestPrices.get(r.product.id) ?? null,
    }));
    // Store + rating enrichment for the search page's filters
    // (store filter, rating filter, rating display). Three queries
    // total for the whole page, not one per result. If any query
    // is denied or empty, the fields stay empty/null — the UI
    // then shows no store/rating for that product instead of
    // inventing one, and the store filter simply cannot match it.
    if (results.length > 0) {
      const resultIds = results.map((r) => r.product.id);
      const [mpRes, reviewsRes] = await Promise.all([
        supabase
          .from('merchant_products')
          .select('product_id, merchant_id, price, compare_at_price')
          .in('product_id', resultIds)
          .is('deleted_at', null)
          .limit(200),
        supabase
          .from('reviews')
          .select('product_id, rating')
          .in('product_id', resultIds)
          .is('deleted_at', null)
          .limit(500),
      ]);
      const mpRows = (mpRes.data ?? []) as Array<{ product_id: string; merchant_id: string; price?: number | string | null; compare_at_price?: number | string | null }>;
      // Section 16, #30 — best recorded discount per product: the
      // largest discountPercent(price, compare_at_price) across its
      // merchant rows. Null when no row carries a compare-at price
      // above its price — never 0% and never synthesized. The
      // recorded rows are the only source; live-DB compare-at
      // values were not re-verified (the seed sets them).
      const discountByProduct = new Map<string, number>();
      for (const row of mpRows) {
        const price = parseFloat(String(row.price ?? ''));
        const compareAt =
          row.compare_at_price === null || row.compare_at_price === undefined
            ? null
            : parseFloat(String(row.compare_at_price));
        const pct = discountPercent(price, compareAt);
        if (pct === null) continue;
        const best = discountByProduct.get(row.product_id);
        if (best === undefined || pct > best) discountByProduct.set(row.product_id, pct);
      }
      const merchantIds = Array.from(new Set(mpRows.map((r) => r.merchant_id).filter(Boolean)));
      let nameById = new Map<string, string>();
      if (merchantIds.length > 0) {
        const { data: merchantRows } = await supabase
          .from('merchants')
          .select('id, name')
          .in('id', merchantIds);
        nameById = new Map(
          ((merchantRows ?? []) as Array<{ id: string; name: string }>).map((m) => [m.id, m.name])
        );
      }
      const storesByProduct = new Map<string, string[]>();
      for (const row of mpRows) {
        const name = nameById.get(row.merchant_id);
        if (!name) continue;
        const list = storesByProduct.get(row.product_id) ?? [];
        if (!list.includes(name)) list.push(name);
        storesByProduct.set(row.product_id, list);
      }
      const ratingSum = new Map<string, number>();
      const ratingCountMap = new Map<string, number>();
      for (const row of (reviewsRes.data ?? []) as Array<{ product_id: string; rating: number | string }>) {
        const rating = parseFloat(String(row.rating));
        if (!Number.isFinite(rating)) continue;
        ratingSum.set(row.product_id, (ratingSum.get(row.product_id) ?? 0) + rating);
        ratingCountMap.set(row.product_id, (ratingCountMap.get(row.product_id) ?? 0) + 1);
      }
      for (const r of results) {
        r.stores = storesByProduct.get(r.product.id) ?? [];
        r.discountPercent = discountByProduct.get(r.product.id) ?? null;
        const count = ratingCountMap.get(r.product.id) ?? 0;
        r.ratingCount = count;
        r.rating = count > 0 ? Math.round(((ratingSum.get(r.product.id) ?? 0) / count) * 10) / 10 : null;
      }
    }

    for (const { result, price } of priceChecks) {
      result.currentPrice = price;
      if (!budget || price === null) continue;
      if (price > budget) {
        // Over-budget items are dropped below, so no explanation
        // note is needed for them here (the old code kept them with
        // a -20 score penalty, which meant a "laptop under $1000"
        // search still showed $1,099+ products — a budget the user
        // can see being ignored).
      } else {
        // 'budget' is only added here, with a verified price — the
        // search page's "In budget" badge therefore only ever
        // appears on products actually at or under budget.
        result.matchedAttributes.push('budget');
        result.aiExplanation = `${result.aiExplanation.replace(/\.$/, '')}, within your ${budgetDisplay(parsedIntent, budget)} budget.`;
      }
    }

    // HARD budget filter (ordinary search, not just AI
    // recommendations): when a budget is known — from the query
    // ("under 20K PKR" -> $71) or the Max Budget panel filter —
    // priced products above it are removed, not merely demoted.
    // Unpriced products are KEPT: their price is unknown, not
    // over budget, and the card says "Price not listed" rather
    // than claiming they are in budget (they get no 'budget'
    // match and no "In budget" badge above).
    //
    // B1 — every post-enrichment filter runs here, BEFORE the page
    // slice, so `total` is the count the visitor can actually page
    // through. The old code set total = the page's length after the
    // budget filter, which under-counted whenever a later page held
    // a match — and the store / rating / price-band facets were
    // client-side only, so they could empty a server page while
    // matches sat on other pages. They are server filters now
    // (SearchFilters.store / minRating / priceBand) and share the
    // same convention: a product with no store / no rating / no
    // price cannot satisfy the filter, except price — an unpriced
    // product passes the budget/band filters (unknown, not over
    // budget), but a store or rating filter needs a real value, so
    // unlisted/unrated products are excluded by those two.
    // The "X vs Y" pair is explicit: no post filter may drop one
    // side of a comparison the visitor asked for by name.
    if (presetRows === null) {
      if (budget) {
        results = results.filter((r) => r.currentPrice === null || r.currentPrice <= budget);
      }
      // B3: the band's lower end, same convention — priced products
      // below it are removed, unpriced products are kept (their price
      // is unknown, not below the band).
      if (budgetMin) {
        results = results.filter((r) => r.currentPrice === null || r.currentPrice >= budgetMin);
      }
      const storeFilter = options.filters?.store?.trim();
      if (storeFilter) {
        results = results.filter((r) => (r.stores ?? []).includes(storeFilter));
      }
      const minRating = options.filters?.minRating;
      if (typeof minRating === 'number' && Number.isFinite(minRating)) {
        results = results.filter(
          (r) => r.rating !== null && r.rating !== undefined && r.rating >= minRating
        );
      }
      const priceBand = options.filters?.priceBand;
      if (priceBand && priceBand !== 'all') {
        results = results.filter(
          (r) =>
            r.currentPrice === null ||
            r.currentPrice === undefined ||
            inSearchPriceBand(r.currentPrice, priceBand)
        );
      }
    }
    const total = results.length;

    // Section 15, B10 — few results: a 1–2 result set for a
    // mistyped query ("samsng galaxy" → the Galaxy phone via the
    // "galaxy" token) is a typo the visitor should be told about,
    // not a success. When the fuzzy fallback did not already run
    // (and the result set is not an explicitly requested "X vs Y"
    // pair), compute the correction and return it as didYouMean
    // so the page can offer it — the results themselves stay the
    // typed query's (no silent re-run; the visitor taps to
    // re-search with the corrected spelling).
    if (presetRows === null && !didYouMean && total > 0 && total < FEW_SEARCH_RESULTS) {
      didYouMean = await suggestFuzzyCorrection(supabase, options.query, parsedIntent);
    }

    // Sort server-side, before the slice — a client-side sort of
    // one page cannot order the whole result set (page 1 of
    // price-asc must be the cheapest matches, not the cheapest of
    // an arbitrary first page). Unpriced / unrated / unscored
    // products always sort last, never first. 'deal-score' fetches
    // the cached prediction per candidate (the same source the
    // product page scores from); a product with no prediction
    // simply has no score.
    if (sort === 'deal-score') {
      const dealScores = new Map<string, number>();
      await Promise.all(
        results.map(async (r) => {
          try {
            const prediction = await predictPriceDrop(supabase, r.product.id);
            // Section 15, B1: a score resting on fewer than
            // DEAL_SCORE_MIN_DATA_POINTS (5) price points is
            // hidden everywhere — including this sort, where an
            // ungated 100/100 would float a 4-point product to
            // the top. No prediction (or too few points) sorts
            // last, never synthesized.
            const score = dealScoreForDisplay(prediction);
            if (score !== null) dealScores.set(r.product.id, score);
          } catch {
            // No prediction — sorts last, never synthesized.
          }
        })
      );
      results.sort(
        (a, b) =>
          (dealScores.get(b.product.id) ?? -1) - (dealScores.get(a.product.id) ?? -1) ||
          b.score - a.score
      );
    } else if (sort === 'price-asc' || sort === 'price-desc') {
      const dir = sort === 'price-asc' ? 1 : -1;
      results.sort((a, b) => {
        const pa = a.currentPrice;
        const pb = b.currentPrice;
        if (pa === null && pb === null) return 0;
        if (pa === null || pa === undefined) return 1;
        if (pb === null || pb === undefined) return -1;
        return (pa - pb) * dir;
      });
    } else if (sort === 'rating-desc') {
      results.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.score - a.score);
    } else if (sort === 'discount-desc') {
      // Section 16, #30 — biggest recorded discount first; no
      // discount (null) sorts last, never first.
      results.sort(
        (a, b) => (b.discountPercent ?? -1) - (a.discountPercent ?? -1) || b.score - a.score
      );
    } else {
      // 'relevance' and 'match-desc' are both score desc — the
      // score already blends confidence, matched attributes and
      // token coverage.
      results.sort((a, b) => b.score - a.score);
    }

    // The page slice, last: page is clamped to the filtered total
    // (a filter change that shrinks the result set never strands
    // the visitor on an empty page 3), and the returned page is
    // the effective one — the route reports it in meta, so the
    // page and the API always agree on page / pageSize / total.
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const effectivePage = Math.min(page, totalPages);
    const pagedResults = results.slice(
      (effectivePage - 1) * pageSize,
      effectivePage * pageSize
    );

    return { results: pagedResults, parsedIntent, total, page: effectivePage, pageSize, compareProducts, didYouMean, fuzzyCorrected };
  } catch (err) {
    logger.error('aiSearch: unexpected error', { error: String(err) });
    return { results: [], parsedIntent, total: 0, page, pageSize };
  }
}

/**
 * How a budget reads in prose. When the user wrote a non-USD
 * currency, show what they wrote, not just the USD conversion:
 * "20,000 PKR (≈ $71 USD)" instead of a bare "$71" (and never the
 * old "$20000" for a PKR query). When an explicit filter overrides
 * the parsed budget, the filter amount (USD) is what applies.
 */
function budgetDisplay(intent: ParsedSearchIntent, effectiveBudget: number): string {
  // B3: a band reads as a range ("$500–$1000"), not just its max end.
  // Both ends are USD conversions (the comparison unit); the page
  // badge shows the original currency when one was written.
  if (
    intent.budget === effectiveBudget &&
    intent.budgetMin !== null &&
    intent.budgetMin !== undefined
  ) {
    return `$${intent.budgetMin}–$${intent.budget}`;
  }
  if (
    intent.budget === effectiveBudget &&
    intent.budgetCurrency &&
    intent.budgetCurrency !== 'USD' &&
    intent.budgetOriginal !== null
  ) {
    return `${formatOriginalAmount(intent.budgetOriginal)} ${intent.budgetCurrency} (≈ $${intent.budget} USD)`;
  }
  return `$${effectiveBudget}`;
}

function buildSearchExplanation(
  product: Product,
  intent: ParsedSearchIntent,
  matched: string[],
  matchedTerms: string[] = []
): string {
  const parts: string[] = [];
  if (matched.includes('category')) parts.push(`matches your ${intent.category} category`);
  if (matched.includes('brand')) parts.push(`from your preferred brand ${product.brand}`);
  // B7: attribute matches are DESCRIPTION-KEYWORD matches (name +
  // description text only — product_attributes has 0 rows), never
  // spec matches; the wording says so.
  const attrLabels = matched
    .filter((m) => m in ATTRIBUTE_LABELS)
    .map((m) => ATTRIBUTE_LABELS[m]);
  if (attrLabels.length > 0) {
    parts.push(`matches description keywords: ${attrLabels.join(', ')}`);
  }
  // B1: which query words the product's text actually carries —
  // the tokenized match, stated plainly (not a spec claim).
  if (matchedTerms.length > 0) {
    parts.push(`matching search terms: ${matchedTerms.join(', ')}`);
  }
  if (matched.includes('compare')) parts.push('one of the two products you asked to compare');
  // B2: state the exclusion, so a filtered result set never looks
  // like the catalog simply lacks the brand/term.
  const excluded = [...intent.excludedBrands, ...intent.excludedTerms];
  if (excluded.length > 0) parts.push(`excluding ${excluded.join(', ')}`);
  // NOTE: no budget claim here on purpose. Whether a product is
  // "within budget" is only known after its latest price is
  // fetched (see the price-check loop above), and claiming it
  // from intent alone produced the false "~$71 budget" line for a
  // flagship phone. The budget phrase is appended there, only
  // when the price is verified.
  if (intent.intent !== 'general') parts.push(`suited for "${intent.intent}"`);
  if (parts.length === 0) parts.push('matches your search query');
  return `This product ${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// Cached search
// ---------------------------------------------------------------------------

export async function getCachedAISearch(
  supabase: AnySupabaseClient,
  options: AISearchOptions
): Promise<AISearchResults> {
  const key = cacheKey('ai-search', options.query, JSON.stringify(options.filters ?? {}), String(options.page ?? 1), String(options.pageSize ?? 20), options.sort ?? 'relevance');
  return swrGet<AISearchResults>(
    key,
    () => aiSearch(supabase, options),
    30_000,
    120_000
  );
}

// ---------------------------------------------------------------------------
// Search history
// ---------------------------------------------------------------------------

export async function recordSearch(
  supabase: AnySupabaseClient,
  userId: string,
  query: string,
  filters: SearchFilters | null,
  resultsCount: number
): Promise<void> {
  try {
    const { error } = await supabase.from('search_history').insert({
      user_id: userId,
      query,
      filters: filters as unknown as Record<string, unknown> | null,
      results_count: resultsCount,
    });
    if (error) logger.warn('recordSearch: insert failed', { error: error.message });
  } catch (err) {
    logger.error('recordSearch: unexpected error', { error: String(err) });
  }
}

export async function getSearchHistory(
  supabase: AnySupabaseClient,
  userId: string,
  limit = 20
): Promise<SearchHistoryEntry[]> {
  try {
    const { data, error } = await supabase
      .from('search_history')
      .select('id, user_id, query, filters, results_count, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(Math.min(100, limit));

    if (error || !data) {
      if (error) logger.warn('getSearchHistory: query failed', { error: error.message });
      return [];
    }

    return data.map((row) => ({
      id: row.id,
      userId: row.user_id,
      query: row.query,
      filters: row.filters as unknown as SearchFilters | null,
      resultsCount: row.results_count,
      createdAt: row.created_at,
    }));
  } catch (err) {
    logger.error('getSearchHistory: unexpected error', { error: String(err) });
    return [];
  }
}

export async function deleteSearchHistoryEntry(
  supabase: AnySupabaseClient,
  userId: string,
  entryId: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('search_history')
      .delete()
      .eq('id', entryId)
      .eq('user_id', userId);

    if (error) {
      logger.warn('deleteSearchHistoryEntry: failed', { error: error.message });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('deleteSearchHistoryEntry: unexpected error', { error: String(err) });
    return false;
  }
}
