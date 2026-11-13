/**
 * Section 8 — eBay Browse API adapter (SERVER-ONLY).
 *
 * The first REAL live catalog beyond the site's own recorded
 * merchant listings: eBay's official Browse API returns active
 * listings (asking prices, never sold prices) for a keyword.
 *
 * ENV-GATED, OFF BY DEFAULT: without EBAY_CLIENT_ID +
 * EBAY_CLIENT_SECRET in the hosting dashboard, every call returns
 * `{ ok: false, reason: 'not-configured' }` and the UI shows the
 * honest "eBay live search is not configured" state — never a
 * fake listing, never a scraped page. Keys live only in env vars
 * (Vercel), never in code, git, chat, or any API response.
 *
 * FREE TIER: eBay's developer program is free; the default Browse
 * limit is 5,000 calls/day. Production access additionally needs
 * the eBay Partner Network (EPN) + Growth Check — the owner's
 * signup, not code. The API route in front of this adapter caps
 * calls at 30/min per IP on top of that.
 *
 * PRIVACY: the adapter sends only the search keyword to eBay.
 * No visitor IP, user id, or cookie is ever sent. Tokens are
 * OAuth client-credentials (server-to-server), cached in memory
 * until shortly before expiry and never logged or returned.
 *
 * LIMITS, STATED PLAINLY: active listings only (no sold-history —
 * that needs the separately gated Marketplace Insights API);
 * prices are the sellers' asking prices at call time, not a
 * SmartBuy recorded price, so they carry no price history, no
 * Deal Score, and no "lowest ever" claim.
 */

import { logger } from '@/lib/config/logger';
import { logApiError } from '@/lib/api/error-logging';
import { validateGtin } from '@/lib/gtin';

export interface EbayListing {
  itemId: string;
  title: string;
  /** Asking price in the listing currency, or null when unparseable. */
  price: number | null;
  currency: string | null;
  condition: string | null;
  itemWebUrl: string;
  imageUrl: string | null;
  /**
   * Section 21–25, Stage C (B12) — the listing's GTIN when the
   * listing itself carries one (a structured field, GS1-validated).
   * Null is the honest value for most listings: eBay Browse
   * `itemSummary` rows rarely carry a GTIN, and one is NEVER
   * guessed from the title or invented — a missing GTIN is
   * recorded as missing, not filled in.
   */
  gtin: string | null;
}

export type EbaySearchFailureReason =
  | 'not-configured'
  | 'invalid-query'
  | 'rate-limited'
  | 'api-error';

export type EbaySearchResult =
  | {
      ok: true;
      source: 'ebay-browse-api';
      listings: EbayListing[];
    }
  | {
      ok: false;
      reason: EbaySearchFailureReason;
      listings: [];
    };

const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_BROWSE_URL =
  'https://api.ebay.com/buy/browse/v1/item_summary/search';
const EBAY_SCOPE = 'https://api.ebay.com/oauth/api_scope';
const EBAY_DEFAULT_MARKETPLACE = 'EBAY_US';
const EBAY_MAX_LIMIT = 10;
const EBAY_DEFAULT_LIMIT = 5;
const EBAY_MAX_QUERY_LENGTH = 200;
/** Refresh the token 60s before eBay says it expires. */
const TOKEN_EARLY_REFRESH_MS = 60 * 1000;
/**
 * Section 15, P1-3: hard timeout on every eBay call (matches the
 * 10s precedent in lib/generic-webhook.ts and
 * services/alert-webhooks.ts). A hanging eBay call used to block
 * the caller forever; now it aborts and surfaces as 'api-error'.
 */
export const EBAY_FETCH_TIMEOUT_MS = 10_000;

/**
 * Section 15, P3-4: eBay Browse `conditions` filter values. Only
 * these are ever sent — an unknown value is ignored, never passed
 * through to eBay, so a bad caller cannot craft an arbitrary
 * filter string.
 */
export const EBAY_CONDITIONS = [
  'NEW',
  'LIKE_NEW',
  'NEW_OTHER',
  'USED',
  'FOR_PARTS_OR_NOT_WORKING',
  'CERTIFIED_REFURBISHED',
  'SELLER_REFURBISHED',
  'MANUFACTURER_REFURBISHED',
  'REFURBISHED',
] as const;
export type EbayCondition = (typeof EBAY_CONDITIONS)[number];

export function isEbayCondition(value: unknown): value is EbayCondition {
  return (
    typeof value === 'string' &&
    (EBAY_CONDITIONS as readonly string[]).includes(value.toUpperCase())
  );
}

type FetchFn = typeof fetch;

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

let cachedToken: CachedToken | null = null;

