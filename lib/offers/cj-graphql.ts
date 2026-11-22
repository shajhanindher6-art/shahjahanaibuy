/**
 * CJ Affiliate — GraphQL Product Search client (official API).
 *
 * POST https://ads.api.cj.com/query, Authorization: Bearer <PAT>.
 * Pure client: no Supabase, no CLI parsing, no database — the
 * scripts/import-cj-graphql.ts entry point owns the upsert loop.
 *
 * DESIGN NOTES (verified 2026-11-22 against CJ's official docs,
 * docs.cj.com/docs/productfeed-api-search):
 * - Queries: products, shoppingProducts (primary here), plus
 *   travelExperienceProducts / financeProducts. Summaries:
 *   productFeeds / shoppingProductFeeds.
 * - companyId (own CID) is REQUIRED on every query.
 * - gtin is a confirmed search argument on shoppingProducts.
 * - Pagination: default limit 1,000, max 10,000 per query. Use
 *   offset + limit while totalCount <= 10,000; above that use the
 *   `page` token from the previous response and do NOT send offset.
 * - price.amount is a STRING in CJ's own samples ("135.00") — parse
 *   it, never trust the type. brand IS a field (Phase 7's "unknown"
 *   is resolved); whether DHGate populates it is unverified.
 * - linkCode(pid) takes ONE PID per request, owned by the querying
 *   company; it is included only when a PID is configured.
 * - Query-side rate limit is UNKNOWN in the docs — the client
 *   throttles conservatively (>= 1s between calls by default) and
 *   backs off on 429s. A --probe call (limit 1) must run before
 *   any bulk use so the real limit can be learned.
 * - The Personal Access Token is never logged. Missing token fails
 *   closed with 'not_configured', mirroring requireSftpConfig().
 *
 * OPEN (resolvable only from a first live call):
 * - exact response field carrying the page token (checked defensively)
 * - whether DHGate populates brand / additional_image_link / salePrice
 * - whether DHGate's availability strings match the CSV vocabulary
 * - the PID value for linkCode (fallback: the plain `link` field)
 * - salePrice shape (scalar string vs { amount, currency } object)
 *
 * No live calls are made by this module's tests — fetch is injected.
 */

import {
  explicitCurrencyCode,
  isValidImageUrl,
  normalizeAvailability,
  normalizeGtinValue,
  parseFeedPrice,
  type TransformContext,
} from '@/lib/offers/cj-feed-transform';
import type { MerchantOfferRow } from '@/lib/offers/types';

export const CJ_GRAPHQL_URL = 'https://ads.api.cj.com/query';

/** Fixed field set: exactly what the mapper needs, nothing more. */
const SHOPPING_PRODUCT_FIELDS = [
  'id',
  'title',
  'description',
  'price { amount currency }',
  'salePrice',
  'availability',
  'condition',
  'brand',
  'gtin',
  'mpn',
  'identifierExists',
  'imageLink',
  'additional_image_link',
  'link',
  'mobile_link',
  'google_product_category',
  'product_type',
  'item_group_id',
  'advertiserId',
  'catalogId',
  'itemListId',
].join('\n');

const FEED_SUMMARY_FIELDS = [
  'adId',
  'feedName',
  'advertiserId',
  'advertiserName',
  'advertiserCountry',
  'productCount',
  'lastUpdated',
  'language',
  'currency',
  'sourceFeedType',
].join('\n');

export interface CjGraphqlConfig {
  /** Own CJ publisher CID, e.g. "8130731" — required, never defaulted. */
  companyId: string;
  /** Personal Access Token (env.cjPersonalAccessToken) — never logged. */
  personalAccessToken: string;
  /** Tracking PID for linkCode(); omit = no clickUrl in the query. */
  pid?: string;
  baseUrl?: string;
  /** Default 1000 (CJ default). */
  defaultLimit?: number;
  /** Min ms between calls. Default 1000 — limit is UNKNOWN, stay conservative. */
  minIntervalMs?: number;
  /** Per-call timeout ms. Default 30000. */
  timeoutMs?: number;
  /** Retries per call, retryable errors only. Default 3. */
  maxRetries?: number;
  /** Base ms for exponential backoff. Default 2000. */
  retryBaseMs?: number;
  /** Runaway guards. Defaults: 200 pages / 100000 products. */
  maxPages?: number;
  maxTotal?: number;
}

