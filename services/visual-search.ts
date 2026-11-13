/**
 * Visual search / product scanner — server-side helpers.
 *
 * Honest design (do not weaken without a new decision):
 * - Real visual identification ONLY happens through SerpAPI's
 *   google_lens engine, which needs BOTH a configured SERPAPI_API_KEY
 *   and a publicly reachable image URL (SerpAPI fetches the image
 *   from the URL — a browser-local upload has no URL to fetch).
 * - The expected production state is: no key configured (optional
 *   env var, unset = disabled). In that state the scanner MUST NOT
 *   fake an identification. It degrades to "keyword-assisted"
 *   search: the user confirms/enters the product name or keywords,
 *   the photo stays in the browser as a reference/preview, and
 *   matching runs through the existing catalog ai-search + merchant
 *   price matching exactly like a text search.
 * - Uploaded/captured photos are NEVER sent to the server and NEVER
 *   stored in the database (no table supports image storage for
 *   scans, and none is invented here). Only an optional user-pasted
 *   public image URL is sent, and only to SerpAPI's Lens endpoint.
 * - Lens results use only SerpAPI's structured fields (title,
 *   source, link, thumbnail). A missing field is shown as missing,
 *   never guessed. A Lens match is labelled "Visual match"; anything
 *   else is labelled "Keyword-assisted search from your photo".
 *
 * VECTOR UPGRADE (Delta 1 — dormant until the owner enables it):
 * - A second visual path matches against the catalog's own
 *   embeddings (supabase/add-visual-embeddings.sql, pgvector):
 *   a public image URL is captioned with
 *   Salesforce/blip-image-captioning-base, the caption (or
 *   user-typed caption text) is embedded with
 *   sentence-transformers/all-MiniLM-L6-v2 (384 dims), and
 *   match_products() returns catalog products by cosine similarity.
 * - Key-gated on HF_API_TOKEN (free Hugging Face account). No token
 *   = the route answers 503, never a faked match.
 * - Uploaded/captured photos are NEVER sent here: only a public
 *   image URL is fetched (its bytes forwarded to the captioning
 *   model) or plain caption text is embedded. Nothing is stored.
 */

import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { logger } from '@/lib/config/logger';
import { env } from '@/lib/config/env';
// Section 19, Phase 1 (§12 #5, #6, #7, #9) — engine leaf modules
// only (never the `@/services/ai-engine` barrel: the barrel's
// provider adapters import this module, so importing it here
// would be a cycle).
import { withAiRetry, isRetryableStatus } from '@/services/ai-engine/retry';
import {
  recordAiCall,
  spendProviderBudget,
  isProviderBudgetExhausted,
} from '@/services/ai-engine/usage';

// Client-safe helpers live in services/visual-search-client.ts (zero
// imports — the 'use client' scan page imports them from there, because
// importing this module into a client bundle would pull in the node:*
// imports above and break webpack). Imported here (not `export ... from`,
// which binds nothing locally) so MAX_VISUAL_SEARCH_IMAGE_BYTES below
// can reference MAX_SCAN_IMAGE_BYTES, and re-exported so server
// importers and tests keep importing them from '@/services/visual-search'
// unchanged; single source of truth, no duplication.
import { MAX_SCAN_IMAGE_BYTES, validateScanImage } from './visual-search-client';
export { MAX_SCAN_IMAGE_BYTES, validateScanImage };

export type ScanMode = 'visual' | 'keyword-assisted' | 'needs-keywords';

export interface VisualMatch {
  title: string;
  source: string | null;
  link: string | null;
  thumbnail: string | null;
}

