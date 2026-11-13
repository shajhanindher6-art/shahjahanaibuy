/**
 * Section 20, §12 #94 — product image URL validation (review time).
 *
 * Pure function, no DB, no network. Intake stored `image_url`
 * with zero validation and rendered it raw in `<img>` — a
 * `data:` URL, a `javascript:` URL, a tracking-pixel host or a
 * 10 KB URL could be stored by any admin CSV upload. This is
 * the review-time gate: it runs in catalog intake (CSV + eBay,
 * which shares the same review) and in the pipeline image
 * processor, so a bad URL is rejected / dropped before it is
 * ever stored — never silently rewritten into something else.
 *
 * Rules:
 * - http(s) only — `data:`, `javascript:`, `blob:`, `ftp:` and
 *   relative paths are all rejected.
 * - Length cap (2048 chars) — over-long URLs are rejected, not
 *   truncated (truncation would store a broken URL).
 * - Host sanity — a real hostname with a dot (no `localhost`,
 *   no bare hostname, no IP-literal tricks via credentials);
 *   no embedded username/password (tracking / phishing shape);
 *   no whitespace or control characters.
 * - No host allowlist here: merchant image hosts are not known
 *   (Section 18 item 39 still blocked — no real merchant image
 *   host list exists), so any public https host is accepted and
 *   the CSP `img-src https:` rule is the backstop. An allowlist
 *   must wait for the owner image-host policy decision (§12 #102).
 */

export const IMAGE_URL_MAX_LENGTH = 2048;

export interface ImageUrlValidation {
  valid: boolean;
  /** Trimmed URL when valid, otherwise null. */
  normalized: string | null;
  /** Human-readable reason when invalid, otherwise null. */
  reason: string | null;
}

export function validateImageUrl(value: unknown): ImageUrlValidation {
  if (typeof value !== 'string' || value.trim() === '') {
    return { valid: false, normalized: null, reason: 'Image URL is empty' };
  }
  const url = value.trim();
  if (url.length > IMAGE_URL_MAX_LENGTH) {
    return {
      valid: false,
      normalized: null,
      reason: `Image URL is longer than ${IMAGE_URL_MAX_LENGTH} characters`,
    };
  }
  if (/[\s\x00-\x1f\x7f]/.test(url)) {
    return {
      valid: false,
      normalized: null,
      reason: 'Image URL contains whitespace or control characters',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, normalized: null, reason: 'Image URL is not a valid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      normalized: null,
      reason: `Image URL must use http(s), got "${parsed.protocol}"`,
    };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return {
      valid: false,
      normalized: null,
      reason: 'Image URL must not contain embedded credentials',
    };
  }
  const hostname = parsed.hostname;
  if (!hostname || !hostname.includes('.')) {
    return {
      valid: false,
      normalized: null,
      reason: 'Image URL must have a valid hostname',
    };
  }
  return { valid: true, normalized: url, reason: null };
}

/** Convenience boolean wrapper around `validateImageUrl`. */
export function isValidImageUrl(value: unknown): boolean {
  return validateImageUrl(value).valid;
}
