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

import { logger } from '@/lib/config/logger';
import { env } from '@/lib/config/env';

export const MAX_SCAN_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

export type ScanMode = 'visual' | 'keyword-assisted' | 'needs-keywords';

export interface VisualMatch {
  title: string;
  source: string | null;
  link: string | null;
  thumbnail: string | null;
}

/** Client-side validation for an uploaded/captured image. Null = OK. */
export function validateScanImage(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) return 'Please choose an image file (JPG, PNG, or WebP).';
  if (file.size > MAX_SCAN_IMAGE_BYTES) return 'That image is over 8 MB. Please choose a smaller photo.';
  return null;
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

/**
 * SerpAPI google_lens visual search for a PUBLIC image URL.
 * Returns [] (never throws) on any failure so the caller can fall
 * back to keyword-assisted search with an honest note.
 */
export async function searchVisualByImageUrl(imageUrl: string): Promise<VisualMatch[]> {
  const key = env.serpApiKey;
  if (!key || !imageUrl) return [];
  try {
    const url = new URL(LENS_ENDPOINT);
    url.searchParams.set('engine', 'google_lens');
    url.searchParams.set('image_url', imageUrl);
    url.searchParams.set('api_key', key);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LENS_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url.toString(), { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      logger.warn('visual-search: SerpAPI Lens request failed', { status: res.status });
      return [];
    }
    const data = (await res.json()) as { visual_matches?: Array<Record<string, unknown>> };
    const matches = Array.isArray(data.visual_matches) ? data.visual_matches : [];
    return matches.slice(0, 10).map((m) => ({
      title: typeof m.title === 'string' ? m.title : 'Untitled match',
      source: typeof m.source === 'string' ? m.source : null,
      link: typeof m.link === 'string' ? m.link : null,
      thumbnail: typeof m.thumbnail === 'string' ? m.thumbnail : null,
    }));
  } catch (err) {
    logger.warn('visual-search: SerpAPI Lens request errored', { error: String(err) });
    return [];
  }
}

// =====================================================================
// Hugging Face vector upgrade (Delta 1)
// =====================================================================

export const VECTOR_EMBEDDING_DIMS = 384;
export const VECTOR_CAPTION_MODEL = 'Salesforce/blip-image-captioning-base';
export const VECTOR_EMBED_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
export const MAX_VISUAL_SEARCH_IMAGE_BYTES = MAX_SCAN_IMAGE_BYTES; // 8 MB

const HF_INFERENCE_BASE = 'https://api-inference.huggingface.co/models';
const HF_TIMEOUT_MS = 30_000;

/** True when HF_API_TOKEN is configured (server env only, never in git). */
export function isVectorSearchConfigured(): boolean {
  return Boolean(env.hfApiToken && env.hfApiToken.trim() !== '');
}

export type HfResult<T> =
  | { ok: true; value: T }
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);
  try {
    const res = await fetch(`${HF_INFERENCE_BASE}/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body,
      signal: controller.signal,
    });
    return { ok: true, value: res };
  } catch (err) {
    return {
      ok: false,
      error: `Hugging Face request failed: ${String(err)}`,
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
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

/**
 * Caption a PUBLIC image URL with BLIP image-captioning.
 * The URL's bytes are fetched server-side and forwarded to the model
 * — the model never fetches URLs itself. Returns the caption text,
 * or an error (never a guessed caption). Uploaded photos are never
 * accepted here: callers only pass user-pasted public URLs.
 */
export async function captionPublicImageUrl(imageUrl: string): Promise<HfResult<string>> {
  if (!isPublicImageUrl(imageUrl)) {
    return { ok: false, error: 'Only public http(s) image URLs can be captioned.', retryable: false };
  }
  let imageBytes: ArrayBuffer;
  let contentType = 'application/octet-stream';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(imageUrl, { signal: controller.signal });
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
    return { ok: true, value: caption.trim() };
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
    return { ok: true, value: vector };
  } catch {
    return { ok: false, error: 'The CLIP embedding service returned an unexpected response.', retryable: true };
  }
}