// =====================================================================
// Visual-search result cache (Section 19, Phase 8, §12 #11)
//
// The audit found visual search re-spent HF/SerpAPI quota on every
// request: every scan re-fetched the image, re-ran BLIP captioning
// and re-ran the embedding. This cache sits INSIDE the service
// functions (below the Phase 1 budget gate in hfFetch /
// searchVisualByImageUrl), so a cache hit never reaches the code
// that spends budget — hits spend no quota — and a miss goes
// through the existing budget check unchanged.
//
// Shape: per-instance in-memory Map, following the SerpAPI 2-tier
// pattern in services/external-search.ts (memory 24h, then DB 7d)
// as far as it fits — there is NO second tier here, deliberately:
// no table exists for visual results, and adding one would need a
// new migration, which this phase must not create. 24h matches the
// SerpAPI memory TTL: a caption/embedding for a given image URL or
// text is stable input, and Lens matches are web results whose
// 24h staleness is the same window the web-search cache already
// accepts.
//
// Keys are sha256 hashes of the input (image URL or caption text),
// never the raw URL/text — the key must not leak a user-pasted URL
// into logs or metrics. Entries are bounded (500, FIFO eviction)
// so the map cannot grow without limit; embeddings are 384/512
// floats each, so the bound also bounds memory.
//
// Labelling: a cached result is NEVER presented as freshly
// computed. HfResult successes carry `cached: true` on a hit, and
// Lens results come back via searchVisualByImageUrlWithMeta with
// `fromCache` + `fetchedAt` (the time the provider actually
// produced them). Failures are never cached.
// =====================================================================

/** How long a visual-search result stays cached (24h — SerpAPI memory TTL). */
export const VISUAL_SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Maximum cached visual-search results per instance (FIFO eviction past this). */
export const VISUAL_SEARCH_CACHE_MAX_ENTRIES = 500;

interface VisualSearchCacheEntry {
  value: unknown;
  expiresAt: number;
  fetchedAt: string;
}

const visualSearchCache = new Map<string, VisualSearchCacheEntry>();

/** Cache key for one kind of visual analysis over one input (sha256 — the raw input never becomes a key). */
export function visualSearchCacheKey(
  kind: 'caption' | 'embed' | 'embed-clip' | 'lens',
  input: string
): string {
  return `${kind}:${createHash('sha256').update(input, 'utf8').digest('hex')}`;
}

function visualCacheGet<T>(key: string): { value: T; fetchedAt: string } | null {
  const entry = visualSearchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    visualSearchCache.delete(key);
    return null;
  }
  return { value: entry.value as T, fetchedAt: entry.fetchedAt };
}

function visualCacheSet(key: string, value: unknown): void {
  if (visualSearchCache.size >= VISUAL_SEARCH_CACHE_MAX_ENTRIES) {
    // FIFO eviction: Map iteration order is insertion order.
    const oldest = visualSearchCache.keys().next();
    if (!oldest.done) visualSearchCache.delete(oldest.value);
  }
  visualSearchCache.set(key, {
    value,
    expiresAt: Date.now() + VISUAL_SEARCH_CACHE_TTL_MS,
    fetchedAt: new Date().toISOString(),
  });
}

/** Test-only reset for the visual-search cache. */
export function clearVisualSearchCache(): void {
  visualSearchCache.clear();
}

/** Number of entries currently held in the visual-search cache. */
export function getVisualSearchCacheSize(): number {
  return visualSearchCache.size;
}

/**
 * Pure mode decision (unit-testable, no I/O):
 * - visual: key configured AND a public image URL was supplied.
 * - keyword-assisted: keywords supplied (photo is reference only).
 * - needs-keywords: neither — the UI must ask for keywords, never guess.
 */
export function decideScanMode(input: {
  serpApiConfigured: boolean;
  imageUrl: string | null;
  keywords: string | null;
}): ScanMode {
  if (input.serpApiConfigured && input.imageUrl) return 'visual';
  if (input.keywords && input.keywords.trim() !== '') return 'keyword-assisted';
  return 'needs-keywords';
}

/** True when SERPAPI_API_KEY is configured (server env only, never in git). */
export function isVisualSearchConfigured(): boolean {
  return Boolean(env.serpApiKey && env.serpApiKey.trim() !== '');
}

const LENS_ENDPOINT = 'https://serpapi.com/search.json';
const LENS_TIMEOUT_MS = 10_000;

