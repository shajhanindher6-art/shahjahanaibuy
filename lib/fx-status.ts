/**
 * Shared honest FX-status wording — Option 12 delta.
 *
 * Both the landed-cost calculator and the region-arbitrage table
 * fetch /api/v1/fx-rates and must describe the rates the same way.
 * The free feed (open.er-api.com) publishes DAILY rates, never
 * tick-by-tick trading rates, so the wording always says "daily
 * rate" and shows the feed's own last-update time when the API
 * reports one. When fetchedAt is null the last update is genuinely
 * unknown, and the line says so instead of inventing a time:
 * "rates as of last update unavailable — showing static fallback".
 *
 * Pure function, safe for client and server components alike.
 */

import type { CurrencyCode } from '@/services/currency';
import type { FxSource } from '@/services/fx-rates';

export interface FxStatusInput {
  /** Rates are carried for parity with the API shape; the status line never reads them. */
  rates?: Partial<Record<CurrencyCode, number>>;
  source: FxSource;
  fetchedAt: string | null;
}

/**
 * One-line honest FX status for display under a converted price.
 * - live + fetchedAt: "live daily rate …, last updated <date + time>".
 * - live + fetchedAt null: the feed did not report a time — say so.
 * - static (or fetch failed): last update unavailable, static
 *   fallback rates (≈), conversions are estimates.
 * - null + not failed: the fetch is still in flight.
 */
export function formatFxStatus(fx: FxStatusInput | null, failed: boolean): string {
  if (fx && fx.source === 'live') {
    if (fx.fetchedAt) {
      const when = new Date(fx.fetchedAt);
      if (!Number.isNaN(when.getTime())) {
        return `FX: live daily rate (open.er-api.com, last updated ${when.toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })})`;
      }
    }
    return 'FX: live daily rate (open.er-api.com, last update time not reported by the feed)';
  }
  if (failed || fx?.source === 'static') {
    return 'FX: rates as of last update unavailable — showing approximate static fallback rates (≈); conversions are estimates';
  }
  return 'FX: rates loading — showing approximate static rates (≈) until the live feed responds';
}

/**
 * Short one-line FX label for inline use next to a converted price
 * (the <Price> component's `showFxNote` line and `title` tooltip).
 * Same honesty rules as formatFxStatus, condensed: a live rate
 * always carries its date ("live daily rate · 10 Nov 2026"), a
 * static fallback says so, and nothing here ever says "real-time".
 * Returns null while the fetch is still in flight (no label yet —
 * the price itself already renders from static rates).
 */
export function formatFxShortLabel(fx: FxStatusInput | null, failed: boolean): string | null {
  if (fx && fx.source === 'live') {
    if (fx.fetchedAt) {
      const when = new Date(fx.fetchedAt);
      if (!Number.isNaN(when.getTime())) {
        return `live daily rate · ${when.toLocaleDateString('en-US', {
          dateStyle: 'medium',
        })}`;
      }
    }
    return 'live daily rate';
  }
  if (failed || fx?.source === 'static') {
    return 'approx. static rate';
  }
  return null;
}
