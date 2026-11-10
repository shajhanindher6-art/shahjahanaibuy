/**
 * Crypto display-only (Section 6, item 17).
 *
 * USDT is shown ONLY as a peg reference next to a recorded USD
 * price: 1 USDT ≈ $1. It is NOT a live rate, NOT a payment method,
 * and NO store is recorded as accepting crypto — so no crypto
 * payment method is added to any store, USDT is NOT added to
 * CurrencyCode or the FX feed, and nothing here is a price quote.
 *
 * Pure function, same pattern as lib/deal-math.ts: a recorded USD
 * price in, a display string (or null) out.
 */

/** Label the UI must show next to every USDT peg figure. */
export const USDT_PEG_NOTE =
  'Peg reference only — not a live rate, not a payment method; no store is recorded as accepting crypto';

/**
 * USDT peg reference for a recorded USD price, e.g. "≈ USDT 999.00".
 * Returns null when the price is missing, zero, negative or
 * non-finite — a missing price is no peg, never a guessed figure.
 */
export function formatUsdtPeg(usdPrice: number | null | undefined): string | null {
  if (usdPrice === null || usdPrice === undefined || !Number.isFinite(usdPrice) || usdPrice <= 0) {
    return null;
  }
  return `≈ USDT ${usdPrice.toFixed(2)}`;
}
