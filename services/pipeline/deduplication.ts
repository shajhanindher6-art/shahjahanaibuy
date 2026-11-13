/**
 * Deduplication service — prevents duplicate products in the catalog.
 * Strategy: GTIN match (primary) → slug match → normalized
 * name+brand match → fuzzy name match within the same brand
 * (Section 20, #9). The GTIN leg already catches the same GTIN
 * under a different slug; the name legs catch the same product
 * re-ingested with no GTIN at all.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { NormalizedProduct } from './normalization';

export interface DeduplicationResult {
  existingProductId: string | null;
  isDuplicate: boolean;
  matchedBy: 'gtin' | 'slug' | 'name-brand' | 'name-brand-fuzzy' | null;
  /**
   * Section 20, #9: 0–1 similarity behind a fuzzy match (1 for
   * an exact normalized name+brand match). Null for GTIN/slug
   * matches and non-duplicates — those are exact, not scored.
   */
  confidence?: number | null;
}

/** Lower-case, collapse all non-alphanumerics to single spaces. */
export function normalizeDedupeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Token-set Jaccard similarity between two normalized names
 * (0 = no shared token, 1 = identical token sets). Order-free,
 * so "Air 13 MacBook" and "MacBook Air 13" score 1.
 */
export function nameTokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeDedupeText(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeDedupeText(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared++;
  return shared / (tokensA.size + tokensB.size - shared);
}

/**
 * A fuzzy name match needs the same brand (normalized) AND a
 * token similarity at or above this threshold. 0.75 catches
 * rewordings ("MacBook Air 13-inch" vs "MacBook Air 13") while
 * keeping distinct models apart ("MacBook Air 13" vs "MacBook
 * Pro 13" scores 0.5: {macbook, 13} shared of {macbook, air,
 * 13, pro}).
 */
export const NAME_BRAND_FUZZY_THRESHOLD = 0.75;

export async function findDuplicate(
  supabase: AnySupabaseClient,
  normalized: NormalizedProduct
): Promise<DeduplicationResult> {
  if (normalized.gtin) {
    const { data } = await supabase
      .from('products')
      .select('id')
      .eq('gtin', normalized.gtin)
      .maybeSingle();

    if (data?.id) {
      logger.debug('Deduplication: GTIN match', { gtin: normalized.gtin, id: data.id });
      return { existingProductId: data.id, isDuplicate: true, matchedBy: 'gtin', confidence: 1 };
    }
  }

  const { data } = await supabase
    .from('products')
    .select('id')
    .eq('slug', normalized.slug)
    .maybeSingle();

  if (data?.id) {
    logger.debug('Deduplication: slug match', { slug: normalized.slug, id: data.id });
    return { existingProductId: data.id, isDuplicate: true, matchedBy: 'slug', confidence: 1 };
  }

  // Section 20, #9 — name/brand legs. A product re-ingested with
  // no GTIN and a fresh slug used to sail through both legs above.
  // Brand is matched case-insensitively in the query; the name
  // comparison is normalized in code (the DB has no normalized
  // name column). Fail-safe: any query failure degrades to "no
  // match" rather than blocking ingestion — the retroactive
  // sweep (findDuplicateCandidates) is the backstop, and the
  // intake review has its own exact name+brand leg.
  if (normalized.name && normalized.brand) {
    try {
      const { data: brandRows, error } = await supabase
        .from('products')
        .select('id, name, brand')
        .ilike('brand', normalized.brand)
        .limit(50);
      if (!error && brandRows) {
        const wantedName = normalizeDedupeText(normalized.name);
        const wantedBrand = normalizeDedupeText(normalized.brand);
        let best: { id: string; similarity: number } | null = null;
        for (const row of brandRows as Array<{ id: string; name: string; brand: string }>) {
          if (normalizeDedupeText(row.brand ?? '') !== wantedBrand) continue;
          const similarity = nameTokenSimilarity(row.name ?? '', wantedName);
          if (!best || similarity > best.similarity) best = { id: row.id, similarity };
        }
        if (best && best.similarity === 1) {
          logger.debug('Deduplication: name+brand match', { name: normalized.name, id: best.id });
          return {
            existingProductId: best.id,
            isDuplicate: true,
            matchedBy: 'name-brand',
            confidence: 1,
          };
        }
        if (best && best.similarity >= NAME_BRAND_FUZZY_THRESHOLD) {
          logger.debug('Deduplication: fuzzy name+brand match', {
            name: normalized.name,
            id: best.id,
            similarity: best.similarity,
          });
          return {
            existingProductId: best.id,
            isDuplicate: true,
            matchedBy: 'name-brand-fuzzy',
            confidence: best.similarity,
          };
        }
      }
    } catch (err) {
      logger.warn('Deduplication: name/brand check failed, continuing as no match', {
        error: String(err),
      });
    }
  }

  return { existingProductId: null, isDuplicate: false, matchedBy: null, confidence: null };
}

export async function resolveUniqueSlug(
  supabase: AnySupabaseClient,
  baseSlug: string
): Promise<string> {
  const { data } = await supabase
    .from('products')
    .select('slug')
    .ilike('slug', `${baseSlug}%`)
    .limit(20);

  if (!data || data.length === 0) return baseSlug;
  const existing = new Set(data.map((r) => r.slug));
  if (!existing.has(baseSlug)) return baseSlug;
  let counter = 2;
  while (existing.has(`${baseSlug}-${counter}`)) counter++;
  return `${baseSlug}-${counter}`;
}

// ---------------------------------------------------------------------------
// Retroactive duplicate sweep (Section 20, #9)
// ---------------------------------------------------------------------------

/**
 * One catalog row as the sweep sees it. Only the identity fields
 * — no prices, no merchant data. `gtin` / `modelNumber` may be
 * null: a product with no GTIN is still comparable by name+brand.
 */
export interface DuplicateSweepProduct {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  gtin?: string | null;
  /** Section 20, #6: recorded model number, when the row has one. */
  modelNumber?: string | null;
}

/**
 * One candidate pair for admin review. The pair is unordered
 * (`product` is the later row in the input order, `duplicateOf`
 * the earlier one) and each unordered pair appears at most once
 * — the strongest leg wins, so a pair matching on both GTIN and
 * name is reported once, as a GTIN match.
 *
 * `confidence` is a 0–1 score, NOT a verdict: 1.0 = exact GTIN
 * or exact normalized name+brand (review to confirm, then merge
 * or keep); 0.75–0.99 = same brand + similar name (token
 * Jaccard, see NAME_BRAND_FUZZY_THRESHOLD). Anything below the
 * threshold is not reported at all. The admin review view (a
 * separate Section 20 item) decides merge vs keep — this
 * function never deletes or merges anything.
 */
export interface DuplicateCandidate {
  productId: string;
  productSlug: string;
  productName: string;
  duplicateOfProductId: string;
  duplicateOfSlug: string;
  duplicateOfName: string;
  /** 'gtin' | 'name-brand' | 'name-brand-fuzzy'. */
  matchedBy: 'gtin' | 'name-brand' | 'name-brand-fuzzy';
  /** 0–1: 1 for exact GTIN / exact name+brand, else the token similarity. */
  confidence: number;
  /** Plain-language reasons, e.g. 'same GTIN 9780123'. */
  reasons: string[];
}

/**
 * Retroactive duplicate sweep over a catalog snapshot. Pure
 * function — reads nothing, writes nothing, never throws on
 * empty input. Runs in O(n²) pairwise comparisons, which is
 * fine for a 10-product catalog and for the few-hundred-row
 * catalogs this section honestly expects; the admin review view
 * calls it with the live product list and renders the returned
 * candidates for a human to confirm.
 *
 * Return shape: `DuplicateCandidate[]`, sorted by confidence
 * descending (exact matches first). `[]` when the catalog has
 * no candidate pair — which is the honest result for the live
 * 10-product catalog today (0 exact duplicates, 0
 * near-duplicate name+brand pairs, audit §2).
 */
export function findDuplicateCandidates(
  products: DuplicateSweepProduct[]
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];
  const seenPair = new Set<string>();

  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      const a = products[i];
      const b = products[j];
      const key = pairKey(a.id, b.id);
      if (seenPair.has(key)) continue;

      const gtinA = a.gtin ? a.gtin.replace(/[^a-z0-9]/gi, '').toUpperCase() : '';
      const gtinB = b.gtin ? b.gtin.replace(/[^a-z0-9]/gi, '').toUpperCase() : '';
      const nameA = normalizeDedupeText(a.name ?? '');
      const nameB = normalizeDedupeText(b.name ?? '');
      const brandA = normalizeDedupeText(a.brand ?? '');
      const brandB = normalizeDedupeText(b.brand ?? '');

      // Strongest leg first: same GTIN = same physical product,
      // whatever the slugs say.
      if (gtinA && gtinA === gtinB) {
        seenPair.add(key);
        candidates.push({
          productId: b.id,
          productSlug: b.slug,
          productName: b.name,
          duplicateOfProductId: a.id,
          duplicateOfSlug: a.slug,
          duplicateOfName: a.name,
          matchedBy: 'gtin',
          confidence: 1,
          reasons: [`same GTIN ${a.gtin}`],
        });
        continue;
      }

      // Same normalized name + same normalized brand.
      if (nameA && nameA === nameB && brandA && brandA === brandB) {
        seenPair.add(key);
        candidates.push({
          productId: b.id,
          productSlug: b.slug,
          productName: b.name,
          duplicateOfProductId: a.id,
          duplicateOfSlug: a.slug,
          duplicateOfName: a.name,
          matchedBy: 'name-brand',
          confidence: 1,
          reasons: [`same name "${a.name}" and brand "${a.brand}"`],
        });
        continue;
      }

      // Fuzzy leg: same brand + similar name. A shared model
      // number strengthens the reason line but never creates a
      // candidate on its own (model numbers can repeat across
      // regional variants — migration 055 deliberately has no
      // UNIQUE on the column).
      if (brandA && brandA === brandB && nameA && nameB) {
        const similarity = nameTokenSimilarity(nameA, nameB);
        if (similarity >= NAME_BRAND_FUZZY_THRESHOLD) {
          seenPair.add(key);
          const modelA = (a.modelNumber ?? '').trim();
          const modelB = (b.modelNumber ?? '').trim();
          const reasons = [
            `similar name "${a.name}" vs "${b.name}" (similarity ${similarity.toFixed(2)}) with the same brand "${a.brand}"`,
          ];
          if (modelA && modelA === modelB) {
            reasons.push(`same recorded model number ${modelA}`);
          }
          candidates.push({
            productId: b.id,
            productSlug: b.slug,
            productName: b.name,
            duplicateOfProductId: a.id,
            duplicateOfSlug: a.slug,
            duplicateOfName: a.name,
            matchedBy: 'name-brand-fuzzy',
            confidence: similarity,
            reasons,
          });
        }
      }
    }
  }

  candidates.sort((x, y) => y.confidence - x.confidence);
  return candidates;
}
