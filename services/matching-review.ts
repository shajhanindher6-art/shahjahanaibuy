/**
 * FINAL 100% — matching review gate + confidence calibration
 * (F-P1-42, F-P1-44, F-P2-37, F-P2-38).
 *
 * The defect this fixes (audit Worker H H-01/H-14): the pipeline
 * fuzzy leg auto-merged on same-brand token-Jaccard >= 0.75 with
 * no human review — two 4-token names differing in one token
 * (year / storage / RAM) score exactly 0.75 and merged, and the
 * merge overwrote GTIN / image / description. Brand fuzzy
 * auto-matching (>= 0.75) folded near-miss brands together the
 * same way, with only a debug log as a record.
 *
 * The gate, in one place:
 * - AUTO-MERGE is allowed ONLY for an exact leg (GTIN, slug, or
 *   exact normalized name+brand) AND only when the models do not
 *   conflict (a model conflict is a veto, even on an exact leg —
 *   two different models must never merge). The auto bar is 0.90,
 *   not 1.0, because the GTIN leg is capped at 0.90 by F-P1-03
 *   (a GTIN is a format-checked identifier, never identity
 *   proof) — the cap is about the reported confidence, and the
 *   leg still auto-merges subject to the model veto. A bare
 *   GTIN-only match with NO corroborating leg is still held when
 *   it arrives through a scored matcher (see
 *   `calibrateMatchConfidence`); the pipeline dedupe leg reports
 *   the capped 0.90 and merges on it.
 * - EVERYTHING fuzzy (confidence < 0.90, or matchedBy
 *   'name-brand-fuzzy' / 'model') is HELD FOR REVIEW: the
 *   pipeline must not update the existing product, must not
 *   overwrite GTIN/image, and must leave a durable record (a
 *   persisted ingestion rejection + an audit-log entry — see
 *   `buildMatchReviewRecord`; there is no dedicated review-queue
 *   table in the schema yet, so the rejection + audit trail IS
 *   the queue until a migration adds one. Nothing here invents a
 *   table).
 * - A failed dedupe read FAILS CLOSED (audit H-09): the ingest
 *   must not proceed as "no match" when the check itself errored.
 *
 * Confidence calibration (F-P2-37/38) — the bands every matcher
 * in this codebase must use:
 *   1.00  exact slug, or exact normalized name+brand; or a GTIN
 *          leg corroborated by name/brand/model in a SCORED
 *          matcher (eBay). The pipeline dedupe GTIN leg reports
 *          the capped 0.90 (F-P1-03) and auto-merges on it
 *          subject to the model veto.
 *   0.90  GTIN alone, uncorroborated — a single GTIN leg is
 *          strong but a mistyped/reused GTIN collapses to
 *          certainty if it is scored 1.0 (audit F-P1-03). This
 *          is also the auto-merge bar for exact legs.
 *   0.75–0.89 fuzzy name/brand — candidate only, always review.
 *   <0.75 no match.
 * `calibrateMatchConfidence` implements the bands; callers pass
 * the legs they actually observed, never a bare number.
 */

import { modelsConflict, normalizeModel } from '@/lib/model-normalization';

export const MATCH_AUTO_MERGE_MIN_CONFIDENCE = 0.9;
export const MATCH_REVIEW_MIN_CONFIDENCE = 0.75;
/** A GTIN leg with no corroborating leg scores 0.90, never 1.0. */
export const GTIN_ALONE_CONFIDENCE = 0.9;
/** A GTIN leg corroborated by name, brand, or model scores 1.0. */
export const GTIN_CORROBORATED_CONFIDENCE = 1;

export type MatchLeg = 'gtin' | 'slug' | 'name-brand' | 'name-brand-fuzzy' | 'model' | 'manual';

export type MatchDecisionAction = 'auto-merge' | 'hold-for-review' | 'no-match' | 'reject';

