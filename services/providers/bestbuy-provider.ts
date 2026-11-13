import { env } from '@/lib/config/env';
import { logger } from '@/lib/config/logger';
import { validateGtin } from '@/lib/gtin';
import { ProviderFetchError, ProviderNotConfiguredError } from './errors';
import type {
  DataProvider,
  ProviderFetchRequest,
  ProviderSearchRequest,
  RawProductData,
} from './types';

/**
 * Final Real Data Completion — Best Buy Products API client (SERVER-ONLY).
 *
 * The first Best Buy client: the Section 20 scaffolding was a
 * fail-closed stub (no client existed). This file is the real
 * client against the official Best Buy Products API
 * (https://bestbuyapis.github.io/api-documentation/ — read
 * 2026-11-13; spec in the build brief):
 *
 *   - Read-only catalogue: search / fetch by SKU / search by UPC
 *     / search by model number. No ordering (Commerce API is
 *     invite-only and not needed).
 *   - Auth: free key via email signup at developer.bestbuy.com,
 *     sent as the `apiKey` query parameter. No token, no expiry,
 *     no refresh. The key comes only from `env.bestbuyApiKey`
 *     (BESTBUY_API_KEY in the hosting dashboard) and is NEVER
 *     logged — because the key travels in the query string, the
 *     full request URL is never logged either.
 *   - Limits (terms): 5 calls/second, 50,000/day. Over-limit
 *     answers 403. The client paces itself with a 200ms minimum
 *     gap between calls; the daily budget is enforced by the
 *     shared call guard (services/provider-budget.ts: bestbuy
 *     defaults to 50,000/day).
 *   - Terms: responses may be cached max 72 hours; attribution
 *     + Best Buy logo required on surfaces that show the data;
 *     response links (click/addToCart URLs) expire in 7 days.
 *
 * ENV-GATED, OFF BY DEFAULT: without the key every call throws
 * ProviderNotConfiguredError — never a fake row, never a
 * scraped page. Prices are Best Buy's catalogue prices at call
 * time (salePrice, or regularPrice when the sale price is
 * display-restricted by MAP/ICR), so they carry no price
 * history and no Deal Score until the pipeline records them.
 *
 * GTIN: only the feed's structured `upc` field, GS1-validated
 * (lib/gtin.ts). An invalid UPC is recorded as missing, never
 * guessed from the title or invented.
 *
 * HOST FIXED: only https://api.bestbuy.com — never built from
 * user input (SSRF rule; same shape as services/ebay-browse.ts).
 */

export const BESTBUY_NOT_CONFIGURED_REASON =
  'Best Buy has no live price integration: no API key is configured (BESTBUY_API_KEY is unset). The client is built, but without the free key from developer.bestbuy.com it fetches nothing — never a fake price.';

const BESTBUY_API_BASE = 'https://api.bestbuy.com';
const BESTBUY_FETCH_TIMEOUT_MS = 10_000;
/** 5 calls/second → minimum 200ms between calls, in-process. */
const BESTBUY_MIN_CALL_GAP_MS = 200;
/** Search pageSize: spec caps the first phase at 10 (API max is 100). */
const BESTBUY_SEARCH_PAGE_SIZE = 10;
/** Oversize guard: a single Best Buy response larger than this is rejected, never parsed. */
const BESTBUY_MAX_RESPONSE_BYTES = 5_000_000;

/**
 * `show=` field list (spec §2): everything the pipeline maps,
 * nothing it does not. `details.name,details.value` carry the
 * spec table; `categoryPath.name` the category; `active` lets an
 * inactive SKU be treated as not-found instead of an error.
 */
const BESTBUY_SHOW_FIELDS = [
  'sku',
  'name',
  'manufacturer',
  'modelNumber',
  'upc',
  'salePrice',
  'regularPrice',
  'priceUpdateDate',
  'priceRestriction',
  'onlineAvailability',
  'inStoreAvailability',
  'orderable',
  'description',
  'shortDescription',
  'image',
  'largeImage',
  'mediumImage',
  'thumbnailImage',
  'url',
  'details.name',
  'details.value',
  'categoryPath.name',
  'active',
].join(',');

type FetchFn = typeof fetch;

export interface BestBuyProviderOptions {
  /** Test-only fetch override; production always uses the global fetch. */
  fetchFn?: FetchFn;
}

/** In-process throttle state: timestamp (ms) of the last call started. */
let lastCallAtMs = 0;