export interface CjShoppingProduct {
  id: string;
  title: string | null;
  description: string | null;
  price: { amount: string; currency: string } | null;
  salePrice: { amount: string; currency: string } | string | null;
  availability: string | null;
  condition: string | null;
  brand: string | null;
  gtin: string | null;
  mpn: string | null;
  identifierExists: boolean | null;
  imageLink: string | null;
  additional_image_link: string[] | null;
  link: string | null;
  mobile_link: string | null;
  google_product_category: string | null;
  product_type: string | null;
  item_group_id: string | null;
  advertiserId: string | number;
  catalogId: string | null;
  itemListId: string | null;
  linkCode: { clickUrl: string } | null;
}

export interface CjSearchParams {
  partnerIds?: string[];
  partnerStatus?: 'joined' | 'not-joined';
  keywords?: string;
  gtin?: string;
  availability?: string;
  currency?: string;
  lowPrice?: number;
  highPrice?: number;
  advertiserCountries?: string[];
  serviceableAreas?: string[];
  googleProductCategoryIds?: string[];
  googleProductCategoryNames?: string[];
  productIds?: string[];
  adIds?: string[];
  itemListIds?: string[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  page?: string;
}

export interface CjPageResult {
  totalCount: number;
  limit: number;
  count: number;
  resultList: CjShoppingProduct[];
  /** Page token for the next page (field name TBD on first live call). */
  nextPageToken?: string;
}

export interface CjFeedSummary {
  adId: string;
  feedName: string;
  advertiserId: string;
  advertiserName: string;
  advertiserCountry: string;
  productCount: number;
  lastUpdated: string;
  language: string;
  currency: string;
  sourceFeedType: string;
}

export type CjGraphqlErrorKind =
  | 'not_configured'
  | 'auth'
  | 'rate_limited'
  | 'validation'
  | 'network'
  | 'graphql'
  | 'http';

export class CjGraphqlError extends Error {
  kind: CjGraphqlErrorKind;
  status?: number;
  retryAfterMs?: number;
  errors?: string[];