export interface VisualLensOutcome {
  matches: VisualMatch[];
  /**
   * True when the matches came from the §12 #11 cache (no SerpAPI
   * quota spent). Callers must label a cached result as cached,
   * never as freshly computed — `fetchedAt` is when SerpAPI
   * actually produced them.
   */
  fromCache: boolean;
  /** When SerpAPI produced these matches (ISO timestamp), null when disabled/failed. */
  fetchedAt: string | null;
}

/**
 * SerpAPI google_lens visual search for a PUBLIC image URL, with
 * the §12 #11 result cache. Returns [] (never throws) on any
 * failure so the caller can fall back to keyword-assisted search
 * with an honest note.
 *
 * Section 19, Phase 1 (§12 #6, #7): transient Lens failures
 * (429 / 5xx / network) are retried with backoff (up to 3
 * attempts); the daily SerpAPI budget gates the call entirely —
 * when exhausted this returns [] without spending, and the caller
 * (scan route) says so honestly instead of pretending Lens found
 * nothing.
 *
 * Section 19, Phase 8 (§12 #11): a cache hit returns the stored
 * matches WITHOUT spending budget (the budget check below only
 * runs on a miss). Failures are never cached.
 */
export async function searchVisualByImageUrlWithMeta(imageUrl: string): Promise<VisualLensOutcome> {
  const key = env.serpApiKey;
  if (!key || !imageUrl) return { matches: [], fromCache: false, fetchedAt: null };
  const cacheKey = visualSearchCacheKey('lens', imageUrl);
  const hit = visualCacheGet<VisualMatch[]>(cacheKey);
  if (hit) {
    return { matches: hit.value, fromCache: true, fetchedAt: hit.fetchedAt };
  }
  if (isProviderBudgetExhausted('serpapi')) {
    logger.warn('visual-search: daily SerpAPI budget exhausted, skipping Lens call');
    return { matches: [], fromCache: false, fetchedAt: null };
  }
  // A live attempt spends one unit of the daily budget whether it
  // succeeds or not (SerpAPI bills per request).
  spendProviderBudget('serpapi');
  const callStart = Date.now();
  try {
    const url = new URL(LENS_ENDPOINT);
    url.searchParams.set('engine', 'google_lens');
    url.searchParams.set('image_url', imageUrl);
    url.searchParams.set('api_key', key);
    let res: Response;
    // A fresh AbortController per attempt: a timeout on attempt
    // 1 must not instantly abort the retry (its signal is spent).
    res = await withAiRetry(
      () => {
        const attemptController = new AbortController();
        const attemptTimer = setTimeout(() => attemptController.abort(), LENS_TIMEOUT_MS);
        return fetch(url.toString(), { signal: attemptController.signal }).finally(() =>
          clearTimeout(attemptTimer)
        );
      },
      { shouldRetryResult: (r) => isRetryableStatus(r.status) }
    );
    if (!res.ok) {
      logger.warn('visual-search: SerpAPI Lens request failed', { status: res.status });
      recordAiCall('serpapi', { success: false, latencyMs: Date.now() - callStart });
      return { matches: [], fromCache: false, fetchedAt: null };
    }
    const data = (await res.json()) as { visual_matches?: Array<Record<string, unknown>> };
    const matches = Array.isArray(data.visual_matches) ? data.visual_matches : [];
    recordAiCall('serpapi', { success: true, latencyMs: Date.now() - callStart });
    const normalized = matches.slice(0, 10).map((m) => ({
      title: typeof m.title === 'string' ? m.title : 'Untitled match',
      source: typeof m.source === 'string' ? m.source : null,
      link: typeof m.link === 'string' ? m.link : null,
      thumbnail: typeof m.thumbnail === 'string' ? m.thumbnail : null,
    }));
    const fetchedAt = new Date().toISOString();
    visualCacheSet(cacheKey, normalized);
    return { matches: normalized, fromCache: false, fetchedAt };
  } catch (err) {
    logger.warn('visual-search: SerpAPI Lens request errored', { error: String(err) });
    recordAiCall('serpapi', { success: false, latencyMs: Date.now() - callStart });
    return { matches: [], fromCache: false, fetchedAt: null };
  }
}