/** Test-only: drop the throttle so tests stay independent. */
export function resetBestBuyThrottleForTests(): void {
  lastCallAtMs = 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until 200ms have passed since the previous call, then mark this call. */
async function waitForThrottle(): Promise<void> {
  const now = Date.now();
  const waitMs = lastCallAtMs + BESTBUY_MIN_CALL_GAP_MS - now;
  if (waitMs > 0) await sleep(waitMs);
  lastCallAtMs = Date.now();
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asFiniteNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * Best Buy returns `categoryPath` as an array of { id, name }
 * (most specific last) — take the last name. An object form is
 * tolerated defensively. Anything else is "no category", never
 * invented.
 */
function extractCategoryPathName(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) {
      const entry = value[i];
      if (entry && typeof entry === 'object') {
        const name = asNonEmptyString((entry as Record<string, unknown>).name);
        if (name) return name;
      }
    }
    return null;
  }
  if (value && typeof value === 'object') {
    return asNonEmptyString((value as Record<string, unknown>).name);
  }
  return null;
}

/** `details` is an array of { name, value } — keep exactly what the feed carries. */
function extractSpecs(value: unknown): Array<{ key: string; value: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const specs: Array<{ key: string; value: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const key = asNonEmptyString(row.name);
    if (!key) continue;
    const rawValue = row.value;
    let text: string | null = null;
    if (typeof rawValue === 'string') text = rawValue.trim() === '' ? null : rawValue.trim();
    else if (typeof rawValue === 'number' || typeof rawValue === 'boolean') text = String(rawValue);
    else if (Array.isArray(rawValue)) {
      const parts = rawValue
        .map((part) => (typeof part === 'string' ? part.trim() : typeof part === 'number' ? String(part) : ''))
        .filter((part) => part !== '');
      text = parts.length > 0 ? parts.join(', ') : null;
    }
    if (text === null) continue;
    specs.push({ key, value: text });
  }
  return specs.length > 0 ? specs : undefined;
}

function extractImages(row: Record<string, unknown>): string[] | undefined {
  const seen = new Set<string>();
  const images: string[] = [];
  for (const field of ['image', 'largeImage', 'mediumImage', 'thumbnailImage']) {
    const value = asNonEmptyString(row[field]);
    if (value && !seen.has(value)) {
      seen.add(value);
      images.push(value);
    }
  }
  return images.length > 0 ? images : undefined;
}

/**
 * Map one Best Buy product object to RawProductData. Returns null
 * when the row cannot honestly become a product: no SKU, no name,
 * an inactive SKU, or no displayable price. A MAP/ICR-restricted
 * sale price is NEVER the recorded price — the regular (list)
 * price is used instead and the restriction is recorded in `raw`
 * for the display layer; when even that is missing the row is
 * skipped rather than recorded with a price it must not show.
 */
function toRawProduct(item: unknown): RawProductData | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;

  // Inactive SKUs are not-found, not an error (spec §2).
  if (row.active === false) return null;

  const sku = typeof row.sku === 'string' || typeof row.sku === 'number' ? String(row.sku).trim() : '';
  const name = asNonEmptyString(row.name);
  if (sku === '' || !name) return null;

  const priceRestriction = asNonEmptyString(row.priceRestriction);
  const salePrice = asFiniteNonNegativeNumber(row.salePrice);
  const regularPrice = asFiniteNonNegativeNumber(row.regularPrice);
  // Restricted sale price must not be shown as the sale price:
  // fall back to the list price; without one there is no honest price.
  const price = priceRestriction !== null ? regularPrice : salePrice ?? regularPrice;
  if (price === null) return null;

  const onlineAvailability = asBoolean(row.onlineAvailability);
  // `orderable` is boolean in the docs' attribute table, but the
  // feed has also been seen returning the string "Available" —
  // accept both, so a genuinely orderable product is never read
  // as out of stock because of a type surprise.
  const orderable =
    row.orderable === true ||
    (typeof row.orderable === 'string' && row.orderable.trim().toLowerCase() === 'available');
  const availability =
    onlineAvailability === true
      ? 'in_stock'
      : orderable
        ? 'limited'
        : onlineAvailability === false
          ? 'out_of_stock'
          : 'unknown';

  const gtinCheck =
    typeof row.upc === 'string' || typeof row.upc === 'number'
      ? validateGtin(String(row.upc))
      : { valid: false as const, normalized: null };
  const modelNumber = asNonEmptyString(row.modelNumber);
  const description = asNonEmptyString(row.description) ?? asNonEmptyString(row.shortDescription);

  const raw: Record<string, unknown> = { sku };
  if (regularPrice !== null) raw.regularPrice = regularPrice;
  if (salePrice !== null) raw.salePrice = salePrice;
  const priceUpdateDate = asNonEmptyString(row.priceUpdateDate);
  if (priceUpdateDate) raw.priceUpdateDate = priceUpdateDate;
  if (priceRestriction !== null) raw.priceRestriction = priceRestriction;
  if (onlineAvailability !== null) raw.onlineAvailability = onlineAvailability;
  if (asBoolean(row.inStoreAvailability) !== null) raw.inStoreAvailability = row.inStoreAvailability;
  raw.orderable = orderable;

  const product: RawProductData = {
    externalId: sku,
    retailerSlug: 'bestbuy',
    name,
    price,
    currency: 'USD',
    availability,
    raw,
  };
  const brand = asNonEmptyString(row.manufacturer);
  if (brand) product.brand = brand;
  const category = extractCategoryPathName(row.categoryPath);
  if (category) product.category = category;
  if (gtinCheck.valid && gtinCheck.normalized) product.gtin = gtinCheck.normalized;
  if (modelNumber) product.modelNumber = modelNumber;
  if (description) product.description = description;
  const images = extractImages(row);
  if (images) product.images = images;
  const url = asNonEmptyString(row.url);
  if (url) product.url = url;
  const specs = extractSpecs(row.details);
  if (specs) product.specs = specs;
  return product;
}