export interface MatchDecision {
  action: MatchDecisionAction;
  /** Calibrated 0–1 confidence (see the bands above). */
  confidence: number | null;
  matchedBy: MatchLeg | null;
  /** True when a human must decide before any merge/update. */
  reviewRequired: boolean;
  /** Plain-language reasons, in order. Never empty when held/rejected. */
  reasons: string[];
}

/**
 * Calibrate a match confidence from the legs actually observed.
 * A GTIN leg alone is 0.90; corroborated by any of (same brand,
 * similar name >= 0.75, same normalized model) it is 1.0. An
 * exact slug / exact name+brand leg is 1.0. A fuzzy name leg is
 * its similarity, capped below 1.0. No combination of weak legs
 * ever sums to 1.0 — confidence is the strongest single leg,
 * never an invented total.
 */
export function calibrateMatchConfidence(input: {
  gtinMatch?: boolean;
  slugMatch?: boolean;
  exactNameBrandMatch?: boolean;
  fuzzySimilarity?: number | null;
  corroborated?: boolean;
}): number | null {
  if (input.slugMatch || input.exactNameBrandMatch) return 1;
  if (input.gtinMatch) {
    return input.corroborated ? GTIN_CORROBORATED_CONFIDENCE : GTIN_ALONE_CONFIDENCE;
  }
  if (input.fuzzySimilarity !== null && input.fuzzySimilarity !== undefined) {
    if (input.fuzzySimilarity < MATCH_REVIEW_MIN_CONFIDENCE) return null;
    return Math.min(input.fuzzySimilarity, 0.99);
  }
  return null;
}

/**
 * Calibrate a GTIN-only match (F-P2-38). `corroborated` is true
 * when a second leg agrees (same brand, similar name, or same
 * normalized model). A bare GTIN match is 0.90 — strong, but not
 * certainty: a mistyped or reused GTIN must not collapse to 1.0.
 */
export function gtinMatchConfidence(corroborated: boolean): number {
  return corroborated ? GTIN_CORROBORATED_CONFIDENCE : GTIN_ALONE_CONFIDENCE;
}

/**
 * The pipeline duplicate gate (F-P1-42). `dedup` is the raw
 * `findDuplicate` result; `incomingModel` / `existingModel` are
 * the normalized-model inputs (raw strings — normalized here).
 * Exact legs auto-merge unless the models conflict; fuzzy legs
 * always hold; a dedupe read error rejects the ingest outright
 * (fail closed, audit H-09).
 */
export function classifyPipelineDuplicate(input: {
  isDuplicate: boolean;
  matchedBy: MatchLeg | null;
  confidence?: number | null;
  incomingModel?: string | null;
  existingModel?: string | null;
  dedupeError?: string | null;
}): MatchDecision {
  if (input.dedupeError) {
    return {
      action: 'reject',
      confidence: null,
      matchedBy: null,
      reviewRequired: true,
      reasons: [
        `Duplicate check failed (${input.dedupeError}) — ingestion is held instead of proceeding as "no match".`,
      ],
    };
  }
  if (!input.isDuplicate || !input.matchedBy) {
    return { action: 'no-match', confidence: null, matchedBy: null, reviewRequired: false, reasons: [] };
  }
  const conflict = modelsConflict(input.incomingModel, input.existingModel);
  if (conflict) {
    return {
      action: 'hold-for-review',
      confidence: input.confidence ?? null,
      matchedBy: input.matchedBy,
      reviewRequired: true,
      reasons: [
        `Model conflict: incoming model "${normalizeModel(input.incomingModel)}" differs from existing model "${normalizeModel(input.existingModel)}" — two different models must never auto-merge, even on an exact ${input.matchedBy} leg.`,
      ],
    };
  }
  const exactLegs: MatchLeg[] = ['gtin', 'slug', 'name-brand'];
  if (exactLegs.includes(input.matchedBy) && (input.confidence ?? 0) >= MATCH_AUTO_MERGE_MIN_CONFIDENCE) {
    return {
      action: 'auto-merge',
      confidence: input.confidence ?? null,
      matchedBy: input.matchedBy,
      reviewRequired: false,
      reasons: [`Exact ${input.matchedBy} match (confidence ${input.confidence ?? 'unknown'}), no model conflict.`],
    };
  }
  // Fuzzy leg (or an exact leg that arrived with a sub-1.0
  // confidence, e.g. an uncorroborated GTIN at 0.90): hold.
  const similarity =
    input.confidence !== null && input.confidence !== undefined
      ? input.confidence.toFixed(2)
      : 'unknown';
  return {
    action: 'hold-for-review',
    confidence: input.confidence ?? null,
    matchedBy: input.matchedBy,
    reviewRequired: true,
    reasons: [
      `Uncertain match (${input.matchedBy}, confidence ${similarity}) — a fuzzy or uncorroborated match never auto-overwrites GTIN, image, or description. Held for manual review.`,
    ],
  };
}