/**
 * SerpAPI google_lens visual search for a PUBLIC image URL.
 * Same result shape as before (VisualMatch[]) — use
 * searchVisualByImageUrlWithMeta when the caller needs to know
 * whether the result was cached. Kept so the engine's serpapi
 * provider and every existing caller keep working unchanged.
 */
export async function searchVisualByImageUrl(imageUrl: string): Promise<VisualMatch[]> {
  return (await searchVisualByImageUrlWithMeta(imageUrl)).matches;
}

// =====================================================================
// Hugging Face vector upgrade (Delta 1)
// =====================================================================

export const VECTOR_EMBEDDING_DIMS = 384;
export const VECTOR_CAPTION_MODEL = 'Salesforce/blip-image-captioning-base';
export const VECTOR_EMBED_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
export const MAX_VISUAL_SEARCH_IMAGE_BYTES = MAX_SCAN_IMAGE_BYTES; // 8 MB

const HF_INFERENCE_BASE = 'https://router.huggingface.co/hf-inference/models';
const HF_TIMEOUT_MS = 30_000;

/** True when HF_API_TOKEN is configured (server env only, never in git). */
export function isVectorSearchConfigured(): boolean {
  return Boolean(env.hfApiToken && env.hfApiToken.trim() !== '');
}

export type HfResult<T> =
  | {
      ok: true;
      value: T;
      /**
       * Section 19, Phase 8 (§12 #11) — true when this value came
       * from the visual-search result cache (no HF quota spent).
       * Absent/false means freshly computed. Callers must never
       * present a cached value as freshly computed.
       */
      cached?: boolean;
    }
  | { ok: false; error: string; retryable: boolean };