  constructor(kind: CjGraphqlErrorKind, message: string, extra?: Partial<CjGraphqlError>) {
    super(message);
    this.name = 'CjGraphqlError';
    this.kind = kind;
    if (extra?.status !== undefined) this.status = extra.status;
    if (extra?.retryAfterMs !== undefined) this.retryAfterMs = extra.retryAfterMs;
    if (extra?.errors !== undefined) this.errors = extra.errors;
  }
}

/** Minimal fetch surface the client needs (global fetch satisfies it). */
export type CjFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

function requireConfig(config: CjGraphqlConfig): Required<
  Pick<CjGraphqlConfig, 'companyId' | 'personalAccessToken' | 'baseUrl' | 'defaultLimit' | 'minIntervalMs' | 'timeoutMs' | 'maxRetries' | 'retryBaseMs' | 'maxPages' | 'maxTotal'>
> & { pid?: string } {
  if (!config.companyId || !config.personalAccessToken) {
    throw new CjGraphqlError(
      'not_configured',
      'CJ GraphQL is not configured: companyId (own CID) and CJ_PERSONAL_ACCESS_TOKEN are required (Vercel only, never in git).',
    );
  }
  return {
    companyId: config.companyId,
    personalAccessToken: config.personalAccessToken,
    pid: config.pid,
    baseUrl: config.baseUrl ?? CJ_GRAPHQL_URL,
    defaultLimit: config.defaultLimit ?? 1000,
    minIntervalMs: config.minIntervalMs ?? 1000,
    timeoutMs: config.timeoutMs ?? 30_000,
    maxRetries: config.maxRetries ?? 3,
    retryBaseMs: config.retryBaseMs ?? 2000,
    maxPages: config.maxPages ?? 200,
    maxTotal: config.maxTotal ?? 100_000,
  };
}

export interface BuiltQuery {
  query: string;
  variables: Record<string, unknown>;
}

/**
 * Build the shoppingProducts query. All arguments travel as GraphQL
 * variables — never string-interpolated into the query text.
 * linkCode(pid) is included only when a PID is configured.
 */
export function buildShoppingProductsQuery(
  params: CjSearchParams,
  config: Pick<CjGraphqlConfig, 'companyId' | 'pid'>,
): BuiltQuery {
  if (!config.companyId) {
    throw new CjGraphqlError('not_configured', 'companyId (own CID) is required.');
  }
  const linkCodeField =
    config.pid !== undefined && config.pid !== ''
      ? `\nlinkCode(pid: "${config.pid}") { clickUrl }`
      : '';
  const query = `query ShoppingProducts(
  $companyId: String!, $partnerIds: [String], $partnerStatus: String,
  $keywords: String, $gtin: String, $availability: String, $currency: String,
  $lowPrice: Float, $highPrice: Float, $advertiserCountries: [String],
  $serviceableAreas: [String], $googleProductCategoryIds: [String],
  $googleProductCategoryNames: [String], $productIds: [String],
  $adIds: [String], $itemListIds: [String], $sortBy: String,
  $sortOrder: String, $limit: Int, $offset: Int, $page: String
) {
  shoppingProducts(
    companyId: $companyId, partnerIds: $partnerIds, partnerStatus: $partnerStatus,
    keywords: $keywords, gtin: $gtin, availability: $availability, currency: $currency,
    lowPrice: $lowPrice, highPrice: $highPrice, advertiserCountries: $advertiserCountries,
    serviceableAreas: $serviceableAreas, googleProductCategoryIds: $googleProductCategoryIds,
    googleProductCategoryNames: $googleProductCategoryNames, productIds: $productIds,
    adIds: $adIds, itemListIds: $itemListIds, sortBy: $sortBy, sortOrder: $sortOrder,
    limit: $limit, offset: $offset, page: $page
  ) {
    totalCount
    limit
    count
    page
    resultList {
      ${SHOPPING_PRODUCT_FIELDS}${linkCodeField}
    }
  }
}`;
  const variables: Record<string, unknown> = { companyId: config.companyId };
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) variables[key] = value;
  }
  return { query, variables };
}

/** Build the shoppingProductFeeds summary query. */
export function buildFeedSummaryQuery(
  companyId: string,
  partnerIds?: string[],
): BuiltQuery {
  if (!companyId) {
    throw new CjGraphqlError('not_configured', 'companyId (own CID) is required.');
  }
  const query = `query ShoppingProductFeeds($companyId: String!, $partnerIds: [String]) {
  shoppingProductFeeds(companyId: $companyId, partnerIds: $partnerIds) {
    ${FEED_SUMMARY_FIELDS}
  }
}`;
  const variables: Record<string, unknown> = { companyId };
  if (partnerIds !== undefined) variables.partnerIds = partnerIds;
  return { query, variables };
}

