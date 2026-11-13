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
 *   saving (compare_at_price vs price); `dealScoreForDisplay`
 *   (lib/deal-score.ts) is the canonical Deal Score, computed only
 *   when an unexpired `ai_predictions` row exists AND rests on at
 *   least DEAL_SCORE_MIN_DATA_POINTS (5) price points — otherwise
 *   the score is null and no badge is shown (Section 17, Stage E).
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
import { savingsVsBudget, savingsVsCompareAt } from '@/lib/budget-savings';
import { parseNeedByDate, timelineAdvice } from '@/lib/budget-timeline';
import { dealScoreForDisplay } from '@/lib/deal-score';
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
  /**
   * Section 19, Phase 4 (§12 #36) — dollars saved vs the recorded
   * compare-at (was) price, or null when there is no compare-at
   * price. The % alone never said how much money a saving is.
   */
  savingsUsd: number | null;
  /**
   * Section 19, Phase 4 (§12 #36) — budget minus price (positive =
   * money left over, negative = over budget), or null when no
   * budget was given. The hard filter already drops over-budget
   * picks, so this is >= 0 for every pick — it is the "how much of
   * my budget is left" answer, not a second filter.
   */
  savingsVsBudgetUsd: number | null;
  /**
   * Section 19, Phase 4 (§12 #37) — the deadline's effect on this
   * pick: null when no deadline was given, otherwise the honest
   * note (near deadline → waiting is not offered; far deadline →
   * waiting is possible in principle but no drop is predicted).
   */
  timelineNote: string | null;
  /**
   * Section 19, Phase 4 (§12 #37) — false when the deadline is
   * near (<= 14 days): with only 4 recorded price points no drop
   * can be predicted before it, so "wait" is not offered. True
   * when there is no deadline or it is far away.
   */
  waitRecommended: boolean;
  /**
   * Section 19, Phase 4 (§12 #46) — structured spec inputs this
   * pick matched, as "Label: value" strings (e.g. "RAM: 16 GB").
   * Empty when no spec inputs were given.
   */
  specMatches: string[];
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
  /**
   * Section 19, Phase 4 (§12 #37) — "need by" date, YYYY-MM-DD,
   * or null for no deadline. A near deadline changes the output
   * (see `timelineNote` / `waitRecommended` on GuidedPick); an
   * invalid date is ignored by the ranker (the param parsers
   * report it instead).
   */
  needBy?: string | null;
  /**
   * Section 19, Phase 4 (§12 #46) — structured spec inputs, as
   * { specKey: value } (e.g. { ram: '16 GB', storage: '512 GB' }).
   * Keys/values must come from GUIDED_SPEC_OPTIONS for the
   * pick's category — anything else is ignored by the ranker (the
   * param parsers report it instead). Each input is a HARD filter
   * on the product text (see the spec-matching note below).
   */
  specInputs?: Record<string, string>;
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
  /** Section 19, Phase 4 (§12 #37) — "need by" date, YYYY-MM-DD, or null. */
  needBy?: string | null;
  /** Section 19, Phase 4 (§12 #46) — structured spec inputs, e.g. { ram: '16 GB' }. */
  specs?: Record<string, string>;
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

// ---------------------------------------------------------------------------
// Structured spec inputs (Section 19, Phase 4, §12 #46)
// ---------------------------------------------------------------------------

/**
 * Structured spec choices per category (keyed by the normalized
 * category the ranker derives — see `specOptionsForCategory`).
 * These are CHOICES, not free text: a shared link or a form submit
 * can only ever carry a value listed here, so a spec input can
 * never inject an arbitrary filter.
 *
 * HONESTY NOTE (read before extending this list): the catalog has
 * ZERO structured spec rows live — no product carries a recorded
 * RAM, storage, or battery figure. Spec inputs are therefore
 * matched against the product's name / brand / category /
 * description text only (see `specValueMatches`). A product that
 * meets the spec but never mentions it in its description will
 * NOT appear, and the pages say so next to the results
 * (GUIDED_SPEC_DATA_NOTE). Never present a spec match as a
 * verified specification — it is a text match, and the `why` line
 * says "mentions" for exactly that reason.
 */
export interface GuidedSpecOption {
  key: string;
  label: string;
  options: string[];
}

