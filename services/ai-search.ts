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
  stripBudgetFromQuery,
  formatOriginalAmount,
} from './currency';

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
  const lower = query.toLowerCase();

  let category: string | null = null;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      category = cat;
      break;
    }
  }

  // Normalized budget: `budget` is always USD (converted when the
  // user wrote another currency), and the original amount/currency
  // are kept alongside for the "AI understood" display. Example:
  // "under 20K PKR" -> budget 71, budgetOriginal 20000,
  // budgetCurrency 'PKR' — never 20000 USD.
  const parsedBudget = parseBudgetFromQuery(query);
  const budget = parsedBudget?.budgetUsd ?? null;
  const budgetCurrency = parsedBudget ? parsedBudget.budgetCurrency : null;
  const budgetOriginal = parsedBudget ? parsedBudget.budgetOriginal : null;

  const brands: string[] = [];
  const knownBrands = ['apple', 'samsung', 'sony', 'dell', 'hp', 'lenovo', 'asus', 'acer', 'canon', 'nikon', 'lg', 'google', 'microsoft', 'bose', 'jbl', 'anker', 'razer', 'logitech', 'garmin', 'fitbit', 'xiaomi', 'oneplus'];
  for (const brand of knownBrands) {
    if (lower.includes(brand)) {
      brands.push(brand.charAt(0).toUpperCase() + brand.slice(1));
    }
  }

  const attributes: Record<string, string> = {};
  if (lower.includes('battery life') || lower.includes('long battery')) {
    attributes.battery = 'long';
  }
  if (lower.includes('lightweight') || lower.includes('light weight') || lower.includes('portable')) {
    attributes.weight = 'light';
  }
  if (lower.includes('4k') || lower.includes('ultra hd')) {
    attributes.resolution = '4k';
  }
  if (lower.includes('oled')) {
    attributes.display = 'oled';
  }
  if (lower.includes('waterproof') || lower.includes('water resistant')) {
    attributes.waterproof = 'true';
  }

  let intent = 'general';
  for (const keyword of INTENT_KEYWORDS) {
    if (lower.includes(keyword)) {
      intent = keyword;
      break;
    }
  }

  return { category, budget, budgetCurrency, budgetOriginal, brands, attributes, intent };
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
}

export interface AISearchResults {
  results: AISearchResult[];
  parsedIntent: ParsedSearchIntent;
  total: number;
  page: number;
  pageSize: number;
}

export async function aiSearch(
  supabase: AnySupabaseClient,
  options: AISearchOptions
): Promise<AISearchResults> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const parsedIntent = parseSearchIntent(options.query);

  try {
    let query = supabase
      .from('products')
      .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at', {
        count: 'exact',
      })
      .is('deleted_at', null);

    // Strip the WHOLE budget expression ("under 20K PKR", not just
    // "under 20"), or "K PKR" would leak into the product ilike
    // match and break matching for every currency/K query.
    const searchTerms = stripBudgetFromQuery(options.query)
      .replace(/best\s+/gi, '')
      .replace(/top\s+/gi, '')
      .trim();

    if (searchTerms) {
      query = query.or(`name.ilike.%${searchTerms}%,description.ilike.%${searchTerms}%,brand.ilike.%${searchTerms}%`);
    }

    if (parsedIntent.category) {
      query = query.ilike('category', `%${parsedIntent.category}%`);
    }

    const budget = options.filters?.budgetMax ?? parsedIntent.budget;
    if (parsedIntent.brands.length > 0) {
      const brandFilter = parsedIntent.brands.map((b) => `brand.ilike.%${b}%`).join(',');
      query = query.or(brandFilter);
    }

    if (options.filters?.category) {
      query = query.eq('category', options.filters.category);
    }
    if (options.filters?.brand) {
      query = query.eq('brand', options.filters.brand);
    }

    query = query
      .order('confidence_score', { ascending: false })
      .order('view_count', { ascending: false })
      .range(offset, offset + pageSize - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.warn('aiSearch: query failed', { error: error.message });
      return { results: [], parsedIntent, total: 0, page, pageSize };
    }

    const products = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const results: AISearchResult[] = products.map((row) => {
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

      const score = Math.min(100, (product.confidenceScore ?? 50) + matchedAttributes.length * 15);
      const explanation = buildSearchExplanation(product, parsedIntent, matchedAttributes);

      return { product, score, matchedAttributes, aiExplanation: explanation };
    });

    if (budget) {
      // Await the price checks BEFORE sorting. The old code fired
      // them with `void` and sorted immediately, so the -20 penalty
      // for over-budget products almost never landed before the
      // results were returned — another reason $500+ phones kept
      // ranking above a ~$70 budget. Over-budget items now sink,
      // in-budget items gain the 'budget' matched attribute (which
      // the search page renders as its "In budget" badge).
      const priceChecks = await Promise.all(
        results.map(async (r) => {
          const { data: priceData } = await supabase
            .from('price_history')
            .select('price')
            .eq('product_id', r.product.id)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          const price =
            priceData && typeof (priceData as { price: number | string }).price !== 'undefined'
              ? parseFloat(String((priceData as { price: number | string }).price))
              : null;
          return { result: r, price: Number.isFinite(price) ? (price as number) : null };
        })
      );
      for (const { result, price } of priceChecks) {
        if (price === null) continue;
        if (price > budget) {
          result.score -= 20;
        } else {
          result.matchedAttributes.push('budget');
        }
      }
    }

    results.sort((a, b) => b.score - a.score);

    return { results, parsedIntent, total: count ?? 0, page, pageSize };
  } catch (err) {
    logger.error('aiSearch: unexpected error', { error: String(err) });
    return { results: [], parsedIntent, total: 0, page, pageSize };
  }
}

function buildSearchExplanation(
  product: Product,
  intent: ParsedSearchIntent,
  matched: string[]
): string {
  const parts: string[] = [];
  if (matched.includes('category')) parts.push(`matches your ${intent.category} category`);
  if (matched.includes('brand')) parts.push(`from your preferred brand ${product.brand}`);
  if (intent.budget) {
    // Show the budget the user actually wrote, not just the USD
    // conversion: "20,000 PKR (≈ $71)" instead of a bare "$71"
    // (and never the old "$20000" for a PKR query).
    if (intent.budgetCurrency && intent.budgetCurrency !== 'USD' && intent.budgetOriginal !== null) {
      parts.push(
        `within your ${formatOriginalAmount(intent.budgetOriginal)} ${intent.budgetCurrency} budget (≈ $${intent.budget} USD)`
      );
    } else {
      parts.push(`within your $${intent.budget} budget`);
    }
  }
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
  const key = cacheKey('ai-search', options.query, JSON.stringify(options.filters ?? {}), String(options.page ?? 1), String(options.pageSize ?? 20));
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