export class BestBuyProvider implements DataProvider {
  readonly key = 'bestbuy';
  readonly name = 'Best Buy';
  readonly category = 'official_api' as const;

  private readonly fetchFn: FetchFn | undefined;

  constructor(options?: BestBuyProviderOptions) {
    this.fetchFn = options?.fetchFn;
  }

  isAvailable(): boolean {
    return Boolean(env.bestbuyApiKey?.trim());
  }

  /** Plain-language reason the adapter cannot fetch prices today; null when it can. */
  getNotConfiguredReason(): string | null {
    if (this.isAvailable()) return null;
    return BESTBUY_NOT_CONFIGURED_REASON;
  }

  private getApiKey(): string | null {
    const key = env.bestbuyApiKey?.trim();
    return key ? key : null;
  }

  private resolveFetch(): FetchFn {
    return this.fetchFn ?? fetch;
  }

  /**
   * One guarded Best Buy call: throttle first, then fetch with a
   * 10s timeout. Returns the parsed JSON body. HTTP ≠ 200, a
   * network throw, malformed JSON and oversize bodies all become
   * ProviderFetchError — except a fetch 404, which is "SKU not
   * found" and returns null to the caller. The request URL (which
   * carries the key in its query string) is NEVER logged.
   */
  private async callBestBuy(url: string, op: string): Promise<unknown | null> {
    const fetchFn = this.resolveFetch();
    await waitForThrottle();
    let response: Response;
    try {
      response = await fetchFn(url, { signal: AbortSignal.timeout(BESTBUY_FETCH_TIMEOUT_MS) });
    } catch (err) {
      logger.warn('bestbuy: request threw', { op, error: String(err) });
      throw new ProviderFetchError('bestbuy', `Best Buy request failed (${op}): network error or timeout`);
    }
    if (response.status === 404 && op === 'fetch') {
      return null;
    }
    if (!response.ok) {
      // Over-limit answers 403 (terms: 5 calls/second, 50,000/day);
      // a bad key also answers 403 — either way the key is never logged.
      logger.warn('bestbuy: request failed', { op, status: response.status });
      throw new ProviderFetchError('bestbuy', `Best Buy request failed (HTTP ${response.status})`);
    }
    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      logger.warn('bestbuy: response body unreadable', { op, error: String(err) });
      throw new ProviderFetchError('bestbuy', `Best Buy request failed (${op}): response body unreadable`);
    }
    if (text.length > BESTBUY_MAX_RESPONSE_BYTES) {
      logger.warn('bestbuy: response oversize', { op, bytes: text.length });
      throw new ProviderFetchError('bestbuy', `Best Buy request failed (${op}): response too large`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      logger.warn('bestbuy: response was not JSON', { op });
      throw new ProviderFetchError('bestbuy', `Best Buy request failed (${op}): response was not JSON`);
    }
  }

