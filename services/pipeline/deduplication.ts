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
import { normalizeDedupeText } from '@/lib/normalize';
import type { NormalizedProduct } from './normalization';
import { modelsConflict, normalizeBrand, normalizeModel } from '@/lib/model-normalization';

// S2-6: normalizeDedupeText's canonical home is lib/normalize.ts
// (a pure lib module, so client-usable code can import it too).
// It is re-exported here so existing importers
// (services/pipeline/deduplication.ts consumers, tests) keep working.
export { normalizeDedupeText } from '@/lib/normalize';

export interface DeduplicationResult {
  existingProductId: string | null;
  isDuplicate: boolean;
  matchedBy: 'gtin' | 'slug' | 'name-brand' | 'name-brand-fuzzy' | 'model' | null;
  /**
   * Section 20, #9: 0–1 similarity behind a fuzzy match (1 for
   * an exact normalized name+brand match). Null for GTIN/slug
   * matches and non-duplicates — those are exact, not scored.
   */
  confidence?: number | null;
  /**
   * FINAL 100% (F-P1-42/F-P1-45): true when the match must go to
   * manual review instead of auto-merging — a fuzzy leg, an
   * uncorroborated GTIN, or a model conflict. Absent (undefined)
   * when the match auto-merges, so exact-match results keep
   * their existing shape.
   */
  requiresReview?: boolean;
  /** Plain-language reason the match requires review (when it does). */
  reviewReason?: string;
  /**
   * FINAL 100% (F-P2-42, audit H-09): set when the dedupe check
   * itself failed. The ingest must FAIL CLOSED on this — never
   * proceed as "no match" when the check errored.
   */
  dedupeError?: string;
  /** The existing product's recorded model number, when read. */
  existingModelNumber?: string | null;
}

/** True when the error means "column does not exist" (Postgres 42703). */
function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

/**
 * Best-effort read of one product's recorded model number.
 * Returns null when the row has none, the column does not exist
 * yet (migration 055 unapplied), or the read fails — a missing
 * model is never an error, and it never blocks the match.
 */
