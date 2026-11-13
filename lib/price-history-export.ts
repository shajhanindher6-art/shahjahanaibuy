/**
 * Per-product price-history export — pure helpers for E10
 * (Section 16, item 28) and GET /api/v1/price-history/export.
 *
 * Download ONE product's recorded history rows as CSV or JSON.
 * The existing export (app/api/v1/price-index/export/route.ts) is
 * index-level only, not per-product history — this is the
 * per-product counterpart, same fail-open honesty: a product with
 * no recorded history exports headers / an empty rows array with
 * a note, never a fabricated row.
 *
 * CSV columns: product_slug, product_name, price_usd, currency,
 * availability, recorded_at, source, observed_at, suspicious,
 * verified, currency_assumed. Rows are oldest-first, exactly as
 * recorded. The last five columns are the F-P1-15 / F-P1-30
 * per-row flags (migration 057 + the future verified /
 * currency_assumed columns): empty when the row predates the
 * columns — never guessed.
 */

export interface PriceHistoryExportRow {
  productSlug: string;
  productName: string;
  price: number;
  currency: string;
  availability: string;
  recordedAt: string;
  /** Migration 057 provenance, or null/undefined when not recorded. */
  source?: string | null;
  /** Migration 057 observation time, or null/undefined when not recorded. */
  observedAt?: string | null;
  /** Migration 057 suspicious-change flag, or null/undefined when unknown. */
  suspicious?: boolean | null;
  /**
   * FINAL 100% (F-P1-15) — true only when the row was written
   * from a validated provider response. Null/undefined when the
   * row predates the column (unknown, never guessed).
   */
  verified?: boolean | null;
  /**
   * FINAL 100% (F-P1-30) — true when the row's USD was assumed
   * from a NULL currency_id. Null/undefined when unknown.
   */
  currencyAssumed?: boolean | null;
}

export const PRICE_HISTORY_EXPORT_CSV_HEADERS =
  'product_slug,product_name,price_usd,currency,availability,recorded_at,source,observed_at,suspicious,verified,currency_assumed';

export function priceHistoryExportFileName(
  productSlug: string,
  format: 'csv' | 'json'
): string {
  const safe = productSlug.replace(/[^a-z0-9-_]/gi, '-').toLowerCase() || 'product';
  return `smartbuy-price-history-${safe}.${format}`;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function priceHistoryRowsToCsv(rows: PriceHistoryExportRow[]): string {
  const lines = rows.map((r) =>
    [
      csvEscape(r.productSlug),
      csvEscape(r.productName),
      Number.isFinite(r.price) ? r.price.toFixed(2) : '',
      csvEscape(r.currency),
      csvEscape(r.availability),
      csvEscape(r.recordedAt),
      csvEscape(r.source ?? ''),
      csvEscape(r.observedAt ?? ''),
      r.suspicious === null || r.suspicious === undefined ? '' : String(r.suspicious),
      r.verified === null || r.verified === undefined ? '' : String(r.verified),
      r.currencyAssumed === null || r.currencyAssumed === undefined
        ? ''
        : String(r.currencyAssumed),
    ].join(',')
  );
  return [PRICE_HISTORY_EXPORT_CSV_HEADERS, ...lines].join('\n') + '\n';
}

export function priceHistoryRowsToJson(
  product: { slug: string; name: string },
  rows: PriceHistoryExportRow[]
): string {
  return (
    JSON.stringify(
      {
        product: { slug: product.slug, name: product.name },
        pointCount: rows.length,
        note:
          rows.length === 0
            ? 'No recorded price history for this product yet.'
            : 'Recorded price history only — oldest first, never smoothed or interpolated.',
        rows: rows.map((r) => ({
          priceUsd: r.price,
          currency: r.currency,
          availability: r.availability,
          recordedAt: r.recordedAt,
          source: r.source ?? null,
          observedAt: r.observedAt ?? null,
          suspicious: r.suspicious ?? null,
          verified: r.verified ?? null,
          currencyAssumed: r.currencyAssumed ?? null,
        })),
      },
      null,
      2
    ) + '\n'
  );
}