export const GUIDED_SPEC_OPTIONS: Record<string, GuidedSpecOption[]> = {
  laptop: [
    { key: 'ram', label: 'RAM', options: ['8 GB', '16 GB', '32 GB'] },
    { key: 'storage', label: 'Storage', options: ['256 GB', '512 GB', '1 TB'] },
  ],
  phone: [
    { key: 'storage', label: 'Storage', options: ['128 GB', '256 GB', '512 GB'] },
    { key: 'connectivity', label: 'Connectivity', options: ['5G'] },
  ],
  headphones: [
    { key: 'noiseCancelling', label: 'Noise cancelling', options: ['Noise cancelling'] },
    { key: 'battery', label: 'Battery life', options: ['24 hours'] },
  ],
  camera: [
    { key: 'display', label: 'Video', options: ['4K'] },
  ],
  tv: [
    { key: 'display', label: 'Display', options: ['4K', 'OLED'] },
  ],
  tablet: [
    { key: 'storage', label: 'Storage', options: ['128 GB', '256 GB'] },
  ],
  watch: [
    { key: 'battery', label: 'Battery life', options: ['24 hours', '7 days', '14 days'] },
  ],
};

/** Spec options for a category (normalized the same way the ranker normalizes categories). Returns [] for categories with no spec inputs. */
export function specOptionsForCategory(category: string | null | undefined): GuidedSpecOption[] {
  if (!category) return [];
  const parsed = parseSearchIntent(category).category ?? category.toLowerCase().trim();
  return GUIDED_SPEC_OPTIONS[parsed.toLowerCase()] ?? [];
}

/** The honest caveat shown whenever spec inputs were used. */
export const GUIDED_SPEC_DATA_NOTE =
  'No structured specification data is recorded for products yet — spec choices are matched against product names and descriptions only, so a product that meets your spec but doesn\u2019t mention it in its description won\u2019t appear.';

/** Validate a { key: value } spec map against the options for a category. Returns the valid entries only; unknown keys/values are dropped, never guessed. */
export function validateSpecInputs(
  category: string | null | undefined,
  raw: Record<string, unknown> | null | undefined
): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const options = specOptionsForCategory(category);
  const valid: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const option = options.find((o) => o.key === key);
    if (option && typeof value === 'string' && option.options.includes(value)) {
      valid[key] = value;
    }
  }
  return valid;
}

/**
 * A spec value matches when its space-stripped lowercase form
 * appears in the space-stripped product text — so "16 GB" matches
 * a description saying "16GB RAM", and "Noise cancelling" matches
 * "noise-cancelling headphones". This is a TEXT match (see the
 * honesty note above), never a verified spec.
 */
