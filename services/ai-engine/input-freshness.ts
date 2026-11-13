/**
 * Section 21, Stage E (E-P2-1) — read the typed freshness /
 * verification input (AIEngineInput, Section 20 §12 #82) where
 * engine decisions are made.
 *
 * Until Section 21 the typed fields existed but no adapter read
 * them: the only reader in the tree was `buying-opportunity.ts`
 * (evaluateBuyingOpportunity). Adapters received a bare record
 * and treated every recorded price as current and verified. This
 * helper is the one place that turns an AIEngineInput into a
 * freshness verdict — adapters call it and qualify their output
 * with it (see services/ai-engine/providers.ts: the ai-summary
 * adapter enriches the product with the input's verification /
 * freshness, the predict-price-drop adapter appends a staleness
 * qualifier to its explanation). Pure, no I/O, no throw.
 */

import { getFreshnessStatus } from '@/lib/price-freshness';
import {
  normalizePriceVerificationStatus,
  type PriceVerificationStatus,
} from '@/services/price-verification';
import type { AIEngineInput } from './types';

export interface EngineInputFreshness {
  /** Normalized rollup ('unverified' when absent/unknown — never a guessed 'verified'). */
  priceVerificationStatus: PriceVerificationStatus;
  /** Last recorded price check, when the input carried one. */
  dataFreshness: string | null;
  /** True when the last check is older than STALE_PRICE_DAYS (7). */
  priceStale: boolean;
  /** Whole days since the last check (null when unknown). */
  daysSinceLastCheck: number | null;
  /** One-line basis label for qualifying output copy. */
  basisLabel: string;
}

export function describeEngineInputFreshness(
  input: AIEngineInput
): EngineInputFreshness {
  const priceVerificationStatus = normalizePriceVerificationStatus(
    input.priceVerificationStatus
  );
  const dataFreshness =
    typeof input.dataFreshness === 'string' && input.dataFreshness !== ''
      ? input.dataFreshness
      : null;
  const { status, ageDays } = getFreshnessStatus(dataFreshness);
  const priceStale = status === 'stale';
  const ageText =
    ageDays === null
      ? 'last check unknown'
      : `last checked ${ageDays} day${ageDays === 1 ? '' : 's'} ago${priceStale ? ' (stale)' : ''}`;
  return {
    priceVerificationStatus,
    dataFreshness,
    priceStale,
    daysSinceLastCheck: ageDays,
    basisLabel:
      `Recorded prices, ${priceVerificationStatus}, ${ageText}.`,
  };
}