  private buildSearchUrl(attributeQuery: string, limit: number, apiKey: string): string {
    const url = new URL(`${BESTBUY_API_BASE}/v1/products(${attributeQuery})`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('show', BESTBUY_SHOW_FIELDS);
    url.searchParams.set('pageSize', String(limit));
    url.searchParams.set('apiKey', apiKey);
    return url.toString();
  }

  private async runSearch(attributeQuery: string, limit: number): Promise<RawProductData[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ProviderNotConfiguredError('bestbuy', this.getNotConfiguredReason() ?? BESTBUY_NOT_CONFIGURED_REASON);
    }
    const clampedLimit = Math.min(Math.max(limit, 1), BESTBUY_SEARCH_PAGE_SIZE);
    const url = this.buildSearchUrl(attributeQuery, clampedLimit, apiKey);
    const data = await this.callBestBuy(url, 'search');
    if (!data || typeof data !== 'object') {
      throw new ProviderFetchError('bestbuy', 'Best Buy request failed (search): response was not JSON');
    }
    const products = (data as Record<string, unknown>).products;
    if (!Array.isArray(products)) {
      throw new ProviderFetchError('bestbuy', 'Best Buy request failed (search): response has no products list');
    }
    const mapped: RawProductData[] = [];
    for (const item of products) {
      const product = toRawProduct(item);
      if (product) mapped.push(product);
    }
    return mapped;
  }

  /**
   * Keyword search: `products(search={query})`. A blank query is
   * an empty result, not a call — Best Buy has nothing to search
   * for, and no budget is spent on it.
   */
  async search(request: ProviderSearchRequest): Promise<RawProductData[]> {
    const query = typeof request.query === 'string' ? request.query.trim() : '';
    if (query === '') return [];
    if (!this.isAvailable()) {
      throw new ProviderNotConfiguredError('bestbuy', this.getNotConfiguredReason() ?? BESTBUY_NOT_CONFIGURED_REASON);
    }
    return this.runSearch(`search=${encodeURIComponent(query)}`, request.limit ?? BESTBUY_SEARCH_PAGE_SIZE);
  }

  /**
   * Search by UPC (GTIN match — the strongest verification path
   * for the 50-product catalog). An invalid GTIN can never match,
   * so it returns [] without spending a call.
   */
  async searchByUpc(upc: string, limit = BESTBUY_SEARCH_PAGE_SIZE): Promise<RawProductData[]> {
    const check = validateGtin(upc);
    if (!check.valid || !check.normalized) return [];
    if (!this.isAvailable()) {
      throw new ProviderNotConfiguredError('bestbuy', this.getNotConfiguredReason() ?? BESTBUY_NOT_CONFIGURED_REASON);
    }
    return this.runSearch(`upc=${encodeURIComponent(check.normalized)}`, limit);
  }

  /**
   * Search by manufacturer model number — the fallback when a
   * product has no UPC. A blank model number is an empty result,
   * not a call.
   */
  async searchByModel(modelNumber: string, limit = BESTBUY_SEARCH_PAGE_SIZE): Promise<RawProductData[]> {
    const model = typeof modelNumber === 'string' ? modelNumber.trim() : '';
    if (model === '') return [];
    if (!this.isAvailable()) {
      throw new ProviderNotConfiguredError('bestbuy', this.getNotConfiguredReason() ?? BESTBUY_NOT_CONFIGURED_REASON);
    }
    return this.runSearch(`modelNumber=${encodeURIComponent(model)}`, limit);
  }

  /**
   * Fetch one SKU: `products/{sku}.json`. A 404 or an inactive
   * SKU is "not found" (null), not an error — the pipeline
   * already treats null that way.
   */
  async fetch(request: ProviderFetchRequest): Promise<RawProductData | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ProviderNotConfiguredError('bestbuy', this.getNotConfiguredReason() ?? BESTBUY_NOT_CONFIGURED_REASON);
    }
    const sku = typeof request.externalId === 'string' ? request.externalId.trim() : '';
    if (sku === '') return null;
    const url = new URL(`${BESTBUY_API_BASE}/v1/products/${encodeURIComponent(sku)}.json`);
    url.searchParams.set('show', BESTBUY_SHOW_FIELDS);
    url.searchParams.set('apiKey', apiKey);
    const data = await this.callBestBuy(url.toString(), 'fetch');
    if (data === null) return null;
    if (!data || typeof data !== 'object') {
      throw new ProviderFetchError('bestbuy', 'Best Buy request failed (fetch): response was not JSON');
    }
    // The single-item endpoint returns the product object; tolerate
    // a wrapped `{ products: [...] }` shape defensively.
    const body = data as Record<string, unknown>;
    const item = Array.isArray(body.products) ? body.products[0] : data;
    return toRawProduct(item);
  }
}
