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
