import { logger } from '@/lib/config/logger';
import { isSafePublicImageUrl } from '@/services/visual-search';
import {
  ProviderFetchError,
  ProviderNotConfiguredError,
} from './errors';
import type {
  DataProvider,
  ProviderSearchRequest,
  ProviderFetchRequest,
  RawProductData,
  AvailabilityStatus,
} from './types';

/**
 * Parses a single CSV line that may contain quoted fields containing commas,
 * escaped quotes, and embedded newlines (RFC 4180-ish).
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === ',') {
        fields.push(current);
        current = '';
      } else if (char === '"') {
        inQuotes = true;
      } else {
        current += char;
      }
    }
  }

  fields.push(current);
  return fields.map((f) => f.trim());
}

/**
 * Splits a CSV document into logical lines, honouring quoted fields that
 * contain embedded newlines (RFC 4180-ish). Each line carries its 1-based
 * line number in the original document so callers can report per-row
 * errors against the line the admin actually sees.
 */
function splitCsvLines(csv: string): Array<{ text: string; lineNumber: number }> {
  const normalized = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines: Array<{ text: string; lineNumber: number }> = [];
  let buffer = '';
  let inQuotes = false;
  let lineNumber = 1;

  for (const char of normalized) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === '\n' && !inQuotes) {
      lines.push({ text: buffer, lineNumber });
      buffer = '';
      lineNumber++;
    } else {
      buffer += char;
    }
  }
  if (buffer.trim()) lines.push({ text: buffer, lineNumber });

  return lines;
}

export const CSV_NOT_CONFIGURED_REASON =
  'CSV provider has no source configured: set CSV_SOURCE_URL in the hosting dashboard to point at a public CSV feed. CSV data is unverified by definition even when configured.';

/** Sections 21–25, Stage B (B6) — same shape as eBay: 10s timeout. */
export const CSV_FETCH_TIMEOUT_MS = 10_000;
/** Sections 21–25, Stage B (B6) — size cap on a fetched CSV document (5 MB). */
export const CSV_MAX_BYTES = 5 * 1024 * 1024;

export interface CsvDocumentRow {
  /** 1-based line number of the data row in the original CSV (header is line 1). */
  rowNumber: number;
  /** Row values keyed by lower-cased header name. Missing columns are ''. */
  row: Record<string, string>;
}

/**
 * Parses a full CSV document into row objects keyed by the header row,
 * each tagged with its original line number.
 *
 * Rows with fewer columns than the header are NOT dropped — their
 * missing fields come back as empty strings so the caller can report
 * a per-row, per-field error instead of silently losing the row.
 * (Final 100%, F-P2-52: the old private parseCsv skipped short rows
 * silently; loadProducts now uses this parser so short rows surface
 * as named rejections via mapCsvRowWithReason.)
 */
export function parseCsvDocument(csv: string): CsvDocumentRow[] {
  const lines = splitCsvLines(csv);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0].text).map((h) => h.toLowerCase());

  const rows: CsvDocumentRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].text.trim()) continue;
    const values = parseCsvLine(lines[i].text);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    rows.push({ rowNumber: lines[i].lineNumber, row });
  }
  return rows;
}

function normalizeAvailability(value: string | undefined): AvailabilityStatus {
  if (!value) return 'unknown';
  const normalized = value.toLowerCase().trim();
  if (normalized.includes('in stock') || normalized === 'true' || normalized === '1') {
    return 'in_stock';
  }
  if (normalized.includes('out of stock') || normalized === 'false' || normalized === '0') {
    return 'out_of_stock';
  }
  if (normalized.includes('limited')) return 'limited';
  if (normalized.includes('preorder') || normalized.includes('pre-order')) return 'preorder';
  return 'unknown';
}

/**
 * One rejected CSV row, with the reason it was dropped (Final 100%,
 * F-P2-52). `rowNumber` is the 1-based line in the original CSV
 * (header is line 1); 0 when the caller does not know the line.
 * Rejections are surfaced via `CsvProvider.getLastLoadRejections()`
 * and in the load log line — never silently dropped.
 */
export interface CsvRowRejection {
  rowNumber: number;
  reason: string;
}

/**
 * Map one CSV row to a product, or to a rejection WITH A REASON.
 * (Final 100%, F-P2-52 — the old `mapCsvRow` returned bare `null`
 * for invalid rows, so the provider silently dropped them with no
 * reason at provider level; the intake review path surfaces its
 * own reasons, but a provider-level drop had none.)
 *
 * Rejection reasons:
 * - 'missing name' — no name/title/product_name value. A row
 *   without a name cannot become a product.
 * - 'invalid price "<raw>"' — a price value was supplied but is
 *   not a number (or is negative). The old code stored such rows
 *   as price 0, which is worse than a rejection: a $0 price is a
 *   fabricated price. A MISSING price still becomes 0 (existing
 *   behaviour — price is optional in a CSV feed).
 */
