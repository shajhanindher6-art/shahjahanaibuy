/**
 * Product authenticity (Section 6, item 10).
 *
 * Recorded-only: the verification method comes from the
 * manufacturer's own published data (migration 033 columns
 * authenticity_method / authenticity_url / authenticity_verified_at
 * on products, exposed by the product API as `authenticity`).
 * SmartBuy never verifies individual units and never awards a
 * "genuine" badge — the block below only repeats the
 * manufacturer's own method and links out to it, so the shopper
 * can check the unit themselves.
 *
 * Pure helper, same pattern as lib/deal-score.ts: plain recorded
 * data in, a render-ready block (or null) out.
 */

/** Recorded authenticity data, as the product API exposes it. */
export interface AuthenticityData {
  /** The manufacturer's own verification method, or null when unrecorded. */
  method: string | null;
  /** Outbound link to the manufacturer's verification page, or null. */
  url: string | null;
  /** When the method was recorded/verified, or null. */
  verifiedAt: string | null;
}

export interface AuthenticityBlock {
  method: string;
  url: string | null;
  verifiedAt: string | null;
  /** Wording the UI must show verbatim next to the method. */
  disclaimer: string;
}

export const AUTHENTICITY_DISCLAIMER =
  "Manufacturer's own verification method — SmartBuy does not verify individual units";

/**
 * Render-ready authenticity block, or null when no method is
 * recorded. A missing method is "not recorded", never a badge and
 * never a claim that the product is genuine (or is not).
 */
export function formatAuthenticityBlock(
  authenticity: AuthenticityData | null | undefined
): AuthenticityBlock | null {
  if (!authenticity) return null;
  const method = typeof authenticity.method === 'string' ? authenticity.method.trim() : '';
  if (!method) return null;
  const url = typeof authenticity.url === 'string' && authenticity.url.trim() !== ''
    ? authenticity.url.trim()
    : null;
  const verifiedAt =
    typeof authenticity.verifiedAt === 'string' && authenticity.verifiedAt.trim() !== ''
      ? authenticity.verifiedAt.trim()
      : null;
  return { method, url, verifiedAt, disclaimer: AUTHENTICITY_DISCLAIMER };
}
