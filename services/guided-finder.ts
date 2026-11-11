/**
 * Guided Shopping Quiz + Budget Finder — ONE shared ranking engine.
 *
 * Both tools answer the same question ("which priced product fits
 * these answers?") so they share this single deterministic helper —
 * there is no second scorer anywhere. No LLM, no new dependency,
 * no invented data.
 *
 * Reuse (not reinvention):
 * - `parseSearchIntent` (services/ai-search.ts) derives the category
 *   (and intent) from the quiz use-case text and from the Budget
 *   Finder `?category=` value, so "laptops" and "laptop" mean the
 *   same thing and unknown words yield no category instead of a
 *   guessed one.
 * - `enrichProducts` (services/personal-assistant.ts) turns catalog
 *   rows into priced candidates: it DROPS the demo/health-check row
 *   ('sample-laptop') and every product with no resolvable merchant
 *   price. Candidates here therefore always carry a verified price.
 * - `getProducts` (services/products.ts) is the catalog read path —
 *   it already excludes 'sample-laptop' in the query. Raw Supabase
 *   product rows are never read here.
 * - `discountPercent` (lib/deal-math.ts) is the merchant-basis
 *   saving (compare_at_price vs price); `computeDealScore`
 *   (lib/deal-score.ts) is the canonical Deal Score, computed only
 *   when an unexpired `ai_predictions` row exists — otherwise the
 *   score is null and no badge is shown.
 *
 * Hard rules:
 * - Budget is a HARD filter: a pick over budget is never returned.
 * - A must-have must match (at least one of its keywords in the
 *   product name / brand / category / description); a product that
 *   misses a must-have is not a pick, never forced in to fill the
 *   list.
 * - Many answer combos honestly return 1–3 picks or NOTHING — an
 *   empty result is the correct answer, rendered as an empty state
 *   by the callers, never padded with an irrelevant product.
 * - Ranking is deterministic: match count, then saving %, then
 *   Deal Score, then lowest price, then slug (tiebreak).
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { discountPercent } from '@/lib/deal-math';
import { computeDealScore } from '@/lib/deal-score';
import { parseSearchIntent } from './ai-search';
import { parseBudgetFromQuery } from './currency';
import { enrichProducts } from './personal-assistant';
import { getProducts } from './products';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One priced, recommendable product. `bestPriceUsd` is null only for
 *  test/foreign input — the server loader only ever returns priced
 *  rows (enrichProducts drops the rest), and the ranker drops nulls. */
/** Slugs that must never be recommended (demo / health-check rows).
 *  Enforced here in the pure ranker AND upstream in enrichProducts /
 *  getProducts — a caller passing raw rows cannot smuggle one
 *  through. */
export const GUIDED_EXCLUDED_SLUGS = ['sample-laptop'] as const;

export interface GuidedCandidate {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  bestPriceUsd: number | null;
  compareAtUsd: number | null;
  merchantName: string | null;
  /** Canonical Deal Score, or null when no unexpired prediction exists. */
  dealScore: number | null;
}

export interface GuidedPick extends GuidedCandidate {
  /** Merchant-basis saving %, or null when there is no compare-at price. */
  savingPct: number | null;
  /** Category + brand + matched must-haves (relevance signal). */
  matchCount: number;
  /** Short factual reasons, one per matched signal — never invented. */
  why: string[];
  /** Short verdict derived only from savingPct / dealScore. */
  verdict: string;
}

export interface GuidedFinderInput {
  /** Raw category text, e.g. "laptop" or "Laptops" — normalized via
   *  parseSearchIntent inside the ranker. */
  category?: string | null;
  /** Hard budget cap in USD, or null for no limit. */
  budgetUsd?: number | null;
  /** Preferred brand, or null for any brand. */
  brand?: string | null;
  /** Must-have phrases, e.g. ["Long battery life"]. */
  mustHaveKeywords?: string[];
  /** 'match' (quiz: relevance first) or 'deal' (budget finder:
   *  biggest saving first). Same function, same filters — only
   *  the sort priority differs. */
  sortBy?: 'match' | 'deal';
  limit?: number;
}

/** The quiz answers, as stored in the shareable `?answers=` URL. */
export interface GuidedAnswers {
  /** Use-case query text, e.g. "laptop for work" (see GUIDED_USE_CASES). */
  useCase: string;
  budgetUsd: number | null;
  brand: string | null;
  mustHaves: string[];
}