export function mapCsvRowWithReason(
  row: Record<string, string>,
  defaultRetailerSlug: string,
  rowNumber = 0
): { product: RawProductData | null; reason: string | null } {
  const get = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = row[key];
      if (value && value.trim()) return value.trim();
    }
    return undefined;
  };

  const externalId =
    get(['externalid', 'external_id', 'id', 'sku', 'productid', 'product_id']) ??
    `csv-${Math.random().toString(36).slice(2)}`;

  const name = get(['name', 'title', 'productname', 'product_name']);
  if (!name) return { product: null, reason: 'missing name (no name, title, or product_name value)' };

  const priceStr = get(['price', 'saleprice', 'sale_price', 'currentprice', 'current_price']);
  const price = priceStr ? parseFloat(priceStr.replace(/[^0-9.,-]/g, '').replace(',', '.')) : 0;
  if (priceStr !== undefined && (!Number.isFinite(price) || price < 0)) {
    return { product: null, reason: `invalid price "${priceStr}" (not a number, or negative)` };
  }
  const currency = get(['currency', 'currencycode', 'currency_code']) ?? 'USD';

  const imagesStr = get(['images', 'image', 'imageurl', 'image_url', 'imageurls']);
  const images = imagesStr
    ? imagesStr.split(/[|;,]/).map((s) => s.trim()).filter(Boolean)
    : undefined;

  return {
    product: {
      externalId,
      retailerSlug: get(['retailerslug', 'retailer_slug', 'retailer']) ?? defaultRetailerSlug,
      name,
      description: get(['description', 'productdescription', 'product_description']),
      brand: get(['brand', 'manufacturer']),
      category: get(['category', 'producttype', 'product_type']),
      gtin: get(['gtin', 'upc', 'ean', 'isbn']),
      images: images && images.length > 0 ? images : undefined,
      price: Number.isFinite(price) ? price : 0,
      currency,
      availability: normalizeAvailability(get(['availability', 'stockstatus', 'stock_status', 'instock', 'in_stock'])),
      url: get(['url', 'link', 'producturl', 'product_url']),
      raw: row as unknown as Record<string, unknown>,
    },
    reason: null,
  };
}


/**
 * Data provider that ingests product data from a CSV string or a CSV file URL.
 * The CSV must have a header row. Common column names are mapped to RawProductData
 * fields; unknown columns are preserved in the `raw` payload.
 */
export class CsvProvider implements DataProvider {
  readonly key = 'csv';
  readonly name = 'CSV Provider';
  readonly category = 'csv_import' as const;

  private readonly csvData: string | undefined;
  private readonly csvUrl: string | undefined;
  private readonly defaultRetailerSlug: string;
  private cachedProducts: RawProductData[] | null = null;
  /**
   * Final 100%, F-P2-52 — the rejections from the last load, with
   * per-row reasons. Empty before any load, and empty when nothing
   * was rejected. Callers (import summary, admin diagnostics) read
   * this after loadProducts/search/fetch instead of guessing why
   * the product count is lower than the row count.
   */
  private lastLoadRejections: CsvRowRejection[] = [];

  /** The rejections from the last load (see `lastLoadRejections`). */
  getLastLoadRejections(): CsvRowRejection[] {
    return [...this.lastLoadRejections];
  }

  constructor(options: {
    csv?: string;
    csvUrl?: string;
    defaultRetailerSlug?: string;
  }) {
    this.csvData = options.csv;
    // Section 20, §12 #58 — a blank URL is no source at all:
    // trim so whitespace-only config stays unavailable.
    this.csvUrl = options.csvUrl?.trim() || undefined;
    this.defaultRetailerSlug = options.defaultRetailerSlug ?? 'unknown';
  }

  isAvailable(): boolean {
    return Boolean(this.csvData || this.csvUrl);
  }

  /** Sections 21–25, Stage B (B2) — why the CSV provider cannot fetch. Null when available. */
  getNotConfiguredReason(): string | null {
    return this.isAvailable() ? null : CSV_NOT_CONFIGURED_REASON;
  }

