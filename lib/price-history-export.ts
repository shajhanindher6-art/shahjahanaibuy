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
 * availability, recorded_at. Rows are oldest-first, exactly as
 * recorded.
 */

export interface PriceHistoryExportRow {
  productSlug: string;
  productName: string;
  price: number;
  currency: string;
  availability: string;
  recordedAt: string;
}

export const PRICE_HISTORY_EXPORT_CSV_HEADERS =
  'product_slug,product_name,price_usd,currency,availability,recorded_at';

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
        })),
      },
      null,
      2
    ) + '\n'
  );
}