// ---------------------------------------------------------------------------
// Quiz option lists (shared by the quiz page and the API route, so a
// shared link can only ever carry a value the form itself offers)
// ---------------------------------------------------------------------------

export const GUIDED_USE_CASES: Array<{ value: string; label: string }> = [
  { value: 'laptop for work', label: 'Work & study — a laptop' },
  { value: 'laptop for gaming', label: 'Gaming — a laptop or console' },
  { value: 'laptop for video editing', label: 'Video editing — a laptop' },
  { value: 'phone for everyday use', label: 'Everyday use — a phone' },
  { value: 'phone for photography', label: 'Photography — a phone' },
  { value: 'headphones for travel', label: 'Travel — headphones' },
  { value: 'camera for photography', label: 'Photography — a camera' },
  { value: 'tv for streaming', label: 'Home cinema — a TV' },
  { value: 'tablet for study', label: 'Study & reading — a tablet' },
  { value: 'watch for fitness', label: 'Fitness — a smartwatch' },
];

export const GUIDED_BUDGETS: Array<{ value: number | null; label: string }> = [
  { value: 100, label: 'Under $100' },
  { value: 250, label: 'Under $250' },
  { value: 500, label: 'Under $500' },
  { value: 1000, label: 'Under $1,000' },
  { value: 2000, label: 'Under $2,000' },
  { value: null, label: 'No limit' },
];

export const GUIDED_BRANDS: string[] = [
  'Apple',
  'Samsung',
  'Sony',
  'Dell',
  'HP',
  'Lenovo',
  'Asus',
  'Canon',
  'Bose',
  'JBL',
  'LG',
  'Google',
  'Microsoft',
];

export const GUIDED_MUST_HAVES: string[] = [
  'Long battery life',
  'Lightweight',
  '4K display',
  'OLED display',
  'Waterproof',
  '5G connectivity',
  'Touchscreen',
  'Noise cancelling',
];

/** Categories offered by the Budget Finder form (raw labels; the
 *  ranker normalizes them via parseSearchIntent). */
export const GUIDED_CATEGORIES: string[] = [
  'Laptops',
  'Phones',
  'Headphones',
  'Cameras',
  'TVs',
  'Tablets',
  'Watches',
  'Gaming',
  'Monitors',
  'Speakers',
  'Keyboards',
  'Mouse',
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length >= 2 && !out.includes(token)) out.push(token);
  }
  return out;
}

/** A must-have phrase matches when ANY of its keywords appears in
 *  the product text. ("Long battery life" matches on "battery" —
 *  requiring every word ("long" AND "life") would reject products
 *  whose description simply says "24-hour battery".) */
function mustHaveMatches(phrase: string, haystack: string): string[] {
  const keywords = tokenize(phrase);
  return keywords.filter((k) => haystack.includes(k));
}

/**
 * Short verdict from real numbers only. A product with no saving
 * and no Deal Score is a plain "Priced match" — never a superlative
 * it did not earn.
 */
export function verdictForPick(
  savingPct: number | null,
  dealScore: number | null
): string {
  if (savingPct !== null && savingPct >= 20) return 'Great deal';
  if (savingPct !== null && savingPct >= 10) return 'Good deal';
  if (dealScore !== null && dealScore >= 75) return 'Good time to buy';
  return 'Priced match';
}

/**
 * THE ranking helper — the only scorer for the quiz and the Budget
 * Finder. Pure and deterministic: same candidates + same input =
 * same picks, in the same order.
 *
 * Filters (all hard — a filtered-out product is never a pick):
 * - unpriced products (bestPriceUsd null / <= 0) are dropped;
 * - price above budgetUsd is dropped;
 * - category, when given, must appear in the product category
 *   (normalized through parseSearchIntent, so "Laptops" matches a
 *   "laptop" category and vice versa);
 * - brand, when given, must equal the product brand
 *   (case-insensitive);
 * - every must-have phrase must match the product text.
 */