/**
 * The brand-resolution gate (F-P1-44). An exact slug / name
 * match auto-resolves; a fuzzy near-miss (>= 0.75) resolves to
 * the existing brand row BUT is flagged for review — the caller
 * must surface it (audit log / ingest metadata), never silently
 * fold two brands together. A genuinely new brand (no match at
 * all) is created normally: creation is not a merge.
 */
export function classifyBrandResolution(input: {
  matchedBy?: 'exact' | 'fuzzy' | null;
  similarity?: number | null;
  created?: boolean;
}): MatchDecision {
  if (input.matchedBy === 'fuzzy') {
    return {
      action: 'hold-for-review',
      confidence: input.similarity ?? null,
      matchedBy: 'name-brand-fuzzy',
      reviewRequired: true,
      reasons: [
        `Brand fuzzy match (similarity ${input.similarity !== null && input.similarity !== undefined ? input.similarity.toFixed(2) : 'unknown'}) — matched to the existing brand, but the fold needs human review: two genuinely distinct brands with similar names must not be merged silently.`,
      ],
    };
  }
  if (input.created) {
    return {
      action: 'auto-merge',
      confidence: 1,
      matchedBy: null,
      reviewRequired: false,
      reasons: ['New brand created — no existing brand was merged.'],
    };
  }
  return {
    action: 'auto-merge',
    confidence: 1,
    matchedBy: 'name-brand',
    reviewRequired: false,
    reasons: ['Exact brand match.'],
  };
}

/** One durable review record for a held match. */
export interface MatchReviewRecord {
  kind: 'pipeline-duplicate' | 'brand-fuzzy' | 'ebay-listing' | 'manual-listing';
  productName: string;
  existingProductId?: string | null;
  matchedBy: MatchLeg | null;
  confidence: number | null;
  reasons: string[];
  /** What the pipeline did instead of merging. */
  heldAction: 'rejected-ingest-held-for-review' | 'resolved-with-review-flag';
  createdAt: string;
}

/**
 * Build the durable record for a held match. Callers persist it
 * in the audit-log metadata (services/pipeline/ingestion.ts
 * `logAudit`) and, for pipeline holds, as a persisted ingestion
 * rejection — the two durable trails that exist today. There is
 * no dedicated review-queue table yet; when one is added by a
 * migration, this record is its row shape.
 */
export function buildMatchReviewRecord(
  kind: MatchReviewRecord['kind'],
  input: {
    productName: string;
    existingProductId?: string | null;
    matchedBy: MatchLeg | null;
    confidence: number | null;
    reasons: string[];
    heldAction?: MatchReviewRecord['heldAction'];
  }
): MatchReviewRecord {
  return {
    kind,
    productName: input.productName,
    existingProductId: input.existingProductId ?? null,
    matchedBy: input.matchedBy,
    confidence: input.confidence,
    reasons: input.reasons,
    heldAction: input.heldAction ?? 'rejected-ingest-held-for-review',
    createdAt: new Date().toISOString(),
  };
}
