/**
 * Image processing service — validates, deduplicates, and optionally uploads
 * product images to the storage provider.
 *
 * Phase 2: validates URLs, deduplicates within a product, and returns
 * processed image URLs. When a storage provider is available, images can
 * be uploaded to R2/S3 and the CDN URL returned.
 *
 * Section 21–25, Stage C (B8, K6, K7) — the pipeline is no longer
 * URL-only, and `uploadToStorage` is no longer a log line:
 *
 * - Format validation: `validateImageFormat` checks the URL's
 *   extension (jpg / jpeg / png / webp / gif / avif) and, when a
 *   HEAD check runs, the response content-type. An extensionless
 *   URL is NOT rejected — merchant image URLs are often
 *   extensionless (signed CDN URLs) — it is reported as
 *   'unknown' format instead of guessed.
 * - Allowlist: `getImageAllowlist` reads `IMAGE_ALLOWED_HOSTS`
 *   (comma-separated hostnames) from env. The list is EMPTY by
 *   default — no host is known and none is invented — and an empty
 *   list is FAIL-CLOSED: `isImageHostAllowlisted` returns false
 *   for every host until the owner supplies hosts. The allowlist
 *   gates STORAGE uploads, not reads: a non-allowlisted image URL
 *   is still kept as a hotlink (the previous behaviour), it is
 *   simply never uploaded/stored.
 * - Accessibility check: `checkImageAccessible` issues a HEAD
 *   request (5s timeout, injectable fetch for tests) and reports
 *   reachable / unreachable / unchecked. It runs only when the
 *   caller asks (`checkAccessibility: true`) — ingestion does not
 *   block on a merchant CDN being slow.
 * - Optimized variants: `buildImageVariants` returns thumbnail /
 *   medium / large descriptors ONLY when `IMAGE_CDN_BASE` is
 *   configured; otherwise null. No variant URL is ever fabricated
 *   from a host that was not configured.
 * - Caching: validation results are cached in-process for
 *   `IMAGE_VALIDATION_CACHE_TTL_MS` (default 1h) so a repeated
 *   URL is not re-validated on every ingest; the cache holds only
 *   validation verdicts, never image bytes.
 * - Fallbacks: `resolvePrimaryImage` returns the first kept image
 *   or null — there is no invented placeholder URL anywhere; the
 *   UI renders its own honest placeholder when this is null.
 * - Verification status: every detailed result carries
 *   `verificationStatus` — 'verified' (reachable + image
 *   content-type), 'unreachable' (HEAD failed), 'unchecked'
 *   (no check requested) or 'invalid' (failed validation).
 * - Storage upload: `uploadImageToStorage` fetches the bytes
 *   (10 MB cap, content-type must be an image) and stores them
 *   through an injected `ImageStorageUploader`. It is ENV-GATED
 *   and FAIL-CLOSED: without `IMAGE_STORAGE_BUCKET` it returns
 *   `{ ok: false, reason: 'not-configured' }` and the caller keeps
 *   the original URL — nothing claims to be stored that was not.
 *   `createSupabaseStorageUploader` adapts a Supabase client to
 *   the uploader interface.
 *
 * `processImages` keeps its exact historical return shape
 * (`{ url, isPrimary }[]`) so existing callers and tests are
 * unaffected; `processImagesDetailed` is the rich path.
 */

import { logger } from '@/lib/config/logger';
import { validateImageUrl } from '@/lib/image-url';
import {
  getAllowedImageHosts,
  isAllowedImageHost,
  getImageAllowlistConfig,
} from '@/lib/image-allowlist';

export { getImageAllowlistConfig };

export interface ProcessedImage {
  url: string;
  isPrimary: boolean;
}

/** Image formats the pipeline recognises from a URL extension. */
export const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

/** How far an image's verification got. */
export type ImageVerificationStatus = 'verified' | 'unreachable' | 'unchecked' | 'invalid';

/** How far a storage upload got. */
export type ImageUploadStatus = 'not-requested' | 'stored' | 'not-configured' | 'failed';