/** Test-only: drop the in-memory token so tests stay independent. */
export function resetEbayTokenCacheForTests(): void {
  cachedToken = null;
}

function envNonEmpty(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getEbayCredentials(): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = envNonEmpty('EBAY_CLIENT_ID');
  const clientSecret = envNonEmpty('EBAY_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** True only when both eBay credentials are configured. */
export function isEbayConfigured(): boolean {
  return getEbayCredentials() !== null;
}

function getEbayMarketplaceId(): string {
  const configured = envNonEmpty('EBAY_MARKETPLACE_ID');
  if (configured && /^EBAY_[A-Z]{2}$/.test(configured)) return configured;
  return EBAY_DEFAULT_MARKETPLACE;
}

function parsePrice(value: unknown, currency: unknown): {
  price: number | null;
  currency: string | null;
} {
  const parsed =
    typeof value === 'string' || typeof value === 'number'
      ? Number(value)
      : Number.NaN;
  return {
    price: Number.isFinite(parsed) && parsed >= 0 ? parsed : null,
    currency:
      typeof currency === 'string' && currency.trim().length > 0
        ? currency.trim()
        : null,
  };
}

/**
 * Section 21–25, Stage C (B12) — attempt GTIN extraction from an
 * eBay Browse `itemSummary` row. Only structured fields are read:
 * a top-level `gtin` value, or a `localizedAspects` entry named
 * GTIN / UPC / EAN / EAN-13 / ISBN. Every candidate must pass the
 * GS1 check-digit test (lib/gtin.ts) — a mistyped or non-GTIN
 * aspect value is dropped, never stored. The title is NEVER
 * scanned for a GTIN: a digit run in a keyword-stuffed title is
 * not an identity. Returns the digits-only GTIN, or null when
 * the listing carries none (the normal case — recorded as
 * missing, never invented).
 */
export function extractEbayGtin(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const candidates: unknown[] = [];
  if (typeof row.gtin === 'string') candidates.push(row.gtin);
  if (Array.isArray(row.localizedAspects)) {
    for (const aspect of row.localizedAspects as Array<Record<string, unknown>>) {
      if (!aspect || typeof aspect !== 'object') continue;
      const name = typeof aspect.name === 'string' ? aspect.name.trim().toLowerCase() : '';
      if (name === 'gtin' || name === 'upc' || name === 'ean' || name === 'ean-13' || name === 'isbn') {
        candidates.push(aspect.value);
      }
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const check = validateGtin(candidate);
    if (check.valid) return check.normalized;
  }
  return null;
}

function toListing(item: unknown): EbayListing | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const itemId = typeof row.itemId === 'string' ? row.itemId : '';
  const title = typeof row.title === 'string' ? row.title : '';
  const itemWebUrl =
    typeof row.itemWebUrl === 'string' ? row.itemWebUrl : '';
  if (!itemId || !title || !itemWebUrl) return null;
  const priceObj =
    row.price && typeof row.price === 'object'
      ? (row.price as Record<string, unknown>)
      : {};
  const { price, currency } = parsePrice(priceObj.value, priceObj.currency);
  const imageObj =
    row.image && typeof row.image === 'object'
      ? (row.image as Record<string, unknown>)
      : {};
  return {
    itemId,
    title,
    price,
    currency,
    condition:
      typeof row.condition === 'string' ? row.condition : null,
    itemWebUrl,
    imageUrl:
      typeof imageObj.imageUrl === 'string' ? imageObj.imageUrl : null,
    gtin: extractEbayGtin(row),
  };
}

async function getEbayAccessToken(
  fetchFn: FetchFn
): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs > now) {
    return cachedToken.token;
  }
  const credentials = getEbayCredentials();
  if (!credentials) return null;
  try {
    const response = await fetchFn(EBAY_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${credentials.clientId}:${credentials.clientSecret}`
        ).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: EBAY_SCOPE,
      }).toString(),
      // P1-3: never wait forever for the token endpoint.
      signal: AbortSignal.timeout(EBAY_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Section 15, P3-4: a failed token fetch used to be silent.
      // Log the status (never the credentials or the token) so a
      // bad client id/secret is diagnosable instead of invisible.
      logger.warn('ebay-browse: token request failed', {
        status: response.status,
      });
      // Section 20, §12 #53 — a 5xx from the token endpoint is a
      // server error: it belongs in error_log. A 429 is transient
      // throttling, not a server error, and stays warn-only.
      if (response.status >= 500) {
        logApiError(new Error(`eBay token request failed (HTTP ${response.status})`), {
          route: 'ebay-browse.token',
          status: 502,
          context: { status: response.status },
        });
      }
      return null;
    }
    const data: unknown = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') return null;
    const body = data as Record<string, unknown>;
    const token =
      typeof body.access_token === 'string' ? body.access_token : '';
    const expiresIn =
      typeof body.expires_in === 'number' ? body.expires_in : 0;
    if (!token || expiresIn <= 0) return null;
    cachedToken = {
      token,
      expiresAtMs: now + expiresIn * 1000 - TOKEN_EARLY_REFRESH_MS,
    };
    return token;
  } catch (err) {
    // Section 15, P3-4: a throwing token fetch used to be silent.
    logger.warn('ebay-browse: token request threw', { error: String(err) });
    // Section 20, §12 #53 — a throwing token fetch is a server error.
    logApiError(err, { route: 'ebay-browse.token', status: 502 });
    return null;
  }
}

/**
 * Search live eBay active listings for a keyword, cheapest first.
 * Never throws for expected failures — the caller renders the
 * `reason` as an honest empty state instead.
 */
export async function searchEbayListings(
  rawQuery: string,
  options?: {
    limit?: number;
    fetchFn?: FetchFn;
    /**
     * Section 15, P3-4: optional condition filter, sent as the
     * Browse API `conditions:{VALUE}` filter. Unknown values are
     * ignored (no filter) rather than failing the search.
     */
    condition?: string;
  }
): Promise<EbaySearchResult> {
  const fetchFn = options?.fetchFn ?? fetch;
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (query.length === 0 || query.length > EBAY_MAX_QUERY_LENGTH) {
    return { ok: false, reason: 'invalid-query', listings: [] };
  }
  if (!isEbayConfigured()) {
    return { ok: false, reason: 'not-configured', listings: [] };
  }
  const limit = Math.min(
    Math.max(options?.limit ?? EBAY_DEFAULT_LIMIT, 1),
    EBAY_MAX_LIMIT
  );
  const token = await getEbayAccessToken(fetchFn);
  if (!token) {
    return { ok: false, reason: 'api-error', listings: [] };
  }
  try {
    const url = new URL(EBAY_BROWSE_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('sort', 'price');
    if (isEbayCondition(options?.condition)) {
      url.searchParams.set(
        'filter',
        `conditions:{${(options?.condition as string).toUpperCase()}}`
      );
    }
    const response = await fetchFn(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': getEbayMarketplaceId(),
        'Content-Type': 'application/json',
      },
      // P1-3: never wait forever for the Browse API.
      signal: AbortSignal.timeout(EBAY_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Section 15, P3-4: HTTP 429 is a distinct reason now
      // ('rate-limited'), not a generic 'api-error' — callers
      // retry/back off on it instead of reporting a vague 503,
      // and the daily-budget guard can tell "eBay throttled us"
      // apart from "eBay is down".
      const status =
        typeof response.status === 'number' ? response.status : 0;
      logger.warn('ebay-browse: search request failed', { status, query });
      // Section 20, §12 #53 — a 5xx from Browse is a server
      // error: it belongs in error_log. A 429 stays warn-only
      // (transient throttling, not a server error).
      if (status >= 500) {
        logApiError(new Error(`eBay search request failed (HTTP ${status})`), {
          route: 'ebay-browse.search',
          status: 502,
          context: { status, query },
        });
      }
      return {
        ok: false,
        reason: status === 429 ? 'rate-limited' : 'api-error',
        listings: [],
      };
    }
    const data: unknown = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      // Malformed JSON: an upstream failure, never a fake listing.
      logger.warn('ebay-browse: search response was not JSON', { query });
      // Section 20, §12 #53 — a malformed upstream response is a
      // server error.
      logApiError(new Error('eBay search response was not JSON'), {
        route: 'ebay-browse.search',
        status: 502,
        context: { query, reason: 'non-json-response' },
      });
      return { ok: false, reason: 'api-error', listings: [] };
    }
    const summaries = (data as Record<string, unknown>).itemSummaries;
    if (!Array.isArray(summaries)) {
      return { ok: true, source: 'ebay-browse-api', listings: [] };
    }
    const listings: EbayListing[] = [];
    for (const item of summaries) {
      const listing = toListing(item);
      if (listing) listings.push(listing);
    }
    return { ok: true, source: 'ebay-browse-api', listings };
  } catch (err) {
    // Section 15, P3-4: a throwing search (network error, the 10s
    // timeout aborting) used to be silent. Log it; the caller
    // still gets an honest 'api-error', never a fake listing.
    logger.warn('ebay-browse: search request threw', {
      query,
      error: String(err),
    });
    // Section 20, §12 #53 — a throwing search is a server error.
    logApiError(err, { route: 'ebay-browse.search', status: 502, context: { query } });
    return { ok: false, reason: 'api-error', listings: [] };
  }
}