export function rankGuidedPicks(
  candidates: GuidedCandidate[],
  input: GuidedFinderInput
): GuidedPick[] {
  const sortBy = input.sortBy ?? 'match';
  const limit = Math.max(1, Math.min(50, input.limit ?? 10));
  const budget =
    input.budgetUsd !== null &&
    input.budgetUsd !== undefined &&
    Number.isFinite(input.budgetUsd) &&
    input.budgetUsd > 0
      ? input.budgetUsd
      : null;

  // Normalize the category through the same intent parser the
  // search uses, so free text ("laptops", "Laptop") collapses to
  // one category key instead of exact-string matching.
  const parsedCategory = input.category
    ? (parseSearchIntent(input.category).category ?? input.category.toLowerCase().trim())
    : null;
  const brandNorm = input.brand ? input.brand.toLowerCase().trim() : null;
  const mustHaves = (input.mustHaveKeywords ?? []).filter(
    (m) => typeof m === 'string' && m.trim().length > 0
  );

  const picks: GuidedPick[] = [];

  for (const c of candidates) {
    // Demo / health-check rows are never picks (see above).
    if ((GUIDED_EXCLUDED_SLUGS as readonly string[]).includes(c.slug)) continue;
    // Unpriced or demo rows are never picks. The loader already
    // drops them; this is the defense-in-depth check so a caller
    // passing raw rows cannot smuggle one through.
    if (c.bestPriceUsd === null || !Number.isFinite(c.bestPriceUsd) || c.bestPriceUsd <= 0) continue;
    const price = c.bestPriceUsd as number;
    if (budget !== null && price > budget) continue;

    const productCategory = (c.category ?? '').toLowerCase();
    if (parsedCategory) {
      const cat = parsedCategory.toLowerCase();
      if (!productCategory.includes(cat) && !cat.includes(productCategory) && productCategory.length > 0) {
        // Neither contains the other — but an empty product
        // category cannot match a requested category either.
        continue;
      }
      if (productCategory.length === 0) continue;
    }

    const productBrand = (c.brand ?? '').toLowerCase();
    if (brandNorm && productBrand !== brandNorm) continue;

    const haystack = [c.name, c.brand ?? '', c.category ?? '', c.description ?? '']
      .join(' ')
      .toLowerCase();
    const matchedMustHaves: string[] = [];
    let mustHaveFailed = false;
    for (const phrase of mustHaves) {
      const matched = mustHaveMatches(phrase, haystack);
      if (matched.length === 0) {
        mustHaveFailed = true;
        break;
      }
      matchedMustHaves.push(...matched);
    }
    if (mustHaveFailed) continue;

    const savingPct = discountPercent(price, c.compareAtUsd);
    const why: string[] = [];
    if (budget !== null) {
      why.push(`$${price.toFixed(2)} — within your $${budget.toFixed(2)} budget`);
    } else {
      why.push(`Priced at $${price.toFixed(2)}${c.merchantName ? ` at ${c.merchantName}` : ''}`);
    }
    if (parsedCategory && productCategory.includes(parsedCategory.toLowerCase())) {
      why.push(`Matches your ${parsedCategory} category`);
    }
    if (brandNorm && c.brand) why.push(`From your preferred brand ${c.brand}`);
    if (matchedMustHaves.length > 0) {
      why.push(`Matches your must-haves: ${Array.from(new Set(matchedMustHaves)).join(', ')}`);
    }
    if (savingPct !== null && c.compareAtUsd !== null) {
      why.push(`Save ${savingPct}% vs $${c.compareAtUsd.toFixed(2)}`);
    }
    if (c.dealScore !== null) why.push(`Deal Score ${c.dealScore}/100`);

    picks.push({
      ...c,
      savingPct,
      matchCount:
        (parsedCategory ? 1 : 0) + (brandNorm ? 1 : 0) + matchedMustHaves.length,
      why,
      verdict: verdictForPick(savingPct, c.dealScore),
    });
  }

  picks.sort((a, b) => {
    if (sortBy === 'deal') {
      const sa = a.savingPct ?? -1;
      const sb = b.savingPct ?? -1;
      if (sb !== sa) return sb - sa;
      const da = a.dealScore ?? -1;
      const db = b.dealScore ?? -1;
      if (db !== da) return db - da;
    } else {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      const sa = a.savingPct ?? -1;
      const sb = b.savingPct ?? -1;
      if (sb !== sa) return sb - sa;
      const da = a.dealScore ?? -1;
      const db = b.dealScore ?? -1;
      if (db !== da) return db - da;
    }
    const pa = a.bestPriceUsd as number;
    const pb = b.bestPriceUsd as number;
    if (pa !== pb) return pa - pb;
    return a.slug.localeCompare(b.slug);
  });

  return picks.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Nearest-miss fallback (B1)
// ---------------------------------------------------------------------------

/** An exact pick that failed on must-haves, shown ONLY under the
 *  empty state — never mixed into exact picks. `missedMustHaves`
 *  names every must-have the product failed, so the UI can label
 *  it ("matches 2 of 3 must-haves — misses: Waterproof"). */
export interface GuidedRelaxedPick extends GuidedPick {
  missedMustHaves: string[];
  matchedMustHaveCount: number;
  totalMustHaves: number;
}

/**
 * Relaxed pass over the same candidates: budget, category and
 * brand stay HARD (a pick over budget is never a "closest match"
 * either), but the must-have rule relaxes from "every must-have"
 * to "at least one must-have, most matched first". A product
 * matching NONE of the must-haves is not a closest match — it is
 * just an unrelated product, so it is dropped. With no must-haves
 * at all there is nothing to relax, so this returns [] (the exact
 * pass already covers that case).
 *
 * Sorted by matched must-have count, then saving %, then Deal
 * Score, then lowest price, then slug — the same tiebreaks as
 * rankGuidedPicks, so the two lists never disagree about which
 * of two products is "closer".
 */
export function rankRelaxedGuidedPicks(
  candidates: GuidedCandidate[],
  input: GuidedFinderInput,
  limit = 3
): GuidedRelaxedPick[] {
  const mustHaves = (input.mustHaveKeywords ?? []).filter(
    (m) => typeof m === 'string' && m.trim().length > 0
  );
  if (mustHaves.length === 0) return [];

  const sortBy = input.sortBy ?? 'match';
  const cappedLimit = Math.max(1, Math.min(10, limit));
  const budget =
    input.budgetUsd !== null &&
    input.budgetUsd !== undefined &&
    Number.isFinite(input.budgetUsd) &&
    input.budgetUsd > 0
      ? input.budgetUsd
      : null;
  const parsedCategory = input.category
    ? (parseSearchIntent(input.category).category ?? input.category.toLowerCase().trim())
    : null;
  const brandNorm = input.brand ? input.brand.toLowerCase().trim() : null;

  const picks: GuidedRelaxedPick[] = [];

  for (const c of candidates) {
    if ((GUIDED_EXCLUDED_SLUGS as readonly string[]).includes(c.slug)) continue;
    if (c.bestPriceUsd === null || !Number.isFinite(c.bestPriceUsd) || c.bestPriceUsd <= 0) continue;
    const price = c.bestPriceUsd as number;
    if (budget !== null && price > budget) continue;

    const productCategory = (c.category ?? '').toLowerCase();
    if (parsedCategory) {
      const cat = parsedCategory.toLowerCase();
      if (productCategory.length === 0) continue;
      if (!productCategory.includes(cat) && !cat.includes(productCategory)) continue;
    }

    const productBrand = (c.brand ?? '').toLowerCase();
    if (brandNorm && productBrand !== brandNorm) continue;

    const haystack = [c.name, c.brand ?? '', c.category ?? '', c.description ?? '']
      .join(' ')
      .toLowerCase();
    const matchedPhrases: string[] = [];
    const missedMustHaves: string[] = [];
    const matchedKeywords: string[] = [];
    for (const phrase of mustHaves) {
      const matched = mustHaveMatches(phrase, haystack);
      if (matched.length === 0) {
        missedMustHaves.push(phrase);
      } else {
        matchedPhrases.push(phrase);
        matchedKeywords.push(...matched);
      }
    }
    // No must-have matched at all — not a closest match.
    if (matchedPhrases.length === 0) continue;

    const savingPct = discountPercent(price, c.compareAtUsd);
    const why: string[] = [];
    if (budget !== null) {
      why.push(`$${price.toFixed(2)} — within your $${budget.toFixed(2)} budget`);
    } else {
      why.push(`Priced at $${price.toFixed(2)}${c.merchantName ? ` at ${c.merchantName}` : ''}`);
    }
    if (parsedCategory && productCategory.includes(parsedCategory.toLowerCase())) {
      why.push(`Matches your ${parsedCategory} category`);
    }
    if (brandNorm && c.brand) why.push(`From your preferred brand ${c.brand}`);
    if (matchedKeywords.length > 0) {
      why.push(
        `Matches ${matchedPhrases.length} of ${mustHaves.length} must-haves: ${Array.from(new Set(matchedKeywords)).join(', ')}`
      );
    }
    if (savingPct !== null && c.compareAtUsd !== null) {
      why.push(`Save ${savingPct}% vs $${c.compareAtUsd.toFixed(2)}`);
    }
    if (c.dealScore !== null) why.push(`Deal Score ${c.dealScore}/100`);

    picks.push({
      ...c,
      savingPct,
      matchCount:
        (parsedCategory ? 1 : 0) + (brandNorm ? 1 : 0) + matchedKeywords.length,
      why,
      verdict: verdictForPick(savingPct, c.dealScore),
      missedMustHaves,
      matchedMustHaveCount: matchedPhrases.length,
      totalMustHaves: mustHaves.length,
    });
  }

  picks.sort((a, b) => {
    if (b.matchedMustHaveCount !== a.matchedMustHaveCount) {
      return b.matchedMustHaveCount - a.matchedMustHaveCount;
    }
    if (sortBy === 'deal') {
      const sa = a.savingPct ?? -1;
      const sb = b.savingPct ?? -1;
      if (sb !== sa) return sb - sa;
      const da = a.dealScore ?? -1;
      const db = b.dealScore ?? -1;
      if (db !== da) return db - da;
    } else {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      const sa = a.savingPct ?? -1;
      const sb = b.savingPct ?? -1;
      if (sb !== sa) return sb - sa;
      const da = a.dealScore ?? -1;
      const db = b.dealScore ?? -1;
      if (db !== da) return db - da;
    }
    const pa = a.bestPriceUsd as number;
    const pb = b.bestPriceUsd as number;
    if (pa !== pb) return pa - pb;
    return a.slug.localeCompare(b.slug);
  });

  return picks.slice(0, cappedLimit);
}

// ---------------------------------------------------------------------------
// Quiz answers <-> shareable URL
// ---------------------------------------------------------------------------

/** Encode answers for `?answers=` — URI-encoded JSON, safe to paste
 *  anywhere. No base64: `encodeURIComponent` works identically in
 *  Node and the browser, so the page and the API route agree. */
export function encodeQuizAnswers(answers: GuidedAnswers): string {
  return encodeURIComponent(
    JSON.stringify({
      useCase: answers.useCase,
      budgetUsd: answers.budgetUsd,
      brand: answers.brand,
      mustHaves: answers.mustHaves,
    })
  );
}

/** Strict decode: anything malformed, wrong-typed, or carrying an
 *  unknown use-case/brand/must-have returns null — a shared link
 *  can never inject an answer the form does not offer. */
export function decodeQuizAnswers(raw: string | null | undefined): GuidedAnswers | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const useCase = obj.useCase;
    if (typeof useCase !== 'string' || !GUIDED_USE_CASES.some((u) => u.value === useCase)) {
      return null;
    }
    const budgetUsd = obj.budgetUsd;
    if (
      budgetUsd !== null &&
      (typeof budgetUsd !== 'number' || !Number.isFinite(budgetUsd) || budgetUsd <= 0)
    ) {
      return null;
    }
    const brand = obj.brand;
    if (brand !== null && (typeof brand !== 'string' || !GUIDED_BRANDS.includes(brand))) {
      return null;
    }
    const mustHaves = obj.mustHaves;
    if (
      !Array.isArray(mustHaves) ||
      mustHaves.some((m) => typeof m !== 'string' || !GUIDED_MUST_HAVES.includes(m))
    ) {
      return null;
    }
    return {
      useCase,
      budgetUsd: budgetUsd as number | null,
      brand: brand as string | null,
      mustHaves: mustHaves as string[],
    };
  } catch {
    return null;
  }
}