async function hfFetch(
  model: string,
  body: BodyInit,
  contentType: string
): Promise<HfResult<Response>> {
  const token = env.hfApiToken;
  if (!token) {
    return { ok: false, error: 'Hugging Face API token is not configured.', retryable: false };
  }
  // Section 19, Phase 1 (§12 #7) — global daily HF budget. When
  // exhausted, no live call is made; the caller falls back
  // honestly (keyword-assisted / catalog) instead of burning more.
  if (isProviderBudgetExhausted('huggingface')) {
    return {
      ok: false,
      error: 'Hugging Face visual features are unavailable today (daily provider budget reached). Please try again tomorrow.',
      retryable: false,
    };
  }
  // A live attempt spends one unit of the daily budget whether it
  // succeeds or not.
  spendProviderBudget('huggingface');
  const callStart = Date.now();
  try {
    // Section 19, Phase 1 (§12 #6) — honour the `retryable`
    // flag the audit found no caller honouring: a 503 (model
    // still loading on the free tier) or 429 is retried with
    // backoff (up to 3 attempts) instead of making the user retry
    // manually. 401/403 are not retryable and return immediately.
    // A fresh AbortController per attempt: a timeout on attempt 1
    // must not instantly abort the retry (its signal is spent).
    const res = await withAiRetry(
      () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);
        return fetch(`${HF_INFERENCE_BASE}/${model}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': contentType,
          },
          body,
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
      },
      { shouldRetryResult: (r) => isRetryableStatus(r.status) }
    );
    // Section 19, Phase 1 (§12 #5, #9) — in-memory usage +
    // latency for the admin summary. The durable `provider_health`
    // row is written by the visual-search route via the engine
    // result (this helper has no Supabase client in scope).
    recordAiCall('huggingface', { success: res.ok, latencyMs: Date.now() - callStart });
    return { ok: true, value: res };
  } catch (err) {
    recordAiCall('huggingface', { success: false, latencyMs: Date.now() - callStart });
    return {
      ok: false,
      error: `Hugging Face request failed: ${String(err)}`,
      retryable: true,
    };
  }
}

function hfErrorMessage(status: number, bodyText: string): { error: string; retryable: boolean } {
  // 503 from the Inference API means the model is still loading
  // (cold start on the free tier) — retryable, never a fake result.
  if (status === 503) {
    return {
      error: 'The captioning/embedding model is still loading on Hugging Face. Please try again in a moment.',
      retryable: true,
    };
  }
  if (status === 401 || status === 403) {
    return {
      error: 'The configured Hugging Face token was rejected. An admin needs to check HF_API_TOKEN.',
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      error: 'Hugging Face rate limit reached. Please try again later.',
      retryable: true,
    };
  }
  logger.warn('visual-search: Hugging Face request failed', { status, body: bodyText.slice(0, 200) });
  return { error: 'Visual search service failed. Please try again later.', retryable: true };
}

/** A URL is fetchable as a public image only when it is http(s). */
export function isPublicImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// =====================================================================
// SSRF guard (Section 18, audit §1 #2 / §12 item 7)
//
// isPublicImageUrl above is only a protocol check — it cannot stop a
// server-side fetch from reaching a private address. Before any
// bytes are fetched, the host is DNS-resolved server-side and EVERY
// returned address must be a public IP. Redirects are followed
// manually and each redirect target is validated the same way, so a
// public URL cannot 302 to 169.254.169.254, localhost, or any
// RFC-1918 address. Any failure (bad URL, unresolvable host, DNS
// error) rejects — fail closed. No host allowlist: no merchant host
// is known yet (audit item 39, explicitly blocked).
//
// Residual limitation (documented, not hidden): the address is
// checked at validation time, while fetch resolves the host again
// at request time, so a DNS-rebinding host could in theory answer
// differently between the two lookups. Closing that gap needs an
// IP-pinned fetch (custom lookup/dial), which Node's fetch does not
// offer — out of scope for this item.
// =====================================================================

function isPrivateIpv4Address(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  // Malformed literal: fail closed.
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0) return true; // 0.0.0.0/8 — "this network" / unspecified
  if (a === 10) return true; // RFC-1918 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 127) return true; // loopback 127/8
  if (a === 169 && b === 254) return true; // link-local 169.254/16 (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC-1918 172.16/12
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments 192.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1 192.0.2/24
  if (a === 192 && b === 168) return true; // RFC-1918 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2 198.51.100/24
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3 203.0.113/24
  if (a >= 224) return true; // multicast 224/4 + reserved 240/4
  return false;
}

function isPrivateIpv6Address(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:7f00:1) — unwrap and
  // judge the embedded IPv4 address.
  if (lower.startsWith('::ffff:')) {
    const rest = lower.slice('::ffff:'.length);
    if (rest.includes('.')) return isPrivateIpv4Address(rest);
    const groups = rest.split(':');
    if (groups.length === 2) {
      const hi = parseInt(groups[0], 16);
      const lo = parseInt(groups[1], 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        return isPrivateIpv4Address(
          `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
        );
      }
    }
    return true; // unparseable mapped form: fail closed
  }
  const firstGroup = parseInt(lower.split(':')[0] || '', 16);
  if (Number.isNaN(firstGroup)) return true; // malformed: fail closed
  if (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) return true; // link-local fe80::/10
  if (firstGroup >= 0xfc00 && firstGroup <= 0xfdff) return true; // unique-local fc00::/7
  if (firstGroup >= 0xff00) return true; // multicast ff00::/8
  if (lower.startsWith('2001:db8')) return true; // documentation 2001:db8::/32
  return false;
}

/** True when the IP is loopback, private, link-local, or otherwise non-public. Non-IP input fails closed. */
export function isPrivateIpAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4Address(ip);
  if (family === 6) return isPrivateIpv6Address(ip);
  return true;
}

/**
 * Async SSRF guard: http(s) only, and every address the host
 * resolves to must be public. Literal IPs are checked directly
 * (no DNS); hostnames are resolved with dns/promises and ALL
 * returned addresses are checked, not just the first. DNS failure
 * or an empty answer rejects (fail closed).
 */
export async function isSafePublicImageUrl(value: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname;
  if (!host) return false;
  if (isIP(host) !== 0) return !isPrivateIpAddress(host);
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return false; // DNS failure: fail closed
  }
  if (!addresses || addresses.length === 0) return false;
  return addresses.every((a) => !isPrivateIpAddress(a.address));
}