async function loadExistingModelNumber(
  supabase: AnySupabaseClient,
  productId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('model_number')
      .eq('id', productId)
      .maybeSingle();
    if (error || !data) return null;
    const raw = (data as Record<string, unknown>).model_number;
    return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * FINAL 100% (F-P1-42/F-P1-45): attach the review flag to a
 * candidate match. An exact leg auto-merges unless the models
 * conflict; a fuzzy leg always requires review; a model
 * conflict is a veto on any leg.
 */
function withReviewGate(
  base: Omit<DeduplicationResult, 'requiresReview' | 'reviewReason' | 'existingModelNumber'>,
  incomingModel: string | null | undefined,
  existingModel: string | null | undefined
): DeduplicationResult {
  const result: DeduplicationResult = { ...base };
  if (existingModel !== undefined) result.existingModelNumber = existingModel;
  if (modelsConflict(incomingModel, existingModel)) {
    result.requiresReview = true;
    result.reviewReason = `Model conflict: incoming model "${normalizeModel(incomingModel)}" differs from existing model "${normalizeModel(existingModel)}" — two different models must never auto-merge.`;
    return result;
  }
  if (base.matchedBy === 'name-brand-fuzzy') {
    result.requiresReview = true;
    result.reviewReason = `Fuzzy name+brand match (confidence ${base.confidence !== null && base.confidence !== undefined ? base.confidence.toFixed(2) : 'unknown'}) — uncertain merges go to manual review and never auto-overwrite GTIN, image, or description.`;
    return result;
  }
  return result;
}

/**
 * Token-set Jaccard similarity between two normalized names
 * (0 = no shared token, 1 = identical token sets). Order-free,
 * so "Air 13 MacBook" and "MacBook Air 13" score 1.
 * (normalizeDedupeText lives in lib/normalize.ts — see the
 * re-export at the top of this file.)
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

/**
 * Final 100% — F-P1-03: GTIN-match confidence cap. A GTIN match
 * is a strong signal, never identity proof: a mistyped GTIN
 * copied across listings, a GTIN reused by a marketplace seller,
 * or a GTIN that belongs to a different variant would otherwise
 * collapse to certainty (confidence 1.0, the maximum). No
 * GTIN-only match may report absolute certainty — 0.9 is the
 * ceiling, and the match still needs a human (intake review) or
 * a name/brand sanity check before any merge. Slug and exact
 * name+brand matches stay at 1.0: those are exact-string
 * identities, not format checks.
 */
export const GTIN_MATCH_CONFIDENCE = 0.9;

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
      // FINAL 100% (F-P1-45/F-P1-46): a model conflict vetoes
      // even an exact GTIN leg — the GTIN may be mistyped or
      // reused across a variant family.
      const existingModel = await loadExistingModelNumber(supabase, data.id);
      return withReviewGate(
        { existingProductId: data.id, isDuplicate: true, matchedBy: 'gtin', confidence: GTIN_MATCH_CONFIDENCE },
        normalized.modelNumber ?? null,
        existingModel
      );
    }
  }

  const { data } = await supabase
    .from('products')
    .select('id')
    .eq('slug', normalized.slug)
    .maybeSingle();

  if (data?.id) {
    logger.debug('Deduplication: slug match', { slug: normalized.slug, id: data.id });
    const existingModel = await loadExistingModelNumber(supabase, data.id);
    return withReviewGate(
      { existingProductId: data.id, isDuplicate: true, matchedBy: 'slug', confidence: 1 },
      normalized.modelNumber ?? null,
      existingModel
    );
  }

  // FINAL 100% (F-P1-45): the MODEL leg — same normalized model
  // number + same normalized brand is a candidate on its own
  // (held for review, never an auto-merge: model numbers can
  // repeat across regional variants). It runs before the fuzzy
  // name leg so a same-model re-ingest under a different name is
  // caught instead of creating a second row.
  if (normalized.modelNumber && normalized.brand) {
    const wantedModel = normalizeModel(normalized.modelNumber);
    const wantedBrandKey = normalizeBrand(normalized.brand);
    if (wantedModel && wantedBrandKey) {
      try {
        let modelRows: Array<{ id: string; name: string; brand: string; model_number?: string | null }> | null = null;
        let modelError: { code?: string; message: string } | null = null;
        const modelQuery = supabase
          .from('products')
          .select('id, name, brand, model_number')
          .ilike('brand', normalized.brand)
          .limit(50);
        const first = (await modelQuery) as unknown as {
          data: Array<{ id: string; name: string; brand: string; model_number?: string | null }> | null;
          error: { code?: string; message: string } | null;
        };
        modelRows = first.data;
        modelError = first.error;
        if (modelError && isUndefinedColumnError(modelError)) {
          // Migration 055 unapplied: the model column does not
          // exist, so the model leg cannot run — honest skip.
          modelRows = null;
          modelError = null;
        }
        if (modelError) {
          logger.warn('Deduplication: model check failed, failing closed', {
            error: modelError.message,
          });
          return {
            existingProductId: null,
            isDuplicate: false,
            matchedBy: null,
            confidence: null,
            dedupeError: `model-number lookup failed: ${modelError.message}`,
          };
        }
        for (const row of modelRows ?? []) {
          if (normalizeBrand(row.brand ?? '') !== wantedBrandKey) continue;
          if (normalizeModel(row.model_number ?? null) === wantedModel) {
            logger.debug('Deduplication: model+brand match (held for review)', {
              model: wantedModel,
              id: row.id,
            });
            return {
              existingProductId: row.id,
              isDuplicate: true,
              matchedBy: 'model',
              confidence: 0.9,
              requiresReview: true,
              reviewReason: `Same normalized model number "${wantedModel}" with the same brand "${normalized.brand}" — a model leg is a review candidate, never an auto-merge (model numbers can repeat across regional variants).`,
              existingModelNumber: row.model_number ?? null,
            };
          }
        }
      } catch (err) {
        logger.warn('Deduplication: model check failed, failing closed', {
          error: String(err),
        });
        return {
          existingProductId: null,
          isDuplicate: false,
          matchedBy: null,
          confidence: null,
          dedupeError: `model-number lookup failed: ${String(err)}`,
        };
      }
    }
  }

  // Section 20, #9 — name/brand legs. A product re-ingested with
  // no GTIN and a fresh slug used to sail through both legs above.
  // Brand is matched case-insensitively in the query; the name
  // comparison is normalized in code (the DB has no normalized
  // name column). FINAL 100% (F-P2-42, audit H-09): FAIL CLOSED —
  // a query failure now returns `dedupeError` and the ingest
  // holds, instead of degrading to "no match" and silently
  // admitting a duplicate. The retroactive sweep
  // (findDuplicateCandidates) is the backstop only for pairs the
  // check actually ran on.
  if (normalized.name && normalized.brand) {
    try {
      const { data: brandRows, error } = await supabase
        .from('products')
        .select('id, name, brand')
        .ilike('brand', normalized.brand)
        .limit(50);
      if (error) {
        logger.warn('Deduplication: name/brand check failed, failing closed', {
          error: error.message,
        });
        return {
          existingProductId: null,
          isDuplicate: false,
          matchedBy: null,
          confidence: null,
          dedupeError: `name/brand lookup failed: ${error.message}`,
        };
      }
      if (brandRows) {
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
          const existingModel = await loadExistingModelNumber(supabase, best.id);
          return withReviewGate(
            {
              existingProductId: best.id,
              isDuplicate: true,
              matchedBy: 'name-brand',
              confidence: 1,
            },
            normalized.modelNumber ?? null,
            existingModel
          );
        }
        if (best && best.similarity >= NAME_BRAND_FUZZY_THRESHOLD) {
          logger.debug('Deduplication: fuzzy name+brand match', {
            name: normalized.name,
            id: best.id,
            similarity: best.similarity,
          });
          const existingModel = await loadExistingModelNumber(supabase, best.id);
          return withReviewGate(
            {
              existingProductId: best.id,
              isDuplicate: true,
              matchedBy: 'name-brand-fuzzy',
              confidence: best.similarity,
            },
            normalized.modelNumber ?? null,
            existingModel
          );
        }
      }
    } catch (err) {
      logger.warn('Deduplication: name/brand check failed, failing closed', {
        error: String(err),
      });
      return {
        existingProductId: null,
        isDuplicate: false,
        matchedBy: null,
        confidence: null,
        dedupeError: `name/brand lookup failed: ${String(err)}`,
      };
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
 * `confidence` is a 0–1 score, NOT a verdict: 0.9 = GTIN match
 * (capped — a GTIN is a format-checked identifier, never identity
 * proof; see GTIN_MATCH_CONFIDENCE), 1.0 = exact normalized
 * name+brand (review to confirm, then merge or keep); 0.75–0.99 =
 * same brand + similar name (token Jaccard, see
 * NAME_BRAND_FUZZY_THRESHOLD). Anything below the threshold is
 * not reported at all. The admin review view (a separate Section
 * 20 item) decides merge vs keep — this function never deletes or
 * merges anything.
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
  /** 0–1: 0.9 for a GTIN match (capped — see GTIN_MATCH_CONFIDENCE), 1 for exact name+brand, else the token similarity. */
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
      // whatever the slugs say — but the confidence is CAPPED at
      // GTIN_MATCH_CONFIDENCE (0.9), never 1.0: a GTIN match means
      // "same identifier string", not "same product" (a mistyped
      // or reused GTIN collapses to certainty at 1.0 — F-P1-03).
      // FINAL 100% (F-P1-45/F-P1-46): a model conflict does not
      // remove the candidate, but it is named in the reasons —
      // the reviewer must resolve it before any merge.
      if (gtinA && gtinA === gtinB) {
        seenPair.add(key);
        const gtinReasons = [`same GTIN ${a.gtin}`];
        if (modelsConflict(a.modelNumber, b.modelNumber)) {
          gtinReasons.push(
            `model conflict: "${a.modelNumber}" vs "${b.modelNumber}" (normalized ${normalizeModel(a.modelNumber)} vs ${normalizeModel(b.modelNumber)}) — same GTIN but different recorded models; review before merging`
          );
        }
        candidates.push({
          productId: b.id,
          productSlug: b.slug,
          productName: b.name,
          duplicateOfProductId: a.id,
          duplicateOfSlug: a.slug,
          duplicateOfName: a.name,
          matchedBy: 'gtin',
          confidence: GTIN_MATCH_CONFIDENCE,
          reasons: gtinReasons,
        });
        continue;
      }

      // Same normalized name + same normalized brand — unless the
      // models conflict (FINAL 100%, F-P1-45): the same name text
      // with different recorded model numbers is two models, not
      // one product, so it is not a duplicate candidate at all.
      if (nameA && nameA === nameB && brandA && brandA === brandB) {
        if (modelsConflict(a.modelNumber, b.modelNumber)) continue;
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
      // UNIQUE on the column). FINAL 100% (F-P1-45/F-P1-46): the
      // model comparison is NORMALIZED ("SM-S928B" variants
      // match), and a model conflict vetoes the candidate —
      // similar names for different models are exactly the
      // false-merge case (e.g. a 4-token name differing in the
      // year token).
      if (brandA && brandA === brandB && nameA && nameB) {
        const similarity = nameTokenSimilarity(nameA, nameB);
        if (similarity >= NAME_BRAND_FUZZY_THRESHOLD) {
          if (modelsConflict(a.modelNumber, b.modelNumber)) continue;
          seenPair.add(key);
          const normModelA = normalizeModel(a.modelNumber);
          const normModelB = normalizeModel(b.modelNumber);
          const reasons = [
            `similar name "${a.name}" vs "${b.name}" (similarity ${similarity.toFixed(2)}) with the same brand "${a.brand}"`,
          ];
          if (normModelA && normModelA === normModelB) {
            reasons.push(`same recorded model number ${normModelA} (normalized)`);
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
