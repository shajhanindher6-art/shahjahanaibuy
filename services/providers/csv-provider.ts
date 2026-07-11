import { logger } from '@/lib/config/logger';
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
 * Parses a full CSV document into a list of row objects keyed by the header row.
 * Rows that are empty or have fewer columns than the header are skipped.
 */
function parseCsv(csv: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];

  const normalized = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines: string[] = [];
  let buffer = '';
  let inQuotes = false;

  for (const char of normalized) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === '\n' && !inQuotes) {
      lines.push(buffer);
      buffer = '';
    } else {
      buffer += char;
    }
  }
  if (buffer.trim()) lines.push(buffer);

  if (lines.length === 0) return rows;

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCsvLine(lines[i]);
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
    this.csvUrl = options.csvUrl;
    this.defaultRetailerSlug = options.defaultRetailerSlug ?? 'unknown';
  }

  isAvailable(): boolean {
    return Boolean(this.csvData || this.csvUrl);
  }

  private async loadProducts(): Promise<RawProductData[]> {
    if (this.cachedProducts) return this.cachedProducts;

    let csv = this.csvData;

    if (!csv && this.csvUrl) {
      try {
        const response = await fetch(this.csvUrl);
        if (!response.ok) {
          logger.error('CsvProvider.loadProducts — fetch failed', {
            status: response.status,
            statusText: response.statusText,
          });
          this.cachedProducts = [];
          return [];
        }
        csv = await response.text();
      } catch (error) {
        logger.error('CsvProvider.loadProducts — fetch error', { error: String(error) });
        this.cachedProducts = [];
        return [];
      }
    }

    if (!csv) {
      this.cachedProducts = [];
      return [];
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
    if (!this.isAvailable()) {
      logger.debug('CsvProvider.search — provider unavailable, returning empty');
      return [];
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
    if (!this.isAvailable()) {
      logger.debug('CsvProvider.fetch — provider unavailable, returning null');
      return null;
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