/** Turn validated quiz answers into ranker input. The category
 *  comes from parseSearchIntent on the use-case + must-have text —
 *  the quiz never hard-codes a category mapping of its own. */
export function answersToFinderInput(answers: GuidedAnswers): GuidedFinderInput {
  const intent = parseSearchIntent(`${answers.useCase} ${answers.mustHaves.join(' ')}`);
  return {
    category: intent.category,
    budgetUsd: answers.budgetUsd,
    brand: answers.brand,
    mustHaveKeywords: answers.mustHaves,
    sortBy: 'match',
  };
}

/** Validate + normalize the Budget Finder query params
 *  (`?category=...&budget=...`). Returns nulls for anything
 *  missing or unparseable — the page then shows the form instead
 *  of guessing. A non-positive or non-numeric budget is an error,
 *  not silently treated as "no limit".
 *
 *  Multi-currency (B9): the budget is parsed with the same
 *  parseBudgetFromQuery the search box uses, so "20K PKR" is a
 *  ~$71 budget (budgetUsd 71, budgetOriginal 20000, budgetCurrency
 *  'PKR'), not $20,000. A bare number ("1000") stays USD, exactly
 *  as before. `budgetOriginal` / `budgetCurrency` let the page show
 *  the amount the visitor actually wrote. */