/** Maximum manual redirect hops followed when fetching an image. */
export const MAX_IMAGE_FETCH_REDIRECTS = 3;

/**
 * Caption a PUBLIC image URL with BLIP image-captioning.
 * The URL's bytes are fetched server-side and forwarded to the model
 * — the model never fetches URLs itself. Returns the caption text,
 * or an error (never a guessed caption). Uploaded photos are never
 * accepted here: callers only pass user-pasted public URLs.
 */
export async function captionPublicImageUrl(imageUrl: string): Promise<HfResult<string>> {
  // SSRF guard (Section 18): DNS-resolve + reject private/loopback/
  // link-local/metadata addresses BEFORE any fetch. The route's own
  // isPublicImageUrl check is only a fast syntactic pre-check.
  if (!(await isSafePublicImageUrl(imageUrl))) {
    return { ok: false, error: 'Only public http(s) image URLs can be captioned.', retryable: false };
  }
  // Section 19, Phase 8 (§12 #11) — cache hit AFTER the SSRF
  // guard (the guard is cheap DNS, not quota; a cached URL must
  // still be re-validated in case its DNS changed) and BEFORE the
  // image fetch + HF call, so a hit spends no quota at all.
  const captionKey = visualSearchCacheKey('caption', imageUrl);
  const cachedCaption = visualCacheGet<string>(captionKey);
  if (cachedCaption) {
    return { ok: true, value: cachedCaption.value, cached: true };
  }
  let imageBytes: ArrayBuffer;
  let contentType = 'application/octet-stream';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);
    let res: Response;
    try {
      // Redirects are followed MANUALLY (never fetch's default):
      // each redirect target is re-validated with the same SSRF
      // guard before it is fetched, so a public URL cannot 302 to
      // a private address. One 30s budget covers all hops.
      let currentUrl = imageUrl;
      let fetched: Response | null = null;
      for (let hop = 0; hop <= MAX_IMAGE_FETCH_REDIRECTS; hop++) {
        fetched = await fetch(currentUrl, { signal: controller.signal, redirect: 'manual' });
        if (fetched.status < 300 || fetched.status >= 400) break;
        const location = fetched.headers.get('location');
        if (!location) {
          return {
            ok: false,
            error: `Could not fetch the image URL (HTTP ${fetched.status}). Check that the link is public.`,
            retryable: false,
          };
        }
        if (hop === MAX_IMAGE_FETCH_REDIRECTS) {
          return { ok: false, error: 'That image URL redirects too many times.', retryable: false };
        }
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          return { ok: false, error: 'That image URL has an invalid redirect.', retryable: false };
        }
        if (!(await isSafePublicImageUrl(nextUrl))) {
          return {
            ok: false,
            error: 'That image URL redirects to a non-public address.',
            retryable: false,
          };
        }
        currentUrl = nextUrl;
      }
      res = fetched as Response;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return {
        ok: false,
        error: `Could not fetch the image URL (HTTP ${res.status}). Check that the link is public.`,
        retryable: false,
      };
    }
    const length = Number(res.headers.get('content-length') ?? '0');
    if (length > MAX_VISUAL_SEARCH_IMAGE_BYTES) {
      return { ok: false, error: 'That image is over 8 MB. Please use a smaller one.', retryable: false };
    }
    const type = res.headers.get('content-type') ?? '';
    if (type && !type.startsWith('image/')) {
      return { ok: false, error: 'That URL does not point to an image.', retryable: false };
    }
    if (type) contentType = type;
    imageBytes = await res.arrayBuffer();
    if (imageBytes.byteLength > MAX_VISUAL_SEARCH_IMAGE_BYTES) {
      return { ok: false, error: 'That image is over 8 MB. Please use a smaller one.', retryable: false };
    }
  } catch (err) {
    return { ok: false, error: `Could not fetch the image URL: ${String(err)}`, retryable: true };
  }

  const fetched = await hfFetch(VECTOR_CAPTION_MODEL, imageBytes, contentType);
  if (!fetched.ok) return fetched;
  const res = fetched.value;
  const bodyText = await res.text();
  if (!res.ok) {
    const { error, retryable } = hfErrorMessage(res.status, bodyText);
    return { ok: false, error, retryable };
  }
  try {
    const data = JSON.parse(bodyText) as Array<{ generated_text?: unknown }>;
    const caption = Array.isArray(data) ? data[0]?.generated_text : undefined;
    if (typeof caption !== 'string' || caption.trim() === '') {
      return { ok: false, error: 'The image could not be captioned.', retryable: false };
    }
    // Section 19, Phase 8 (§12 #11) — cache the fresh caption
    // (failures are never cached). The key is the image URL hash.
    const trimmedCaption = caption.trim();
    visualCacheSet(captionKey, trimmedCaption);
    return { ok: true, value: trimmedCaption };
  } catch {
    return { ok: false, error: 'The captioning service returned an unexpected response.', retryable: true };
  }
}