export function specValueMatches(value: string, haystack: string): boolean {
  const needle = value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (needle.length < 2) return false;
  return haystack.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(needle);
}

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

  // Section 19, Phase 4 (§12 #37/#46) — the deadline and the
  // structured specs. Both are validated here, never trusted:
  // an invalid date yields no timeline advice (the param parsers
  // report it to the user), and spec keys/values outside
  // GUIDED_SPEC_OPTIONS are dropped.
  const needByParsed = parseNeedByDate(input.needBy ?? null);
  const advice = needByParsed.date ? timelineAdvice(needByParsed.date) : null;
  const specInputs = validateSpecInputs(parsedCategory, input.specInputs ?? {});
  const specOptions = specOptionsForCategory(parsedCategory);

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

    // Structured specs are HARD filters, like budget/category/
    // brand: a product whose text never mentions the requested spec
    // is not a pick. (Text match only — see the §12 #46 honesty
    // note on GUIDED_SPEC_OPTIONS; 0 spec rows exist live.)
    const specMatches: string[] = [];
    let specFailed = false;
    for (const [key, value] of Object.entries(specInputs)) {
      if (!specValueMatches(value, haystack)) {
        specFailed = true;
        break;
      }
      const label = specOptions.find((o) => o.key === key)?.label ?? key;
      specMatches.push(`${label}: ${value}`);
    }
    if (specFailed) continue;

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
    // Section 19, Phase 4 (§12 #36) — the saving in dollars, and
    // the money left of the budget, from recorded prices only.
    const vsCompareAtSaving = savingsVsCompareAt(price, c.compareAtUsd);
    const vsBudget = budget !== null ? savingsVsBudget(price, budget) : null;
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
    if (specMatches.length > 0) {
      why.push(`Mentions your specs: ${specMatches.join(', ')}`);
    }
    if (savingPct !== null && c.compareAtUsd !== null) {
      why.push(
        `Save ${savingPct}% vs $${c.compareAtUsd.toFixed(2)}` +
          (vsCompareAtSaving ? ` ($${vsCompareAtSaving.savedUsd.toFixed(2)})` : '')
      );
    }
    if (vsBudget) {
      why.push(`$${vsBudget.remainingUsd.toFixed(2)} left of your $${budget?.toFixed(2)} budget`);
    }
    if (c.dealScore !== null) why.push(`Deal Score ${c.dealScore}/100`);

    picks.push({
      ...c,
      savingPct,
      savingsUsd: vsCompareAtSaving ? vsCompareAtSaving.savedUsd : null,
      savingsVsBudgetUsd: vsBudget ? vsBudget.remainingUsd : null,
      timelineNote: advice ? advice.note : null,
      waitRecommended: advice ? advice.waitOffered : true,
      specMatches,
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

  // Section 19, Phase 4 (§12 #37/#46) — same deadline + spec
  // handling as the exact pass; specs stay HARD here (only
  // must-haves relax).
  const needByParsed = parseNeedByDate(input.needBy ?? null);
  const advice = needByParsed.date ? timelineAdvice(needByParsed.date) : null;
  const specInputs = validateSpecInputs(parsedCategory, input.specInputs ?? {});
  const specOptions = specOptionsForCategory(parsedCategory);

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
    const specMatches: string[] = [];
    let specFailed = false;
    for (const [key, value] of Object.entries(specInputs)) {
      if (!specValueMatches(value, haystack)) {
        specFailed = true;
        break;
      }
      const label = specOptions.find((o) => o.key === key)?.label ?? key;
      specMatches.push(`${label}: ${value}`);
    }
    if (specFailed) continue;
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
    // Section 19, Phase 4 (§12 #36/#37/#46) — same new fields as
    // the exact pass: dollar savings, deadline note, spec matches.
    // Specs stay HARD here too (only must-haves relax).
    const vsCompareAtSaving = savingsVsCompareAt(price, c.compareAtUsd);
    const vsBudget = budget !== null ? savingsVsBudget(price, budget) : null;
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
    if (specMatches.length > 0) {
      why.push(`Mentions your specs: ${specMatches.join(', ')}`);
    }
    if (savingPct !== null && c.compareAtUsd !== null) {
      why.push(
        `Save ${savingPct}% vs $${c.compareAtUsd.toFixed(2)}` +
          (vsCompareAtSaving ? ` ($${vsCompareAtSaving.savedUsd.toFixed(2)})` : '')
      );
    }
    if (vsBudget) {
      why.push(`$${vsBudget.remainingUsd.toFixed(2)} left of your $${budget?.toFixed(2)} budget`);
    }
    if (c.dealScore !== null) why.push(`Deal Score ${c.dealScore}/100`);

    picks.push({
      ...c,
      savingPct,
      savingsUsd: vsCompareAtSaving ? vsCompareAtSaving.savedUsd : null,
      savingsVsBudgetUsd: vsBudget ? vsBudget.remainingUsd : null,
      timelineNote: advice ? advice.note : null,
      waitRecommended: advice ? advice.waitOffered : true,
      specMatches,
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
      // Section 19, Phase 4 (§12 #37/#46) — omitted when unset, so
      // old links (without them) still decode.
      ...(answers.needBy ? { needBy: answers.needBy } : {}),
      ...(answers.specs && Object.keys(answers.specs).length > 0 ? { specs: answers.specs } : {}),
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
    // Section 19, Phase 4 (§12 #37/#46) — optional on old links.
    // An invalid date or an unknown spec key/value rejects the
    // whole link, same as an unknown use-case/brand/must-have.
    const needBy = obj.needBy;
    if (needBy !== undefined && needBy !== null) {
      if (typeof needBy !== 'string' || parseNeedByDate(needBy).error !== null) {
        return null;
      }
    }
    const specs = obj.specs;
    if (specs !== undefined && specs !== null) {
      if (typeof specs !== 'object' || Array.isArray(specs)) return null;
      const intent = parseSearchIntent(useCase);
      const valid = validateSpecInputs(intent.category, specs as Record<string, unknown>);
      if (Object.keys(valid).length !== Object.keys(specs as Record<string, unknown>).length) {
        return null;
      }
    }
    return {
      useCase,
      budgetUsd: budgetUsd as number | null,
      brand: brand as string | null,
      mustHaves: mustHaves as string[],
      // Omitted when unset, so links written before §12 #37/#46
      // decode to exactly the old shape.
      ...(needBy ? { needBy: needBy as string } : {}),
      ...(specs && Object.keys(specs as Record<string, unknown>).length > 0
        ? { specs: specs as Record<string, string> }
        : {}),
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
    needBy: answers.needBy ?? null,
    specInputs: answers.specs ?? {},
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
  needBy?: string | string[];
  [key: string]: string | string[] | undefined;
}): {
  category: string | null;
  budgetUsd: number | null;
  /** Amount exactly as written, before conversion (e.g. 20000 for "20K PKR"). */
  budgetOriginal: number | null;
  /** Currency written (or 'USD' for a bare number); null when no budget was given. */
  budgetCurrency: string | null;
  budgetError: string | null;
  /**
   * Section 19, Phase 4 (§12 #37) — the "need by" date, YYYY-MM-DD,
   * or null when not given. An invalid date is an error, not
   * silently treated as "no deadline".
   */
  needBy: string | null;
  needByError: string | null;
  /**
   * Section 19, Phase 4 (§12 #46) — structured spec inputs from
   * `spec_<key>` params, validated against GUIDED_SPEC_OPTIONS
   * for the chosen category (unknown keys/values dropped).
   */
  specInputs: Record<string, string>;
} {
  const rawCategory = Array.isArray(searchParams.category)
    ? searchParams.category[0]
    : searchParams.category;
  const rawBudget = Array.isArray(searchParams.budget)
    ? searchParams.budget[0]
    : searchParams.budget;
  const rawNeedBy = Array.isArray(searchParams.needBy)
    ? searchParams.needBy[0]
    : searchParams.needBy;
  const category = rawCategory && rawCategory.trim().length > 0 ? rawCategory.trim() : null;
  // Section 19, Phase 4 (§12 #37/#46) — validated once, shared by
  // the page and the API route.
  const needByCheck = parseNeedByDate(rawNeedBy ?? null);
  const needBy = needByCheck.date ? needByCheck.date.toISOString().slice(0, 10) : null;
  const needByError = needByCheck.error;
  const specRaw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (!key.startsWith('spec_')) continue;
    const specKey = key.slice('spec_'.length);
    if (specKey.length === 0) continue;
    specRaw[specKey] = Array.isArray(value) ? value[0] : value;
  }
  const specInputs = validateSpecInputs(category, specRaw);
  if (!rawBudget || rawBudget.trim().length === 0) {
    return { category, budgetUsd: null, budgetOriginal: null, budgetCurrency: null, budgetError: null, needBy, needByError, specInputs };
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
      needBy,
      needByError,
      specInputs,
    };
  }
  // Bare number ("1000") — parseBudgetFromQuery only fires on a
  // keyword / symbol / currency signal, so plain numbers land here.
  const budgetUsd = Number(trimmed);
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return { category, budgetUsd: null, budgetOriginal: null, budgetCurrency: null, budgetError: `"${rawBudget}" is not a valid budget — enter a positive amount, e.g. 1000 or "20K PKR".`, needBy, needByError, specInputs };
  }
  return { category, budgetUsd, budgetOriginal: budgetUsd, budgetCurrency: 'USD', budgetError: null, needBy, needByError, specInputs };
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
    // default — dealScoreForDisplay returns null without one, and
    // also when the prediction rests on fewer than
    // DEAL_SCORE_MIN_DATA_POINTS (5) price points.
    const ids = enriched.map((p) => p.id);
    const scoreByProduct = new Map<string, number>();
    try {
      const { data } = await supabase
        .from('ai_predictions')
        .select('product_id, discount_probability, confidence_score, price_data_range, created_at')
        .in('product_id', ids)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(200);
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const productId = row.product_id as string;
        if (scoreByProduct.has(productId)) continue;
        // Section 17, Stage E (#5): the point count is read back
        // from the existing ai_predictions.price_data_range jsonb
        // (no migration — same plumbing as
        // services/ai-predictions.ts getCachedPrediction) and the
        // score goes through dealScoreForDisplay, so a prediction
        // resting on fewer than DEAL_SCORE_MIN_DATA_POINTS (5)
        // points — or a pre-B1 row with no count at all — yields
        // null (withheld), never the raw 100/100 the ungated
        // formula returns for the live catalog's 4 points. The
        // formula itself is untouched.
        const range = row.price_data_range as Record<string, unknown> | null;
        const dataPoints =
          range && typeof range.dataPoints === 'number' && Number.isFinite(range.dataPoints)
            ? (range.dataPoints as number)
            : null;
        const score = dealScoreForDisplay({
          discountProbability: parseFloat(String(row.discount_probability)),
          // No recorded low is passed here: the formula's own
          // fallback (+20) applies, exactly as documented in
          // lib/deal-score.ts — not a default score.
          currentPrice: null,
          lowestPrice: null,
          confidenceScore: parseFloat(String(row.confidence_score)),
          dataPoints,
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