export function parseBudgetFinderParams(searchParams: {
  category?: string | string[];
  budget?: string | string[];
}): {
  category: string | null;
  budgetUsd: number | null;
  /** Amount exactly as written, before conversion (e.g. 20000 for "20K PKR"). */
  budgetOriginal: number | null;
  /** Currency written (or 'USD' for a bare number); null when no budget was given. */
  budgetCurrency: string | null;
  budgetError: string | null;
} {
  const rawCategory = Array.isArray(searchParams.category)
    ? searchParams.category[0]
    : searchParams.category;
  const rawBudget = Array.isArray(searchParams.budget)
    ? searchParams.budget[0]
    : searchParams.budget;
  const category = rawCategory && rawCategory.trim().length > 0 ? rawCategory.trim() : null;
  if (!rawBudget || rawBudget.trim().length === 0) {
    return { category, budgetUsd: null, budgetOriginal: null, budgetCurrency: null, budgetError: null };
  }
  const trimmed = rawBudget.trim();
  // Multi-currency first ("20K PKR", "under $500", "€500") — the
  // same parser the search box uses, so the two tools agree.
  const parsed = parseBudgetFromQuery(trimmed);
  if (parsed) {
    return {
      category,
      budgetUsd: parsed.budgetUsd,
      budgetOriginal: parsed.budgetOriginal,
      budgetCurrency: parsed.budgetCurrency,
      budgetError: null,
    };
  }
  // Bare number ("1000") — parseBudgetFromQuery only fires on a
  // keyword / symbol / currency signal, so plain numbers land here.
  const budgetUsd = Number(trimmed);
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return { category, budgetUsd: null, budgetOriginal: null, budgetCurrency: null, budgetError: `"${rawBudget}" is not a valid budget — enter a positive amount, e.g. 1000 or "20K PKR".` };
  }
  return { category, budgetUsd, budgetOriginal: budgetUsd, budgetCurrency: 'USD', budgetError: null };
}