/**
 * Embed plain text with all-MiniLM-L6-v2 (384 dims). Returns the
 * embedding vector, or an error. The text is never stored.
 */
export async function embedText(text: string): Promise<HfResult<number[]>> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: 'Nothing to embed: the text is empty.', retryable: false };
  }
  // Section 19, Phase 8 (§12 #11) — same caption text embeds to
  // the same vector; a cache hit skips hfFetch entirely, so no HF
  // budget is spent. The key includes the model ('embed' vs
  // 'embed-clip') — the two spaces must never share an entry.
  const embedKey = visualSearchCacheKey('embed', trimmed);
  const cachedEmbed = visualCacheGet<number[]>(embedKey);
  if (cachedEmbed) {
    return { ok: true, value: cachedEmbed.value, cached: true };
  }
  const fetched = await hfFetch(
    VECTOR_EMBED_MODEL,
    JSON.stringify({ inputs: trimmed }),
    'application/json'
  );
  if (!fetched.ok) return fetched;
  const res = fetched.value;
  const bodyText = await res.text();
  if (!res.ok) {
    const { error, retryable } = hfErrorMessage(res.status, bodyText);
    return { ok: false, error, retryable };
  }
  try {
    const data = JSON.parse(bodyText) as unknown;
    // Single-string input returns a flat number[]; an array input
    // would return number[][]. We only ever send one string.
    if (
      !Array.isArray(data) ||
      data.length !== VECTOR_EMBEDDING_DIMS ||
      !data.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      return { ok: false, error: 'The embedding service returned an unexpected response.', retryable: true };
    }
    visualCacheSet(embedKey, data as number[]);
    return { ok: true, value: data as number[] };
  } catch {
    return { ok: false, error: 'The embedding service returned an unexpected response.', retryable: true };
  }
}

/**
 * Catalog text embedded for a product: name + brand + description.
 * The same shape must be used by the backfill route and by any
 * future re-embed, so a product's stored vector always means the
 * same thing. Empty parts are skipped, never replaced with guesses.
 * scripts/embed-products-local.mjs carries a plain-JS copy of this
 * exact shape — keep the two in sync.
 */
export function productEmbeddingText(input: {
  name: string;
  brand?: string | null;
  description?: string | null;
}): string {
  return [input.name, input.brand, input.description]
    .map((part) => (part ?? '').trim())
    .filter((part) => part !== '')
    .join(' — ');
}

// =====================================================================
// CLIP space (512 dims) — separate from the MiniLM space (384 dims)
// =====================================================================
//
// CLIP text embeddings are 512-dimensional and live in their own
// table (product_clip_embeddings) and RPC (match_clip_products).
// The two embedding spaces are NOT comparable and must never be
// mixed: a 512-dim CLIP vector goes only into the 512-dim table,
// and a query is matched only against its own space.
//
// The CLIP vectors are generated OFFLINE by
// scripts/embed-products-local.mjs (local CLIP text encoder, zero
// API calls). The serverless route never runs the CLIP model — the
// model (~150-250 MB text encoder alone) cannot load inside a
// Vercel Hobby function. The route only embeds the caption TEXT
// via the Hugging Face Inference API (feature-extraction) and
// matches it against the stored CLIP vectors.

