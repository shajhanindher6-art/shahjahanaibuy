import { constants as cryptoConstants, createPrivateKey, sign as cryptoSign } from 'node:crypto';
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
 * Retailers Delta — Walmart Affiliate API v2 client (SERVER-ONLY).
 *
 * The second official-API adapter, same shape as
 * services/providers/bestbuy-provider.ts: fail-closed without
 * credentials, 10s timeout, oversize guard, in-process throttle,
 * GS1-validated GTIN only, key material never logged.
 *
 * API SURFACE — verified 2026-11-15 from Walmart's own docs and
 * the walmart.io portal (see sources at the end of this header):
 *
 *   - Host: https://developer.api.walmart.com
 *   - Base: /api-proxy/service/affil/product/v2
 *   - Search: GET {base}/search?query=...&numItems=N
 *     (query required; numItems default 10, max 25; optional
 *     start / sort / order / responseGroup=base|full / facet).
 *   - Item lookup: GET {base}/items/{itemId}.
 *   - Rate limit (affiliate terms): 5,000 calls/day.
 *
 * AUTH — RSA-SHA256, NOT an API key. The current Affiliate v2
 * API has no plain-key auth (the old api.walmart.com/v1
 * `?apiKey=` Open API was deprecated ~2020). Setup: generate an
 * RSA key pair, upload the PUBLIC key in the walmart.io portal,
 * receive a Consumer ID. Every request carries:
 *   WM_CONSUMER.ID          — the Consumer ID (UUID)
 *   WM_CONSUMER.INTIMESTAMP — Unix timestamp, milliseconds
 *   WM_SEC.KEY_VERSION      — key version, typically "1"
 *   WM_SEC.AUTH_SIGNATURE   — base64 RSA-SHA256 signature of the
 *     canonicalized headers (see buildWalmartAuthHeaders)
 * A signature older than 180 seconds is rejected, so one is
 * signed fresh per request.
 *
 * ENV (only vars the docs require — there is NO WALMART_API_KEY
 * on this API; do not add one):
 *   WALMART_CONSUMER_ID  — Consumer ID from walmart.io
 *   WALMART_PRIVATE_KEY  — RSA private key, PEM. In Vercel store
 *     it with literal \n sequences; they are converted back to
 *     newlines here. Never logged, never returned.
 *   WALMART_KEY_VERSION  — optional, default "1".
 *
 * ENV-GATED, OFF BY DEFAULT: without both credentials every call
 * throws ProviderNotConfiguredError — never a fake row, never a
 * scraped page.
 *
 * RESPONSE MAPPING — BEST-DOCUMENTED SHAPE, NOT VERIFIED LIVE:
 * the walmart.io docs render only through the portal's script
 * (no OpenAPI / llms.txt / Markdown), so the v2 response field
 * names below come from the v1-era field description
 * (developer.walmartlabs.com, Item Field Description) and
 * independent v2 clients (permission-slip walmart connector,
 * Grocify quickstart), NOT from a readable Walmart v2 spec.
 * Every mapped field is therefore read defensively and marked
 * UNVERIFIED below; a field the live API does not return is
 * simply absent, never invented. The FIRST live call (owner key
 * + one search) must confirm the field names before any price
 * from Walmart is trusted for ingestion.
 * Verified from those sources: items[] with itemId, name,
 * salePrice, msrp, upc, categoryPath, longDescription,
 * thumbnailImage, productUrl, availableOnline, addToCartUrl,
 * customerRating, numReviews.
 *
 * MAP: no MAP/restriction field is documented for the affiliate
 * search response (unlike Best Buy's priceRestriction), so no
 * MAP fallback is applied here: price = salePrice ?? msrp, and
 * msrp is recorded in `raw` so the display layer can show a
 * strike-through. If the live API turns out to carry a
 * restriction field, this mapper must learn it before ingestion.
 *
 * SOURCES (2026-11-15):
 * - developer.walmart.com — Affiliate API auth + Marketplace
 *   Item Search reference (host, RSA signing, rate limits).
 * - anchorterminal.com/tools/walmart-affiliate-api — endpoint,
 *   search params, 5,000/day, RSA headers, 180s validity.
 * - github.com/sanpdy/Grocify — affiliate quickstart, header
 *   canonicalization + signing flow.
 * - github.com/supersuit-tech/permission-slip — v2 connector,
 *   search/items endpoints, response field names.
 * - developer.walmartlabs.com (via walmartAPI R package) —
 *   base response fields (itemId, salePrice, msrp, upc, …).
 */

export const WALMART_NOT_CONFIGURED_REASON =
  'Walmart has no live price integration: no affiliate credentials are configured (WALMART_CONSUMER_ID + WALMART_PRIVATE_KEY are unset). The client is built, but without the RSA key pair from walmart.io it fetches nothing — never a fake price.';

const WALMART_API_BASE = 'https://developer.api.walmart.com/api-proxy/service/affil/product/v2';
const WALMART_FETCH_TIMEOUT_MS = 10_000;
/** Affiliate terms: 5,000 calls/day — paced in-process like Best Buy's 200ms gap. */
const WALMART_MIN_CALL_GAP_MS = 200;
/** Affiliate search: numItems default 10, max 25. */
const WALMART_SEARCH_PAGE_SIZE = 10;
const WALMART_SEARCH_MAX_ITEMS = 25;
/** Oversize guard: a single Walmart response larger than this is rejected, never parsed. */
const WALMART_MAX_RESPONSE_BYTES = 5_000_000;

type FetchFn = typeof fetch;

export interface WalmartProviderOptions {
  /** Test-only fetch override; production always uses the global fetch. */
  fetchFn?: FetchFn;
}

/** In-process throttle state: timestamp (ms) of the last call started. */
let lastCallAtMs = 0;

/** Test-only: drop the throttle so tests stay independent. */
export function resetWalmartThrottleForTests(): void {
  lastCallAtMs = 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until 200ms have passed since the previous call, then mark this call. */
async function waitForThrottle(): Promise<void> {
  const now = Date.now();
  const waitMs = lastCallAtMs + WALMART_MIN_CALL_GAP_MS - now;
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
 * Canonical string for the RSA signature (affiliate API):
 * the three header values in sorted header-name order
 * (WM_CONSUMER.ID, WM_CONSUMER.INTIMESTAMP, WM_SEC.KEY_VERSION),
 * each followed by "\n". Verified against the Grocify affiliate
 * quickstart and the copyprogramming signing guide; the walmart.io
 * docs themselves are not machine-readable, so the FIRST live call
 * must confirm the signature is accepted (a 401 then means the
 * canonicalization differs, not that the key is wrong).
 */
export function buildWalmartCanonicalString(
  consumerId: string,
  timestampMs: number,
  keyVersion: string,
): string {
  const headers: Record<string, string> = {
    'WM_CONSUMER.ID': consumerId,
    'WM_CONSUMER.INTIMESTAMP': String(timestampMs),
    'WM_SEC.KEY_VERSION': keyVersion,
  };
  return Object.keys(headers)
    .sort()
    .map((name) => `${headers[name].trim()}\n`)
    .join('');
}

/**
 * Sign one request's auth headers. Exported for tests (the
 * signature is verifiable with the public key — no live call
 * needed). Throws ProviderNotConfiguredError when the private
 * key is not a parseable RSA PEM — a config problem, never a
 * fetch error (retrying a bad key cannot succeed). The key
 * material is never logged.
 */
export function buildWalmartAuthHeaders(
  consumerId: string,
  privateKeyPem: string,
  keyVersion = '1',
  nowMs: number = Date.now(),
): Record<string, string> {
  const timestampMs = nowMs;
  const canonical = buildWalmartCanonicalString(consumerId, timestampMs, keyVersion);
  let signature: string;
  try {
    // Vercel env vars often store a PEM with literal \n sequences.
    const pem = privateKeyPem.replace(/\\n/g, '\n');
    const key = createPrivateKey(pem);
    signature = cryptoSign('sha256', Buffer.from(canonical, 'utf8'), {
      key,
      padding: cryptoConstants.RSA_PKCS1_PADDING,
    }).toString('base64');
  } catch {
    throw new ProviderNotConfiguredError(
      'walmart',
      'Walmart private key is not a valid RSA private key (WALMART_PRIVATE_KEY must be the PEM from walmart.io).',
    );
  }
  return {
    'WM_CONSUMER.ID': consumerId,
    'WM_CONSUMER.INTIMESTAMP': String(timestampMs),
    'WM_SEC.KEY_VERSION': keyVersion,
    'WM_SEC.AUTH_SIGNATURE': signature,
  };
}

/**
 * Map one Walmart affiliate item to RawProductData. Returns null
 * when the row cannot honestly become a product: no itemId, no
 * name, or no displayable price. All field names are the
 * best-documented v2 shape (see header) — UNVERIFIED against a
 * live v2 response; an absent field is missing, never invented.
 */
function toRawProduct(item: unknown): RawProductData | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;

  const itemId =
    typeof row.itemId === 'string' || typeof row.itemId === 'number'
      ? String(row.itemId).trim()
      : '';
  const name = asNonEmptyString(row.name);
  if (itemId === '' || !name) return null;

  const salePrice = asFiniteNonNegativeNumber(row.salePrice);
  const msrp = asFiniteNonNegativeNumber(row.msrp);
  const price = salePrice ?? msrp;
  if (price === null) return null;

  const availableOnline = asBoolean(row.availableOnline);
  const availability =
    availableOnline === true
      ? 'in_stock'
      : availableOnline === false
        ? 'out_of_stock'
        : 'unknown';

  const gtinCheck =
    typeof row.upc === 'string' || typeof row.upc === 'number'
      ? validateGtin(String(row.upc))
      : { valid: false as const, normalized: null };
  // UNVERIFIED field names (defensive reads only): the v1-era
  // field list carries no brand field; brandName / manufacturer
  // are accepted when present, never guessed from the title.
  const brand = asNonEmptyString(row.brandName) ?? asNonEmptyString(row.manufacturer) ?? asNonEmptyString(row.brand);
  // UNVERIFIED: v1 carries categoryPath as a string; tolerate
  // the Best Buy-style array defensively.
  const category =
    asNonEmptyString(row.categoryPath) ??
    (Array.isArray(row.categoryPath)
      ? (() => {
          for (let i = row.categoryPath.length - 1; i >= 0; i--) {
            const entry = row.categoryPath[i];
            if (entry && typeof entry === 'object') {
              const entryName = asNonEmptyString((entry as Record<string, unknown>).name);
              if (entryName) return entryName;
            }
          }
          return null;
        })()
      : null);
  const description = asNonEmptyString(row.longDescription) ?? asNonEmptyString(row.shortDescription);

  const raw: Record<string, unknown> = { itemId };
  if (msrp !== null) raw.msrp = msrp;
  if (salePrice !== null) raw.salePrice = salePrice;
  if (availableOnline !== null) raw.availableOnline = availableOnline;
  const addToCartUrl = asNonEmptyString(row.addToCartUrl);
  if (addToCartUrl) raw.addToCartUrl = addToCartUrl;
  const customerRating = asFiniteNonNegativeNumber(row.customerRating);
  if (customerRating !== null) raw.customerRating = customerRating;
  const numReviews = asFiniteNonNegativeNumber(row.numReviews);
  if (numReviews !== null) raw.numReviews = numReviews;

  const product: RawProductData = {
    externalId: itemId,
    retailerSlug: 'walmart',
    name,
    price,
    // Affiliate API is US-only; prices are USD unless the feed
    // says otherwise (no currency field is documented).
    currency: 'USD',
    availability,
    raw,
  };
  if (brand) product.brand = brand;
  if (category) product.category = category;
  if (gtinCheck.valid && gtinCheck.normalized) product.gtin = gtinCheck.normalized;
  if (description) product.description = description;
  const images: string[] = [];
  for (const field of ['thumbnailImage', 'mediumImage', 'largeImage']) {
    const value = asNonEmptyString(row[field]);
    if (value && !images.includes(value)) images.push(value);
  }
  if (images.length > 0) product.images = images;
  const url = asNonEmptyString(row.productUrl);
  if (url) product.url = url;
  return product;
}

export class WalmartProvider implements DataProvider {
  readonly key = 'walmart';
  readonly name = 'Walmart';
  readonly category = 'official_api' as const;

  private readonly fetchFn: FetchFn | undefined;

  constructor(options?: WalmartProviderOptions) {
    this.fetchFn = options?.fetchFn;
  }

  isAvailable(): boolean {
    return Boolean(env.walmartConsumerId?.trim()) && Boolean(env.walmartPrivateKey?.trim());
  }

  /** Plain-language reason the adapter cannot fetch prices today; null when it can. */
  getNotConfiguredReason(): string | null {
    if (this.isAvailable()) return null;
    return WALMART_NOT_CONFIGURED_REASON;
  }

  private getCredentials(): { consumerId: string; privateKey: string; keyVersion: string } | null {
    const consumerId = env.walmartConsumerId?.trim();
    const privateKey = env.walmartPrivateKey?.trim();
    if (!consumerId || !privateKey) return null;
    return { consumerId, privateKey, keyVersion: env.walmartKeyVersion?.trim() || '1' };
  }

  private resolveFetch(): FetchFn {
    return this.fetchFn ?? fetch;
  }

  /**
   * One guarded Walmart call: throttle first, then fetch with a
   * 10s timeout and a fresh RSA signature per request (a
   * signature older than 180s is rejected). Returns the parsed
   * JSON body. HTTP ≠ 200, a network throw, malformed JSON and
   * oversize bodies all become ProviderFetchError — except a
   * fetch 404, which is "item not found" and returns null.
   * No credential material is ever logged.
   */
  private async callWalmart(url: string, op: string): Promise<unknown | null> {
    const credentials = this.getCredentials();
    if (!credentials) {
      throw new ProviderNotConfiguredError('walmart', this.getNotConfiguredReason() ?? WALMART_NOT_CONFIGURED_REASON);
    }
    const fetchFn = this.resolveFetch();
    await waitForThrottle();
    let headers: Record<string, string>;
    try {
      headers = buildWalmartAuthHeaders(
        credentials.consumerId,
        credentials.privateKey,
        credentials.keyVersion,
      );
    } catch (err) {
      // A bad key is a config error — already a typed
      // ProviderNotConfiguredError from the signer; re-throw it
      // unchanged so callers see NOT_CONFIGURED, not a fetch error.
      if (err instanceof ProviderNotConfiguredError) throw err;
      throw new ProviderNotConfiguredError('walmart', WALMART_NOT_CONFIGURED_REASON);
    }
    let response: Response;
    try {
      response = await fetchFn(url, { headers, signal: AbortSignal.timeout(WALMART_FETCH_TIMEOUT_MS) });
    } catch (err) {
      logger.warn('walmart: request threw', { op, error: String(err) });
      throw new ProviderFetchError('walmart', `Walmart request failed (${op}): network error or timeout`);
    }
    if (response.status === 404 && op === 'fetch') {
      return null;
    }
    if (!response.ok) {
      // 401/403 = bad credentials or a rejected signature (the
      // canonicalization may differ from the live API — see the
      // header note); 429 = the 5,000/day budget. Either way no
      // credential material is ever logged.
      logger.warn('walmart: request failed', { op, status: response.status });
      throw new ProviderFetchError('walmart', `Walmart request failed (HTTP ${response.status})`);
    }
    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      logger.warn('walmart: response body unreadable', { op, error: String(err) });
      throw new ProviderFetchError('walmart', `Walmart request failed (${op}): response body unreadable`);
    }
    if (text.length > WALMART_MAX_RESPONSE_BYTES) {
      logger.warn('walmart: response oversize', { op, bytes: text.length });
      throw new ProviderFetchError('walmart', `Walmart request failed (${op}): response too large`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      logger.warn('walmart: response was not JSON', { op });
      throw new ProviderFetchError('walmart', `Walmart request failed (${op}): response was not JSON`);
    }
  }

  /**
   * Keyword search: `search?query={query}&numItems={n}`. The
   * affiliate /search takes a keyword only — there is no UPC
   * parameter on this endpoint (UPC lookup exists on the
   * seller-side Marketplace Item Search API, a different API
   * with different credentials, not used here). A blank query is
   * an empty result, not a call.
   */
  async search(request: ProviderSearchRequest): Promise<RawProductData[]> {
    const query = typeof request.query === 'string' ? request.query.trim() : '';
    if (query === '') return [];
    if (!this.isAvailable()) {
      throw new ProviderNotConfiguredError('walmart', this.getNotConfiguredReason() ?? WALMART_NOT_CONFIGURED_REASON);
    }
    const limit = Math.min(
      Math.max(typeof request.limit === 'number' ? request.limit : WALMART_SEARCH_PAGE_SIZE, 1),
      WALMART_SEARCH_MAX_ITEMS,
    );
    const url = new URL(`${WALMART_API_BASE}/search`);
    url.searchParams.set('query', query);
    url.searchParams.set('numItems', String(limit));
    url.searchParams.set('responseGroup', 'base');
    const data = await this.callWalmart(url.toString(), 'search');
    if (!data || typeof data !== 'object') {
      throw new ProviderFetchError('walmart', 'Walmart request failed (search): response was not JSON');
    }
    const items = (data as Record<string, unknown>).items;
    if (!Array.isArray(items)) {
      throw new ProviderFetchError('walmart', 'Walmart request failed (search): response has no items list');
    }
    const mapped: RawProductData[] = [];
    for (const item of items) {
      const product = toRawProduct(item);
      if (product) mapped.push(product);
    }
    return mapped;
  }

  /**
   * Fetch one item: `items/{itemId}`. A 404 is "not found"
   * (null), not an error.
   */
  async fetch(request: ProviderFetchRequest): Promise<RawProductData | null> {
    if (!this.isAvailable()) {
      throw new ProviderNotConfiguredError('walmart', this.getNotConfiguredReason() ?? WALMART_NOT_CONFIGURED_REASON);
    }
    const itemId = typeof request.externalId === 'string' ? request.externalId.trim() : '';
    if (itemId === '') return null;
    const url = `${WALMART_API_BASE}/items/${encodeURIComponent(itemId)}`;
    const data = await this.callWalmart(url, 'fetch');
    if (data === null) return null;
    if (!data || typeof data !== 'object') {
      throw new ProviderFetchError('walmart', 'Walmart request failed (fetch): response was not JSON');
    }
    // The single-item endpoint returns the item object; tolerate
    // a wrapped `{ items: [...] }` shape defensively.
    const body = data as Record<string, unknown>;
    const item = Array.isArray(body.items) ? body.items[0] : data;
    return toRawProduct(item);
  }
}