  private async loadProducts(): Promise<RawProductData[]> {
    if (this.cachedProducts) return this.cachedProducts;

    let csv = this.csvData;

    if (!csv && this.csvUrl) {
      // Section 20, §12 #99 — a configured CSV URL is fetched
      // server-side, so it must pass the same SSRF guard as any
      // other user/config-supplied URL: http(s) only, and every
      // address it resolves to must be public. A private target
      // is refused before any fetch happens.
      //
      // Sections 21–25, Stage B (B1 + B6) — a refused or failed
      // fetch used to return [] (cached as a successful empty
      // parse), so callers read "no products" as if the feed had
      // been checked. It now THROWS a typed error, with a 10s
      // timeout and a 5 MB size cap on the response. Only a
      // successfully parsed document is cached.
      if (!(await isSafePublicImageUrl(this.csvUrl))) {
        throw new ProviderFetchError(
          'csv',
          `CSV URL failed the public-URL (SSRF) guard, refusing to fetch: ${this.csvUrl}`
        );
      }
      let response: Response;
      try {
        response = await fetch(this.csvUrl, {
          signal: AbortSignal.timeout(CSV_FETCH_TIMEOUT_MS),
        });
      } catch (error) {
        throw new ProviderFetchError(
          'csv',
          `CSV fetch failed (network error or 10s timeout): ${String(error)}`
        );
      }
      if (!response.ok) {
        throw new ProviderFetchError(
          'csv',
          `CSV fetch failed: HTTP ${response.status} ${response.statusText}`
        );
      }
      csv = await response.text();
      if (new TextEncoder().encode(csv).length > CSV_MAX_BYTES) {
        throw new ProviderFetchError(
          'csv',
          `CSV feed exceeds the ${CSV_MAX_BYTES / 1024 / 1024} MB size cap — refusing to parse`
        );
      }
    }

    if (!csv) {
      throw new ProviderNotConfiguredError('csv', CSV_NOT_CONFIGURED_REASON);
    }

    // Final 100%, F-P2-52 — parse via parseCsvDocument, NOT parseCsv:
    // parseCsv silently SKIPS rows with fewer columns than the
    // header, so a short row vanished with no reason at all. The
    // document parser keeps short rows (missing fields = ''), so
    // they flow into mapCsvRowWithReason and come back as a named
    // rejection instead of disappearing.
    const docRows = parseCsvDocument(csv);
    const products: RawProductData[] = [];
    const rejected: CsvRowRejection[] = [];
    for (const { row, rowNumber } of docRows) {
      const { product, reason } = mapCsvRowWithReason(row, this.defaultRetailerSlug, rowNumber);
      if (product) products.push(product);
      else if (reason) rejected.push({ rowNumber, reason });
    }
    this.lastLoadRejections = rejected;

    logger.debug('CsvProvider.loadProducts — parsed', {
      rowCount: docRows.length,
      productCount: products.length,
      rejectedCount: rejected.length,
      rejected: rejected.slice(0, 10),
    });

    this.cachedProducts = products;
    return products;
  }

  async search(request: ProviderSearchRequest): Promise<RawProductData[]> {
    // Sections 21–25, Stage B (B1) — was a silent [] when
    // unconfigured. Throwing names the missing source instead.
    if (!this.isAvailable()) {
      throw new ProviderNotConfiguredError('csv', CSV_NOT_CONFIGURED_REASON);
    }

    const products = await this.loadProducts();

    const query = request.query.trim().toLowerCase();
    const retailerSlug = request.retailerSlug?.trim().toLowerCase();

    let results = products;

    if (retailerSlug) {
      results = results.filter(
        (p) => p.retailerSlug.toLowerCase() === retailerSlug,
      );
    }

    if (query) {
      results = results.filter((p) => {
        const haystack = [p.name, p.description ?? '', p.brand ?? '', p.category ?? '']
          .join(' ')
          .toLowerCase();
        return query.split(/\s+/).every((term) => haystack.includes(term));
      });
    }

    if (typeof request.limit === 'number' && request.limit > 0) {
      results = results.slice(0, request.limit);
    }

    return results;
  }

  async fetch(request: ProviderFetchRequest): Promise<RawProductData | null> {
    // Sections 21–25, Stage B (B1) — was a silent null when
    // unconfigured. Throwing names the missing source instead.
    if (!this.isAvailable()) {
      throw new ProviderNotConfiguredError('csv', CSV_NOT_CONFIGURED_REASON);
    }

    const products = await this.loadProducts();

    return (
      products.find(
        (p) =>
          p.externalId === request.externalId &&
          p.retailerSlug.toLowerCase() === request.retailerSlug.toLowerCase(),
      ) ?? null
    );
  }
}
