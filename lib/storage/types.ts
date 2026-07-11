/**
 * Storage provider abstraction layer.
 *
 * This module defines the interface that all storage providers must implement.
 * Business logic depends only on `StorageProvider`, so the underlying backend
 * (Cloudflare R2, AWS S3, or a local in-memory store for development) can be
 * swapped without touching call sites.
 */

/**
 * A successfully stored object.
 */
export interface StorageObject {
  /** The storage key (path) the object was written under. */
  key: string;
  /** A URL that can be used to retrieve the object. */
  url: string;
  /** Size of the object in bytes. */
  size: number;
  /** MIME content type of the object. */
  contentType: string;
  /** ISO timestamp marking when the object was uploaded. */
  uploadedAt: string;
}

/**
 * Options accepted by `StorageProvider.upload`.
 */
export interface UploadOptions {
  /** MIME content type. Defaults to `application/octet-stream`. */
  contentType?: string;
  /** Cache-Control header value to attach to the stored object. */
  cacheControl?: string;
  /** Arbitrary user metadata to store alongside the object. */
  metadata?: Record<string, string>;
}

/**
 * Contract every storage backend must fulfill.
 *
 * Implementations must be safe to construct even when their backing service
 * is not configured — `isAvailable()` is the source of truth for whether the
 * provider can actually service requests. When unavailable, the other methods
 * should throw (or, for `getPublicUrl`, return an empty string) rather than
 * silently no-op.
 */
export interface StorageProvider {
  /** Stable unique identifier (e.g. `r2`, `s3`, `local`). */
  readonly key: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Returns true when the provider is configured and ready to serve. */
  isAvailable(): boolean;
  /** Uploads `data` under `key` and returns metadata about the stored object. */
  upload(
    key: string,
    data: Buffer | ArrayBuffer,
    options?: UploadOptions
  ): Promise<StorageObject>;
  /** Returns a short-lived signed URL for private access to `key`. */
  getSignedUrl(key: string, expiresInSec?: number): Promise<string>;
  /** Returns a public URL for `key` (empty string if unsupported/unavailable). */
  getPublicUrl(key: string): string;
  /** Permanently removes the object at `key`. */
  delete(key: string): Promise<void>;
  /** Returns true if an object exists at `key`. */
  exists(key: string): Promise<boolean>;
}