export const CLIP_EMBEDDING_DIMS = 512;
/** HF Inference API repo id for the CLIP model (original weights). */
export const CLIP_EMBED_MODEL = 'openai/clip-vit-base-patch32';
/** Local transformers.js model id (verified from the installed
 * @huggingface/transformers v4.3.2 package's own pipeline registry,
 * which defaults zero-shot-image-classification to this ID). */
export const CLIP_MODEL_ID = 'Xenova/clip-vit-base-patch32';

/**
 * Normalize a CLIP embedding response into a flat 512-dim vector.
 * The Inference API's feature-extraction output shape is not
 * guaranteed: a single text may come back as a flat 512 vector, as
 * per-token vectors [seq][512], or as a batched [1][seq][512]
 * tensor. Token-level outputs are mean-pooled (the standard
 * sentence-embedding fallback). Anything else returns null — the
 * caller falls back to the MiniLM path, never a guessed vector.
 */
export function normalizeClipEmbedding(data: unknown): number[] | null {
  const isFiniteVec = (v: unknown): v is number[] =>
    Array.isArray(v) &&
    v.length === CLIP_EMBEDDING_DIMS &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n));

  if (isFiniteVec(data)) return [...data];

  // 2D: [seq][512] — mean-pool over tokens.
  if (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((row) => isFiniteVec(row))
  ) {
    const pooled: number[] = new Array(CLIP_EMBEDDING_DIMS).fill(0);
    for (const row of data as number[][]) {
      for (let i = 0; i < CLIP_EMBEDDING_DIMS; i++) pooled[i] += row[i];
    }
    for (let i = 0; i < CLIP_EMBEDDING_DIMS; i++) pooled[i] /= data.length;
    return pooled;
  }

  // 3D: [1][seq][512] — unwrap the batch dim, then as 2D above.
  if (
    Array.isArray(data) &&
    data.length === 1 &&
    Array.isArray(data[0]) &&
    (data[0] as unknown[]).length > 0 &&
    (data[0] as unknown[]).every((row) => isFiniteVec(row))
  ) {
    return normalizeClipEmbedding(data[0]);
  }

  return null;
}

/**
 * Embed plain text with CLIP's text encoder (512 dims) via the
 * Hugging Face Inference API feature-extraction endpoint. Returns
 * the embedding vector, or an error — the route falls back to the
 * MiniLM path on any failure. The text is never stored.
 */
export async function embedTextClip(text: string): Promise<HfResult<number[]>> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: 'Nothing to embed: the text is empty.', retryable: false };
  }
  // Section 19, Phase 8 (§12 #11) — same cache as embedText, but
  // a separate 'embed-clip' key: the CLIP space (512 dims) must
  // never serve a MiniLM (384-dim) entry or vice versa.
  const clipKey = visualSearchCacheKey('embed-clip', trimmed);
  const cachedClip = visualCacheGet<number[]>(clipKey);
  if (cachedClip) {
    return { ok: true, value: cachedClip.value, cached: true };
  }
  const fetched = await hfFetch(
    CLIP_EMBED_MODEL,
    JSON.stringify({ inputs: trimmed }),
    'application/json'
  );
  if (!fetched.ok) return fetched;
  const res = fetched.value;
  const bodyText = await res.text();
  if (!res.ok) {
    const { error, retryable } = hfErrorMessage(res.status, bodyText);
    return { ok: false, error, retryable };
  }
  try {
    const data = JSON.parse(bodyText) as unknown;
    const vector = normalizeClipEmbedding(data);
    if (!vector) {
      return { ok: false, error: 'The CLIP embedding service returned an unexpected response.', retryable: true };
    }
    visualCacheSet(clipKey, vector);
    return { ok: true, value: vector };
  } catch {
    return { ok: false, error: 'The CLIP embedding service returned an unexpected response.', retryable: true };
  }
}
