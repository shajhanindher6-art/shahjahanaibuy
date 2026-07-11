/**
 * Local in-memory storage provider.
 *
 * Intended for development and tests where no external object storage is
 * configured. It is always available and stores objects in an in-memory `Map`,
 * returning `data:` URLs so consumers can treat the result like any other
 * provider. Nothing persists across process restarts.
 */

import { logger } from '@/lib/config/logger';
import type { StorageObject, StorageProvider, UploadOptions } from './types';

interface LocalEntry {
  data: Uint8Array;
  contentType: string;
  uploadedAt: string;
}

/**
 * Converts raw bytes + content type into a `data:` URL.
 */
function toDataUrl(bytes: Uint8Array, contentType: string): string {
  let binary = '';
  const chunkSize = 0x8000; // 32k chunks — safe for String.fromCharCode
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64');
  return `data:${contentType};base64,${base64}`;
}

export class LocalStorageProvider implements StorageProvider {
  readonly key = 'local';
  readonly name = 'Local In-Memory Storage';

  private readonly store = new Map<string, LocalEntry>();

  isAvailable(): boolean {
    return true;
  }

  async upload(
    key: string,
    data: Buffer | ArrayBuffer,
    options?: UploadOptions
  ): Promise<StorageObject> {
    const contentType = options?.contentType ?? 'application/octet-stream';
    const bytes =
      data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);

    const uploadedAt = new Date().toISOString();
    this.store.set(key, { data: bytes, contentType, uploadedAt });

    logger.debug('Local storage upload', { key, size: bytes.length, contentType });

    return {
      key,
      url: toDataUrl(bytes, contentType),
      size: bytes.length,
      contentType,
      uploadedAt,
    };
  }

  async getSignedUrl(key: string, _expiresInSec?: number): Promise<string> {
    const entry = this.store.get(key);
    if (!entry) {
      throw new Error(`Local storage object not found: ${key}`);
    }
    // Local storage has no concept of signed URLs — the data URL is directly
    // usable and never expires.
    return toDataUrl(entry.data, entry.contentType);
  }

  getPublicUrl(key: string): string {
    const entry = this.store.get(key);
    if (!entry) {
      // No object yet — return a placeholder data URL so callers can build
      // references before uploading, matching the behavior of remote providers
      // which synthesize URLs without checking existence.
      return `data:application/octet-stream;base64,`;
    }
    return toDataUrl(entry.data, entry.contentType);
  }

  async delete(key: string): Promise<void> {
    if (this.store.delete(key)) {
      logger.debug('Local storage delete', { key });
    }
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }
}
