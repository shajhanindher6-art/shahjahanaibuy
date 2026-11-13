/**
 * Section 21–25, Stage D — refresh-path currency handling (audit §1 #62, §12 Stage D).
 *
 * THE RULE: a price row always records the currency the price was
 * actually observed in, and an assumed currency is always labelled
 * as assumed — never silent.
 *
 *   - A merchant row's `currency_id` resolves through the
 *     `currencies` table to a 3-letter code. That code is the
 *     row's currency, whatever it is (USD, EUR, …).
 *   - When `currency_id` is NULL or unresolvable (every seeded
 *     row is NULL — the seed never recorded one), the row is
 *     recorded as USD **and counted as assumed** (`assumedUsd`).
 *     The old code already defaulted to 'USD'; what it did not
 *     do is say so anywhere countable. Callers surface the
 *     assumed count in the refresh result, so the assumption is
 *     visible in the run record instead of hidden in a comment.
 *   - FINAL 100% (F-P1-30) — the assumed flag IS persisted, on
 *     the price_history row (`currency_assumed`, tiered retry in
 *     services/price-history-quality.ts) and in the refresh-run
 *     counts. It is NOT persisted on the merchant row itself:
 *     no `currency_assumed` column exists on merchant_products
 *     in any migration (060 adds price_history.currency_code
 *     only), and writing the assumed code into the merchant
 *     row's `currency_id` would relabel an assumption as an
 *     observed currency — fabrication. The merchant row keeps
 *     `currency_id` NULL until a future migration adds the flag
 *     column (owner-gated; do NOT write that migration here).
 *     Displays must therefore never read the merchant row's
 *     currency as observed USD; the history flag + run counts
 *     are the honest record of the assumption.
 *   - An eBay listing whose currency code is unknown is NEVER
 *     recorded as USD: the listing is skipped and the unknown
 *     code is reported (see services/ebay-refresh.ts). Recording
 *     an unknown-currency price as USD would invent a currency.
 *
 * NO FX CONVERSION: there is deliberately no FX conversion in
 * any refresh path. `services/currency.ts` carries a display-side
 * `USD_PER_UNIT` table for budgets and UI conversion, but refresh
 * never uses it: converting a recorded EUR price to USD with a
 * static rate would invent a USD price nobody observed. A
 * non-USD price is stored in its native currency and shown as
 * such. If a live FX source is ever wired, conversion belongs in
 * a new, explicitly-labelled step — not silently inside refresh.
 */

export const DEFAULT_CURRENCY_CODE = 'USD';

/** True when the code is a plausible ISO 4217 alpha-3 code. */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value.trim().toUpperCase());
}

/** Normalise a raw currency string to upper-case alpha-3, or null. */
export function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export interface ResolvedListingCurrency {
  /** The code recorded on the price row. */
  code: string;
  /** True when the code is the explicit USD default, not a recorded currency. */
  assumedUsd: boolean;
  /** True when the row carried a currency_id no `currencies` row explains. */
  unknownCurrencyId: boolean;
}

/**
 * Resolve a merchant row's currency. `currencyId` is the row's
 * `currency_id` (NULL on every seeded row); `codeById` maps
 * currency ids to their codes (from the `currencies` table).
 * A NULL id and an unresolvable id both resolve to explicit-USD
 * (`assumedUsd: true`); the two cases are distinguished by
 * `unknownCurrencyId` so a caller can tell "never recorded" from
 * "recorded but unresolvable".
 */
export function resolveListingCurrency(
  currencyId: string | null | undefined,
  codeById: Map<string, string>
): ResolvedListingCurrency {
  if (!currencyId) {
    return { code: DEFAULT_CURRENCY_CODE, assumedUsd: true, unknownCurrencyId: false };
  }
  const code = normalizeCurrencyCode(codeById.get(currencyId));
  if (!code) {
    return { code: DEFAULT_CURRENCY_CODE, assumedUsd: true, unknownCurrencyId: true };
  }
  return { code, assumedUsd: false, unknownCurrencyId: false };
}

/**
 * Validate a provider-reported currency code. Returns the code
 * when it is a well-formed alpha-3 code, or null when the
 * provider reported nothing usable — the caller must then decide
 * explicitly (record as assumed-USD with a flag, or skip the
 * row), never silently treat the absence as USD.
 */
export function validateProviderCurrency(value: unknown): string | null {
  return normalizeCurrencyCode(value);
}
