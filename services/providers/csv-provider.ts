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
 * Unlike {@link parseCsv} (used by CsvProvider), rows with fewer columns
 * than the header are NOT dropped — their missing fields come back as
 * empty strings so the caller can report a per-row, per-field error
 * instead of silently losing the row.
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

/**
 * Parses a full CSV document into a list of row objects keyed by the header row.
 * Rows that are empty or have fewer columns than the header are skipped.
 */
function parseCsv(csv: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];

  const lines = splitCsvLines(csv);

  if (lines.length === 0) return rows;

  const headers = parseCsvLine(lines[0].text).map((h) => h.toLowerCase());

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].text.trim()) continue;
    const values = parseCsvLine(lines[i].text);
    if (values.length < headers.length) continue;

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    rows.push(row);
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

function mapCsvRow(row: Record<string, string>, defaultRetailerSlug: string): RawProductData | null {
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
  if (!name) return null;

  const priceStr = get(['price', 'saleprice', 'sale_price', 'currentprice', 'current_price']);
  const price = priceStr ? parseFloat(priceStr.replace(/[^0-9.,-]/g, '').replace(',', '.')) : 0;
  const currency = get(['currency', 'currencycode', 'currency_code']) ?? 'USD';

  const imagesStr = get(['images', 'image', 'imageurl', 'image_url', 'imageurls']);
  const images = imagesStr
    ? imagesStr.split(/[|;,]/).map((s) => s.trim()).filter(Boolean)
    : undefined;

  return {
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

    const rows = parseCsv(csv);
    const products = rows
      .map((row) => mapCsvRow(row, this.defaultRetailerSlug))
      .filter((p): p is RawProductData => p !== null);

    logger.debug('CsvProvider.loadProducts — parsed', {
      rowCount: rows.length,
      productCount: products.length,
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