function isRetryable(kind: CjGraphqlErrorKind): boolean {
  return kind === 'rate_limited' || kind === 'network';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postGraphql(
  built: BuiltQuery,
  cfg: ReturnType<typeof requireConfig>,
  fetchImpl: CjFetch,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let response: Awaited<ReturnType<CjFetch>>;
  try {
    response = await fetchImpl(cfg.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.personalAccessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'SmartBuy-AI/cj-graphql',
      },
      body: JSON.stringify(built),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new CjGraphqlError('network', `CJ GraphQL request timed out after ${cfg.timeoutMs}ms.`);
    }
    throw new CjGraphqlError(
      'network',
      `CJ GraphQL request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    throw new CjGraphqlError('auth', `CJ GraphQL auth failed (HTTP ${response.status}). Check the Personal Access Token.`, {
      status: response.status,
    });
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const retryAfterMs =
      retryAfter !== null && retryAfter !== '' && Number.isFinite(Number(retryAfter))
        ? Number(retryAfter) * 1000
        : undefined;
    throw new CjGraphqlError('rate_limited', 'CJ GraphQL rate limit hit (HTTP 429).', {
      status: 429,
      retryAfterMs,
    });
  }
  if (response.status >= 500) {
    throw new CjGraphqlError('network', `CJ GraphQL server error (HTTP ${response.status}).`, {
      status: response.status,
    });
  }
  if (!response.ok) {
    throw new CjGraphqlError('http', `CJ GraphQL request failed (HTTP ${response.status}).`, {
      status: response.status,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CjGraphqlError('network', 'CJ GraphQL returned unparseable JSON.');
  }
  const data = (body as { data?: unknown; errors?: Array<{ message?: string }> } | null)?.data;
  const errors = (body as { errors?: Array<{ message?: string }> } | null)?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    // Partial data is never silently accepted.
    throw new CjGraphqlError(
      'graphql',
      `CJ GraphQL errors: ${errors.map((e) => e.message ?? 'unknown').join('; ')}`,
      { errors: errors.map((e) => e.message ?? 'unknown') },
    );
  }
  if (data === null || data === undefined || typeof data !== 'object') {
    throw new CjGraphqlError('graphql', 'CJ GraphQL returned no data object.');
  }
  return data as Record<string, unknown>;
}

async function callWithRetry(
  built: BuiltQuery,
  cfg: ReturnType<typeof requireConfig>,
  fetchImpl: CjFetch,
): Promise<Record<string, unknown>> {
  let lastError: CjGraphqlError | null = null;
  let retryBudget = 10;
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await postGraphql(built, cfg, fetchImpl);
    } catch (err) {
      if (!(err instanceof CjGraphqlError) || !isRetryable(err.kind)) throw err;
      lastError = err;
      if (attempt === cfg.maxRetries || retryBudget <= 0) throw err;
      retryBudget -= 1;
      const backoff =
        err.retryAfterMs ?? cfg.retryBaseMs * 2 ** attempt;
      await sleep(backoff);
    }
  }
  throw lastError ?? new CjGraphqlError('network', 'CJ GraphQL request failed.');
}

/** Extract the page token from a page result (field name TBD on first live call). */
function readNextPageToken(raw: Record<string, unknown>): string | undefined {
  for (const key of ['page', 'nextPage', 'nextPageToken']) {
    const value = raw[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

function parsePage(raw: unknown): CjPageResult {
  const page = (raw as Record<string, unknown> | null) ?? {};
  const resultList = Array.isArray(page.resultList)
    ? (page.resultList as CjShoppingProduct[])
    : [];
  return {
    totalCount: typeof page.totalCount === 'number' ? page.totalCount : resultList.length,
    limit: typeof page.limit === 'number' ? page.limit : resultList.length,
    count: typeof page.count === 'number' ? page.count : resultList.length,
    resultList,
    nextPageToken: readNextPageToken(page),
  };
}

/**
 * Search shoppingProducts across all pages, streaming each page to
 * onPage as it arrives (never accumulating the whole catalog).
 * Offset mode while totalCount <= 10,000; page-token mode above it
 * (no offset in that mode). Stops on an empty page, a repeated-ID
 * page, the maxPages/maxTotal guards, or when onPage returns false.
 */
export async function searchShoppingProducts(
  params: CjSearchParams,
  onPage: (page: CjPageResult) => Promise<boolean | void> | boolean | void,
  config: CjGraphqlConfig,
  fetchImpl: CjFetch = fetch as unknown as CjFetch,
): Promise<{ pages: number; total: number }> {
  const cfg = requireConfig(config);
  const limit = Math.min(params.limit ?? cfg.defaultLimit, 10_000);
  let lastCallAt = 0;
  const throttle = async (): Promise<void> => {
    const now = Date.now();
    const wait = cfg.minIntervalMs - (now - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
  };

  let pages = 0;
  let total = 0;
  const seen = new Set<string>();

  // First page: offset mode, limit capped at 1,000 (CJ default).
  await throttle();
  const firstBuilt = buildShoppingProductsQuery(
    { ...params, limit: Math.min(limit, 1000), offset: 0 },
    cfg,
  );
  const firstData = await callWithRetry(firstBuilt, cfg, fetchImpl);
  const firstPage = parsePage(firstData.shoppingProducts);
  pages += 1;
  total += firstPage.count;
  for (const product of firstPage.resultList) seen.add(String(product.id));
  if ((await onPage(firstPage)) === false) return { pages, total };
  if (firstPage.count === 0) return { pages, total };

  const totalCount = firstPage.totalCount;
  if (totalCount <= 10_000) {
    let offset = firstPage.count;
    while (offset < totalCount && pages < cfg.maxPages && total < cfg.maxTotal) {
      await throttle();
      const built = buildShoppingProductsQuery(
        { ...params, limit: Math.min(limit, 1000), offset },
        cfg,
      );
      const data = await callWithRetry(built, cfg, fetchImpl);
      const page = parsePage(data.shoppingProducts);
      if (page.count === 0) break;
      const newIds = page.resultList.filter((p) => !seen.has(String(p.id)));
      if (newIds.length === 0) break; // stuck cursor — repeated IDs
      for (const product of page.resultList) seen.add(String(product.id));
      pages += 1;
      total += page.count;
      offset += page.count;
      if ((await onPage(page)) === false) return { pages, total };
    }
    return { pages, total };
  }

  // Above 10,000: page-token mode, no offset.
  let token = firstPage.nextPageToken;
  while (token !== undefined && pages < cfg.maxPages && total < cfg.maxTotal) {
    await throttle();
    const built = buildShoppingProductsQuery(
      { ...params, limit: 10_000, page: token },
      cfg,
    );
    const data = await callWithRetry(built, cfg, fetchImpl);
    const page = parsePage(data.shoppingProducts);
    if (page.count === 0) break;
    const newIds = page.resultList.filter((p) => !seen.has(String(p.id)));
    if (newIds.length === 0) break;
    for (const product of page.resultList) seen.add(String(product.id));
    pages += 1;
    total += page.count;
    if ((await onPage(page)) === false) return { pages, total };
    token = page.nextPageToken;
  }
  return { pages, total };
}

/** Fetch feed summaries (advertiser name, productCount, lastUpdated). */
export async function fetchFeedSummaries(
  companyId: string,
  partnerIds: string[] | undefined,
  config: Pick<CjGraphqlConfig, 'personalAccessToken' | 'baseUrl' | 'timeoutMs' | 'maxRetries' | 'retryBaseMs'>,
  fetchImpl: CjFetch = fetch as unknown as CjFetch,
): Promise<CjFeedSummary[]> {
  const cfg = requireConfig({ ...config, companyId });
  const built = buildFeedSummaryQuery(companyId, partnerIds);
  const data = await callWithRetry(built, cfg, fetchImpl);
  const summaries = (data as { shoppingProductFeeds?: unknown }).shoppingProductFeeds;
  if (!Array.isArray(summaries)) return [];
  return summaries as CjFeedSummary[];
}

export interface GraphqlTransformResult {
  row: MerchantOfferRow | null;
  skipReason: string | null;
  hasIdentifier: boolean;
}

function parseGraphqlPrice(
  price: { amount: string; currency: string } | string | null | undefined,
): { amount: number; currency: string } | null {
  if (price === null || price === undefined) return null;
  if (typeof price === 'string') return parseFeedPrice(price);
  if (typeof price.amount !== 'string') return null;
  return parseFeedPrice(`${price.amount} ${price.currency ?? ''}`.trim());
}

/**
 * Map one GraphQL shopping product to an upsert-ready row, or skip
 * it with a reason. Same skip order as the CSV transform
 * (missing id → not in stock → price missing/≤ 0 → image invalid
 * → only-with-gtin no valid GTIN), plus missing-title and
 * missing-url, which the CSV path cannot express (its link/title
 * come from the same record unconditionally).
 */
export function toMerchantOfferRow(
  product: CjShoppingProduct,
  ctx: TransformContext,
  fallbackCurrency?: string,
): GraphqlTransformResult {
  const externalId = product.id?.trim();
  if (!externalId) {
    return { row: null, skipReason: 'missing-id', hasIdentifier: false };
  }

  const title = product.title?.trim() ?? '';
  if (title === '') {
    return { row: null, skipReason: 'missing-title', hasIdentifier: false };
  }

  const availability = normalizeAvailability(product.availability);
  if (availability !== 'in_stock') {
    return { row: null, skipReason: 'not-in-stock', hasIdentifier: false };
  }

  const price = parseGraphqlPrice(product.price);
  if (price === null || price.amount <= 0) {
    return { row: null, skipReason: 'invalid-price', hasIdentifier: false };
  }
  const currency =
    price.currency !== '' && price.currency.length === 3
      ? price.currency.toUpperCase()
      : fallbackCurrency !== undefined && fallbackCurrency.length === 3
        ? fallbackCurrency.toUpperCase()
        : 'USD';

  const imageUrl = product.imageLink?.trim() ?? '';
  if (!isValidImageUrl(imageUrl)) {
    return { row: null, skipReason: 'invalid-image', hasIdentifier: false };
  }

  const gtin = normalizeGtinValue(product.gtin);
  const mpnRaw = product.mpn?.trim() ?? '';
  const mpn = mpnRaw === '' ? null : mpnRaw;
  const hasIdentifier = gtin !== null || mpn !== null;

  if (ctx.onlyWithGtin && gtin === null) {
    return { row: null, skipReason: 'no-gtin', hasIdentifier };
  }

  const affiliateUrl =
    product.linkCode?.clickUrl?.trim() || product.link?.trim() || '';
  // Same validity bar as the CSV importer: the URL must be a usable
  // http(s) link, not just non-empty — a dead click-through is not
  // a displayable offer.
  if (!isValidImageUrl(affiliateUrl)) {
    return { row: null, skipReason: 'missing-url', hasIdentifier };
  }

  // salePrice: object { amount, currency } or plain string — both parse
  // through the same normalizer; unparseable or ≤ 0 becomes null.
  // A sale price with an EXPLICITLY different currency than the list
  // price is dropped too (same rule as the CSV importer); a bare
  // figure or an object without a currency inherits the row currency.
  const salePriceParsed = parseGraphqlPrice(product.salePrice);
  const saleExplicitCurrency =
    typeof product.salePrice === 'object' && product.salePrice !== null
      ? product.salePrice.currency?.trim() || null
      : typeof product.salePrice === 'string'
        ? explicitCurrencyCode(product.salePrice)
        : null;
  const saleCurrency =
    saleExplicitCurrency !== null && saleExplicitCurrency !== ''
      ? saleExplicitCurrency.toUpperCase()
      : currency;
  const salePrice =
    salePriceParsed !== null &&
    salePriceParsed.amount > 0 &&
    saleCurrency === currency
      ? salePriceParsed.amount
      : null;

  const brand = product.brand?.trim() || null;
  const category =
    product.google_product_category?.trim() ||
    product.product_type?.trim() ||
    null;
  const description = product.description?.trim() || null;

  return {
    row: {
      network: ctx.network,
      advertiser_id: ctx.advertiserId,
      advertiser_name: ctx.advertiserName,
      external_product_id: externalId,
      gtin,
      mpn,
      brand,
      title,
      description,
      image_url: imageUrl,
      affiliate_url: affiliateUrl,
      price: price.amount,
      sale_price: salePrice,
      currency,
      availability,
      category,
      is_public_live: ctx.psaApproved,
      last_synced_at: ctx.syncedAt,
    },
    skipReason: null,
    hasIdentifier,
  };
}