// ---------------------------------------------------------------------------
// Server loader: catalog -> priced candidates (with Deal Scores)
// ---------------------------------------------------------------------------

/**
 * Load every recommendable product as a priced candidate.
 *
 * Read path: getProducts (excludes 'sample-laptop' in the query) →
 * enrichProducts (drops demo slugs + anything with no resolvable
 * merchant price) → latest unexpired ai_predictions row per
 * product → canonical Deal Score. A product with no prediction
 * simply has dealScore null — it is still a candidate, it just
 * carries no score badge.
 *
 * On any DB failure this returns [] — the pages then render their
 * honest empty state instead of erroring or inventing products.
 */
export async function loadGuidedCandidates(
  supabase: AnySupabaseClient
): Promise<GuidedCandidate[]> {
  try {
    const { products } = await getProducts(supabase, { pageSize: 100 });
    if (products.length === 0) return [];

    const enriched = await enrichProducts(
      supabase,
      products.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        brand: p.brand,
        category: p.category,
        image_url: p.imageUrl,
        confidence_score: p.confidenceScore ?? 50,
      }))
    );
    if (enriched.length === 0) return [];

    // Latest unexpired prediction per product (one query). A
    // missing/expired row means "no score", never a synthesized
    // default — computeDealScore returns null without one.
    const ids = enriched.map((p) => p.id);
    const scoreByProduct = new Map<string, number>();
    try {
      const { data } = await supabase
        .from('ai_predictions')
        .select('product_id, discount_probability, confidence_score, created_at')
        .in('product_id', ids)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(200);
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const productId = row.product_id as string;
        if (scoreByProduct.has(productId)) continue;
        const score = computeDealScore({
          discountProbability: parseFloat(String(row.discount_probability)),
          // No recorded low is passed here: the formula's own
          // fallback (+20) applies, exactly as documented in
          // lib/deal-score.ts — not a default score.
          currentPrice: null,
          lowestPrice: null,
          confidenceScore: parseFloat(String(row.confidence_score)),
        });
        if (score !== null) scoreByProduct.set(productId, score);
      }
    } catch {
      // Predictions are enrichment only — a failure here must not
      // take down the priced picks.
    }

    return enriched.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      brand: p.brand,
      category: p.category,
      // enrichProducts carries no description — take it from the
      // getProducts rows so must-have keywords can match it.
      description: products.find((row) => row.id === p.id)?.description ?? null,
      bestPriceUsd: p.price,
      compareAtUsd: p.bestRetailer.compareAt,
      merchantName: p.bestRetailer.name,
      dealScore: scoreByProduct.get(p.id) ?? null,
    }));
  } catch {
    return [];
  }
}