export interface ImageVariant {
  /** 'thumbnail' | 'medium' | 'large'. */
  size: string;
  url: string;
  width: number;
}

export interface DetailedProcessedImage extends ProcessedImage {
  format: ImageFormat | 'unknown';
  verificationStatus: ImageVerificationStatus;
  /** True when the host is on the owner-supplied allowlist. */
  allowlisted: boolean;
  /** Stored URL when the upload succeeded, otherwise null. */
  uploadedUrl: string | null;
  uploadStatus: ImageUploadStatus;
  /** Optimized variants, or null when no image CDN is configured. */
  variants: ImageVariant[] | null;
  /** True when the verdict came from the validation cache. */
  cached: boolean;
  /** Human-readable reason when the image was dropped or unverifiable. */
  reason: string | null;
}

/** Max image bytes fetched for a storage upload (10 MB). */
export const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** Timeout for the accessibility HEAD check. */
export const IMAGE_HEAD_TIMEOUT_MS = 5_000;

function envNonEmpty(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The owner-supplied image-host allowlist (`IMAGE_ALLOWED_HOSTS`,
 * comma-separated). EMPTY by default — no host is known and none
 * is invented. An empty list means "nothing is allowlisted"
 * (fail-closed), never "everything is allowed".
 *
 * FINAL 100%, F-P2-25 — this now delegates to the canonical
 * module `lib/image-allowlist.ts` (exact-host only). The previous
 * implementation here allowed subdomains via `endsWith`, so the
 * two modules disagreed on the same env var; the canonical rule
 * is exact-host, and these exports stay only so existing callers
 * keep compiling against the same names.
 */
export function getImageAllowlist(): string[] {
  return getAllowedImageHosts();
}

/** True only when the URL's host is on the allowlist (false when the list is empty). */
export function isImageHostAllowlisted(url: string): boolean {
  return isAllowedImageHost(url);
}

// ---------------------------------------------------------------------------
// FINAL 100%, F-P2-28 — URL normalization + dedupe + content hash
// ---------------------------------------------------------------------------

/**
 * Canonical form of an image URL for dedupe: scheme and host
 * lower-cased, default ports stripped, fragment dropped, one
 * trailing slash removed from a non-root path. The query string
 * is left EXACTLY as-is — reordering it could break signed CDN
 * URLs, and a signed URL's spelling is part of its identity.
 * Returns the trimmed input unchanged when it does not parse.
 */
export function normalizeImageUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    if (
      (parsed.protocol === 'https:' && parsed.port === '443') ||
      (parsed.protocol === 'http:' && parsed.port === '80')
    ) {
      parsed.port = '';
    }
    parsed.hash = '';
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

/**
 * Deterministic 53-bit hash of a (normalized) image URL, as a
 * hex string — the dedupe key for cross-product duplicate
 * detection. This is a non-cryptographic URL hash, not a content
 * hash: two different spellings of the same URL hash alike
 * (after normalization), two different images at different URLs
 * do not. For byte-level identity use `computeImageContentHash`.
 */
export function hashImageUrl(url: string): string {
  const input = normalizeImageUrl(url);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/**
 * SHA-256 content hash of image bytes (hex). Async — used by the
 * storage-upload path, which already holds the bytes. Two
 * different URLs serving identical bytes hash alike, which is
 * what URL dedupe alone can never see.
 */
export async function computeImageContentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface CrossProductDuplicateImage {
  /** Normalized URL all rows in the group share. */
  normalizedUrl: string;
  /** Content-hash key when known, otherwise the URL hash. */
  hash: string;
  productIds: string[];
}

/**
 * Cross-product duplicate detection: group (productId, url)
 * pairs by normalized URL. A group with 2+ distinct products is
 * the same image stored under two products — reported, never
 * silently deleted. Pure.
 */
export function findCrossProductDuplicateImages(
  rows: Array<{ productId: string; url: string }>
): CrossProductDuplicateImage[] {
  const groups = new Map<string, Set<string>>();
  for (const row of rows) {
    const normalized = normalizeImageUrl(row.url);
    const set = groups.get(normalized) ?? new Set<string>();
    set.add(row.productId);
    groups.set(normalized, set);
  }
  const out: CrossProductDuplicateImage[] = [];
  for (const [normalizedUrl, productIds] of groups) {
    if (productIds.size > 1) {
      out.push({ normalizedUrl, hash: hashImageUrl(normalizedUrl), productIds: [...productIds] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// FINAL 100%, F-P1-39 / F-P2-29 — pipeline config (env-gated, honest)
// ---------------------------------------------------------------------------

export interface ImagePipelineConfig {
  /** HEAD-check every kept image (IMAGE_PIPELINE_CHECK_ACCESSIBILITY=true). */
  checkAccessibility: boolean;
  /** Attempt storage upload for allowlisted hosts (IMAGE_PIPELINE_UPLOAD_TO_STORAGE=true). */
  uploadToStorage: boolean;
  /** Storage bucket configured (IMAGE_STORAGE_BUCKET set). */
  storageConfigured: boolean;
  /** Allowlist configured (IMAGE_ALLOWED_HOSTS non-empty). */
  allowlistConfigured: boolean;
  /** Honest status line: what the rich path will actually do. */
  status: string;
}

/**
 * The rich image path, behind config. Defaults are OFF: the
 * pipeline never blocks on a merchant CDN being slow and never
 * claims an upload it did not do. When the owner enables the
 * flags, ingestion exercises the full rich path (accessibility
 * HEAD check + storage upload + per-image verification status);
 * when storage or the allowlist is unconfigured, the upload
 * reports 'not-configured' and the hotlink is kept.
 */
export function getImagePipelineConfig(): ImagePipelineConfig {
  const checkAccessibility = process.env.IMAGE_PIPELINE_CHECK_ACCESSIBILITY === 'true';
  const uploadToStorage = process.env.IMAGE_PIPELINE_UPLOAD_TO_STORAGE === 'true';
  const storageConfigured = isImageStorageConfigured();
  const allowlistConfigured = getImageAllowlistConfig().configured;
  const parts: string[] = [];
  parts.push(checkAccessibility ? 'accessibility HEAD check on' : 'accessibility HEAD check off');
  parts.push(uploadToStorage ? 'storage upload requested' : 'storage upload off');
  if (uploadToStorage && !storageConfigured) {
    parts.push('IMAGE_STORAGE_BUCKET unset — uploads will report not-configured, hotlinks kept');
  }
  if (uploadToStorage && !allowlistConfigured) {
    parts.push('IMAGE_ALLOWED_HOSTS empty — no host is allowlisted, uploads cannot run');
  }
  return {
    checkAccessibility,
    uploadToStorage,
    storageConfigured,
    allowlistConfigured,
    status: parts.join('; '),
  };
}

/**
 * Format of an image URL from its extension. Extensionless URLs
 * report 'unknown' — merchant CDN URLs are often extensionless,
 * and guessing a format from nothing would be fabrication.
 * A query string / fragment is ignored when reading the extension.
 */
export function validateImageFormat(url: string): {
  format: ImageFormat | 'unknown';
  valid: boolean;
  reason: string | null;
} {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return { format: 'unknown', valid: false, reason: 'Image URL is not a valid URL' };
  }
  const match = /\.([a-z0-9]+)$/i.exec(pathname);
  if (!match) {
    return { format: 'unknown', valid: true, reason: 'Image URL has no file extension' };
  }
  const ext = match[1].toLowerCase();
  if ((IMAGE_FORMATS as readonly string[]).includes(ext)) {
    return { format: ext as ImageFormat, valid: true, reason: null };
  }
  return { format: 'unknown', valid: false, reason: `Image format ".${ext}" is not supported` };
}

// ---------------------------------------------------------------------------
// Validation cache (verdicts only, never bytes)
// ---------------------------------------------------------------------------

interface CachedVerdict {
  valid: boolean;
  checkedAt: number;
}

const validationCache = new Map<string, CachedVerdict>();

function imageValidationCacheTtlMs(): number {
  const raw = Number(process.env.IMAGE_VALIDATION_CACHE_TTL_MS ?? '');
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 1000;
}

/** Test-only: drop the in-process validation cache. */
export function clearImageValidationCacheForTests(): void {
  validationCache.clear();
}

function cachedValidateImageUrl(url: string): { valid: boolean; cached: boolean } {
  const now = Date.now();
  const hit = validationCache.get(url);
  if (hit && now - hit.checkedAt < imageValidationCacheTtlMs()) {
    return { valid: hit.valid, cached: true };
  }
  const valid = validateImageUrl(url).valid;
  validationCache.set(url, { valid, checkedAt: now });
  return { valid, cached: false };
}

// ---------------------------------------------------------------------------
// Accessibility check (HEAD, best-effort, caller-opted-in)
// ---------------------------------------------------------------------------

export interface ImageAccessibility {
  reachable: boolean;
  /** Response content-type when the HEAD succeeded. */
  contentType: string | null;
  reason: string | null;
}

/**
 * HEAD-check an image URL (5s timeout). Returns reachable:false
 * with a reason on any failure — network error, timeout, non-2xx,
 * or a non-image content-type. Never throws. The fetch
 * implementation is injectable so tests never hit the network.
 */
export async function checkImageAccessible(
  url: string,
  fetchFn: typeof fetch = fetch
): Promise<ImageAccessibility> {
  try {
    const response = await fetchFn(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(IMAGE_HEAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { reachable: false, contentType: null, reason: `HEAD returned HTTP ${response.status}` };
    }
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.toLowerCase().startsWith('image/')) {
      return {
        reachable: false,
        contentType,
        reason: `Content-Type is not an image ("${contentType}")`,
      };
    }
    return { reachable: true, contentType, reason: null };
  } catch (err) {
    return {
      reachable: false,
      contentType: null,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Optimized variants (only when an image CDN base is configured)
// ---------------------------------------------------------------------------

/**
 * Optimized variant URLs for an image, derived from the
 * configured image CDN base (`IMAGE_CDN_BASE`). Returns null when
 * no CDN base is configured — variant URLs are never fabricated
 * from an unconfigured host. Sizes are fixed (thumbnail 200px,
 * medium 800px, large 1600px) and the variant URL keeps the
 * original URL as the source parameter, so the CDN — not this
 * code — does the resizing.
 */
export function buildImageVariants(url: string): ImageVariant[] | null {
  const cdnBase = envNonEmpty('IMAGE_CDN_BASE');
  if (!cdnBase) return null;
  const base = cdnBase.replace(/\/$/, '');
  const sizes: Array<{ size: string; width: number }> = [
    { size: 'thumbnail', width: 200 },
    { size: 'medium', width: 800 },
    { size: 'large', width: 1600 },
  ];
  return sizes.map(({ size, width }) => ({
    size,
    width,
    url: `${base}/${width}w?src=${encodeURIComponent(url)}`,
  }));
}

// ---------------------------------------------------------------------------
// Storage upload (env-gated, fail-closed)
// ---------------------------------------------------------------------------

/** Minimal storage-uploader interface (Supabase Storage adapter below). */
export interface ImageStorageUploader {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<{
    path: string | null;
    error: string | null;
  }>;
}

export type ImageUploadResult =
  | { ok: true; storedUrl: string; path: string }
  | { ok: false; reason: 'not-configured' | 'fetch-failed' | 'too-large' | 'not-an-image' | 'upload-failed'; detail: string };

function storageBucket(): string | null {
  return envNonEmpty('IMAGE_STORAGE_BUCKET');
}

/** True only when a storage bucket is configured for image uploads. */
export function isImageStorageConfigured(): boolean {
  return storageBucket() !== null;
}

/**
 * Fetch an image and store it through `uploader`. Fail-closed:
 * without `IMAGE_STORAGE_BUCKET` (or without an uploader) the
 * result is `{ ok: false, reason: 'not-configured' }` — the caller
 * keeps the original URL and never claims the image was stored.
 * The fetch is capped at 10 MB and must return an image
 * content-type. Never throws.
 */
export async function uploadImageToStorage(
  sourceUrl: string,
  uploader: ImageStorageUploader | null,
  fetchFn: typeof fetch = fetch
): Promise<ImageUploadResult> {
  const bucket = storageBucket();
  if (!bucket || !uploader) {
    return {
      ok: false,
      reason: 'not-configured',
      detail:
        'Image storage is not configured (IMAGE_STORAGE_BUCKET is unset) — the image was not uploaded and the original URL is kept.',
    };
  }
  let bytes: Uint8Array;
  let contentType = 'image/jpeg';
  try {
    const response = await fetchFn(sourceUrl, {
      signal: AbortSignal.timeout(IMAGE_HEAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, reason: 'fetch-failed', detail: `Fetch returned HTTP ${response.status}` };
    }
    const type = response.headers.get('content-type');
    if (type && !type.toLowerCase().startsWith('image/')) {
      return { ok: false, reason: 'not-an-image', detail: `Content-Type is not an image ("${type}")` };
    }
    if (type) contentType = type.split(';')[0].trim();
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > IMAGE_UPLOAD_MAX_BYTES) {
      return {
        ok: false,
        reason: 'too-large',
        detail: `Image is ${buffer.byteLength} bytes, over the ${IMAGE_UPLOAD_MAX_BYTES}-byte cap`,
      };
    }
    bytes = new Uint8Array(buffer);
  } catch (err) {
    return {
      ok: false,
      reason: 'fetch-failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  const format = validateImageFormat(sourceUrl).format;
  const ext = format === 'unknown' ? 'jpg' : format;
  let path: string;
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    path = `${hex.slice(0, 16)}.${ext}`;
  } catch {
    path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  }
  const uploaded = await uploader.upload(path, bytes, contentType);
  if (!uploaded.path || uploaded.error) {
    return {
      ok: false,
      reason: 'upload-failed',
      detail: uploaded.error ?? 'Storage upload returned no path',
    };
  }
  return { ok: true, storedUrl: `${bucket}/${uploaded.path}`, path: uploaded.path };
}

/**
 * Adapt a Supabase client to `ImageStorageUploader` (uploads to
 * the `IMAGE_STORAGE_BUCKET` bucket). The caller owns the client;
 * this adapter only shapes the call. Public URL resolution is
 * the caller's job — the stored URL returned by
 * `uploadImageToStorage` is the bucket path, not a public URL.
 */
export function createSupabaseStorageUploader(supabase: {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        bytes: Uint8Array,
        options: { contentType: string; upsert: boolean }
      ) => Promise<{ data: { path: string } | null; error: { message: string } | null }>;
    };
  };
}): ImageStorageUploader {
  return {
    async upload(path, bytes, contentType) {
      const bucket = storageBucket();
      if (!bucket) return { path: null, error: 'IMAGE_STORAGE_BUCKET is not configured' };
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, bytes, { contentType, upsert: true });
      if (error || !data) return { path: null, error: error?.message ?? 'Upload failed' };
      return { path: data.path, error: null };
    },
  };
}

// ---------------------------------------------------------------------------
// Primary-image resolution + the two process entry points
// ---------------------------------------------------------------------------

/**
 * First kept image, or null when there is none. There is no
 * invented placeholder URL — the caller (or the UI) renders its
 * own honest placeholder when this is null.
 */
export function resolvePrimaryImage(images: DetailedProcessedImage[]): string | null {
  return images[0]?.url ?? null;
}

export interface ImageProcessingOptions {
  uploadToStorage?: boolean;
  maxImages?: number;
  /** Inject a storage uploader (tests / callers with a client). */
  storageUploader?: ImageStorageUploader | null;
  /** Inject a fetch implementation (tests). */
  fetchFn?: typeof fetch;
  /** When true, HEAD-check every kept image (5s timeout each). */
  checkAccessibility?: boolean;
}

export async function processImages(
  images: string[],
  options: ImageProcessingOptions = {}
): Promise<ProcessedImage[]> {
  const detailed = await processImagesDetailed(images, options);
  return detailed.map((img) => ({ url: img.url, isPrimary: img.isPrimary }));
}

/**
 * The rich image pipeline: validate (cached), dedupe, cap, then
 * per image — format, allowlist, optional accessibility check,
 * optional storage upload, optional CDN variants. An image that
 * fails validation is dropped with its reason; an image whose
 * upload is not-configured is KEPT as a hotlink (uploadStatus
 * 'not-configured' says so plainly) — failing closed on storage
 * must never delete the image itself.
 */
export async function processImagesDetailed(
  images: string[],
  options: ImageProcessingOptions = {}
): Promise<DetailedProcessedImage[]> {
  const maxImages = options.maxImages ?? 20;

  // Deduplicate URLs. Section 20, §12 #94 — a URL is kept only
  // when it passes review-time image validation (http(s) only,
  // no data:/javascript:, length cap, host sanity). The old
  // startsWith('http') check let data: and credential-bearing
  // URLs through; validation drops them instead of storing them.
  const seen = new Set<string>();
  const unique: string[] = [];
  const cachedFlags = new Map<string, boolean>();
  for (const url of images) {
    // FINAL 100%, F-P2-28 — dedupe on the NORMALIZED URL, not
    // the raw string: "HTTPS://H/x.jpg/" and "https://h/x.jpg"
    // are the same image and must not be stored twice. The
    // normalized form is what is kept, so the stored URL is
    // canonical too.
    const normalized = normalizeImageUrl(url);
    if (seen.has(normalized)) continue;
    const { valid, cached } = cachedValidateImageUrl(normalized);
    if (!valid) {
      logger.debug('Image processing: dropped invalid image URL', {
        url: normalized,
        reason: validateImageUrl(normalized).reason,
      });
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
    cachedFlags.set(normalized, cached);
  }

  const limited = unique.slice(0, maxImages);
  const out: DetailedProcessedImage[] = [];

  for (let i = 0; i < limited.length; i++) {
    const url = limited[i];
    const formatCheck = validateImageFormat(url);
    let verificationStatus: ImageVerificationStatus = 'unchecked';
    let reason: string | null = formatCheck.reason;
    if (!formatCheck.valid) {
      verificationStatus = 'invalid';
    } else if (options.checkAccessibility) {
      const access = await checkImageAccessible(url, options.fetchFn ?? fetch);
      if (access.reachable) {
        verificationStatus = 'verified';
        reason = null;
      } else {
        verificationStatus = 'unreachable';
        reason = access.reason;
      }
    }

    let uploadedUrl: string | null = null;
    let uploadStatus: ImageUploadStatus = 'not-requested';
    if (options.uploadToStorage) {
      if (!isImageHostAllowlisted(url)) {
        // Fail-closed on the allowlist: a host the owner has not
        // approved is never uploaded to storage. The hotlink is
        // kept; the upload is reported, not silently skipped.
        uploadStatus = 'not-configured';
        logger.debug('Image processing: storage upload skipped — host not allowlisted', { url });
      } else {
        const uploaded = await uploadImageToStorage(url, options.storageUploader ?? null, options.fetchFn ?? fetch);
        if (uploaded.ok) {
          uploadedUrl = uploaded.storedUrl;
          uploadStatus = 'stored';
        } else {
          uploadStatus = uploaded.reason === 'not-configured' ? 'not-configured' : 'failed';
          logger.debug('Image processing: storage upload did not store the image', {
            url,
            reason: uploaded.reason,
            detail: uploaded.detail,
          });
        }
      }
    }

    out.push({
      url,
      isPrimary: i === 0,
      format: formatCheck.format,
      verificationStatus,
      allowlisted: isImageHostAllowlisted(url),
      uploadedUrl,
      uploadStatus,
      variants: buildImageVariants(url),
      cached: cachedFlags.get(url) ?? false,
      reason,
    });
  }

  return out;
}
