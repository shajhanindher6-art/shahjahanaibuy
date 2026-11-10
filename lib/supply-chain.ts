/**
 * Supply-chain facts (Section 6, item 11).
 *
 * Recorded-only: country of origin, manufacturer, certifications
 * and note come from the brand/manufacturer's own published data
 * (migration 033 columns country_of_origin / manufacturer_name /
 * certifications / supply_chain_note / supply_chain_source_url on
 * products, exposed by the product API as `supplyChain`).
 * A country or certification is NEVER estimated — a missing field
 * renders as "Not recorded".
 *
 * Pure helper, same pattern as lib/deal-score.ts: plain recorded
 * data in, render-ready facts (or null) out.
 */

/** Recorded supply-chain data, as the product API exposes it. */
export interface SupplyChainData {
  countryOfOrigin: string | null;
  manufacturerName: string | null;
  /** Recorded certifications, or null/[] when none are recorded. */
  certifications: string[] | null;
  note: string | null;
  /** Outbound link to the source of these facts, or null. */
  sourceUrl: string | null;
}

export interface SupplyChainFacts {
  countryOfOrigin: string;
  manufacturerName: string;
  /** Recorded certifications; ['Not recorded'] when none are recorded. */
  certifications: string[];
  note: string;
  sourceUrl: string | null;
}

export const SUPPLY_CHAIN_NOT_RECORDED = 'Not recorded';

function recordedOrNotRecorded(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed !== '' ? trimmed : SUPPLY_CHAIN_NOT_RECORDED;
}

/**
 * Render-ready supply-chain facts. Every field is either a
 * recorded value or "Not recorded". Returns null only when
 * NOTHING is recorded at all (no field, no certification, no
 * source link) — the caller then renders the honest empty state
 * instead of a block full of "Not recorded" rows.
 */
export function formatSupplyChainFacts(
  supplyChain: SupplyChainData | null | undefined
): SupplyChainFacts | null {
  if (!supplyChain) return null;
  const certifications = Array.isArray(supplyChain.certifications)
    ? supplyChain.certifications
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c.trim())
        .filter((c) => c !== '')
    : [];
  const sourceUrl =
    typeof supplyChain.sourceUrl === 'string' && supplyChain.sourceUrl.trim() !== ''
      ? supplyChain.sourceUrl.trim()
      : null;
  const hasAnything =
    recordedOrNotRecorded(supplyChain.countryOfOrigin) !== SUPPLY_CHAIN_NOT_RECORDED ||
    recordedOrNotRecorded(supplyChain.manufacturerName) !== SUPPLY_CHAIN_NOT_RECORDED ||
    certifications.length > 0 ||
    recordedOrNotRecorded(supplyChain.note) !== SUPPLY_CHAIN_NOT_RECORDED ||
    sourceUrl !== null;
  if (!hasAnything) return null;
  return {
    countryOfOrigin: recordedOrNotRecorded(supplyChain.countryOfOrigin),
    manufacturerName: recordedOrNotRecorded(supplyChain.manufacturerName),
    certifications: certifications.length > 0 ? certifications : [SUPPLY_CHAIN_NOT_RECORDED],
    note: recordedOrNotRecorded(supplyChain.note),
    sourceUrl,
  };
}
