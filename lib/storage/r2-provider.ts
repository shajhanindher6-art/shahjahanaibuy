/**
 * Cloudflare R2 storage provider.
 *
 * R2 exposes an S3-compatible API at `https://<account-id>.r2.cloudflarestorage.com`.
 * We use plain `fetch()` with an AWS Signature V4 signer (no AWS SDK dependency)
 * to PUT/GET/HEAD/DELETE objects.
 *
 * The provider is available only when all of the following are set:
 *   - CLOUDFLARE_R2_ACCOUNT_ID
 *   - CLOUDFLARE_R2_ACCESS_KEY_ID
 *   - CLOUDFLARE_R2_SECRET_ACCESS_KEY
 *   - CLOUDFLARE_R2_BUCKET (the bucket name to operate on)
 *
 * When unavailable, `isAvailable()` returns false and all other methods throw.
 */

import { logger } from '@/lib/config/logger';
import type { StorageObject, StorageProvider, UploadOptions } from './types';
import { signS3Request, formatAmzDate } from './sigv4';

const SERVICE = 's3';
const REGION = 'auto'; // R2 uses the `auto` region for SigV4.

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Optional public endpoint for constructing public URLs. */
  publicBaseUrl?: string;
}

function readConfig(): R2Config | null {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;
  const publicBaseUrl = process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

export class R2StorageProvider implements StorageProvider {
  readonly key = 'r2';
  readonly name = 'Cloudflare R2';

  private readonly config: R2Config | null;

  constructor() {
    this.config = readConfig();
    if (this.config) {
      logger.info('R2 storage provider initialized', { bucket: this.config.bucket });
    }
  }

  isAvailable(): boolean {
    return this.config !== null;
  }

  private requireConfig(): R2Config {
    if (!this.config) {
      throw new Error(
        'R2 storage provider is not available — set CLOUDFLARE_R2_ACCOUNT_ID, ' +
          'CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, and ' +
          'CLOUDFLARE_R2_BUCKET to enable it.'
      );
    }
    return this.config;
  }

  /**
   * Builds the canonical R2 S3 endpoint URL for a given object key.
   * R2 uses path-style addressing: `<account>.r2.cloudflarestorage.com/<bucket>/<key>`.
   */
  private objectUrl(config: R2Config, key: string): URL {
    const encodedKey = key
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    return new URL(
      `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${encodedKey}`
    );
  }

  async upload(
    key: string,
    data: Buffer | ArrayBuffer,
    options?: UploadOptions
  ): Promise<StorageObject> {
    const config = this.requireConfig();
    const contentType = options?.contentType ?? 'application/octet-stream';

    const body =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    const url = this.objectUrl(config, key);
    const amzDate = formatAmzDate();
    const headers: Record<string, string> = {
      'x-amz-date': amzDate,
      'content-type': contentType,
      'content-length': String(body.byteLength),
    };
    if (options?.cacheControl) {
      headers['cache-control'] = options.cacheControl;
    }
    if (options?.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        headers[`x-amz-meta-${k.toLowerCase()}`] = v;
      }
    }

    const signed = signS3Request({
      method: 'PUT',
      url,
      headers,
      body: body,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: REGION,
      service: SERVICE,
    });

    const res = await fetch(url, {
      method: 'PUT',
      headers: signed.headers,
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`R2 upload failed (${res.status}) for key "${key}": ${text}`);
    }

    logger.debug('R2 upload complete', { key, size: body.byteLength, contentType });

    return {
      key,
      url: this.getPublicUrl(key),
      size: body.byteLength,
      contentType,
      uploadedAt: new Date().toISOString(),
    };
  }

  async getSignedUrl(key: string, expiresInSec = 900): Promise<string> {
    const config = this.requireConfig();
    const expires = Math.max(1, Math.min(604800, Math.floor(expiresInSec))); // 1s..7d

    const url = this.objectUrl(config, key);
    url.searchParams.set('X-Amz-Expires', String(expires));

    const amzDate = formatAmzDate();
    const headers: Record<string, string> = {
      'x-amz-date': amzDate,
      host: url.host,
    };

    const signed = signS3Request({
      method: 'GET',
      url,
      headers,
      body: undefined,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: REGION,
      service: SERVICE,
    });

    url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    url.searchParams.set(
      'X-Amz-Credential',
      `${config.accessKeyId}/${amzDate.slice(0, 8)}/${REGION}/${SERVICE}/aws4_request`
    );
    url.searchParams.set('X-Amz-Date', amzDate);
    url.searchParams.set('X-Amz-SignedHeaders', signed.signedHeaders);
    url.searchParams.set('X-Amz-Signature', signed.headers.Authorization.split('Signature=')[1]);

    return url.toString();
  }

  getPublicUrl(key: string): string {
    if (!this.config) return '';
    const encodedKey = key
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    if (this.config.publicBaseUrl) {
      const base = this.config.publicBaseUrl.replace(/\/$/, '');
      return `${base}/${encodedKey}`;
    }
    // Without a public bucket mapping, R2 objects are private — return the
    // S3 endpoint path which is only reachable with a signed URL.
    return `${this.objectUrl(this.config, key).toString().split('?')[0]}`;
  }

  async delete(key: string): Promise<void> {
    const config = this.requireConfig();
    const url = this.objectUrl(config, key);
    const amzDate = formatAmzDate();
    const headers: Record<string, string> = { 'x-amz-date': amzDate };

    const signed = signS3Request({
      method: 'DELETE',
      url,
      headers,
      body: undefined,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: REGION,
      service: SERVICE,
    });

    const res = await fetch(url, { method: 'DELETE', headers: signed.headers });
    // 204 = deleted, 404 = already gone — both are acceptable.
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`R2 delete failed (${res.status}) for key "${key}": ${text}`);
    }
    logger.debug('R2 delete complete', { key });
  }

  async exists(key: string): Promise<boolean> {
    const config = this.requireConfig();
    const url = this.objectUrl(config, key);
    const amzDate = formatAmzDate();
    const headers: Record<string, string> = { 'x-amz-date': amzDate };

    const signed = signS3Request({
      method: 'HEAD',
      url,
      headers,
      body: undefined,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: REGION,
      service: SERVICE,
    });

    const res = await fetch(url, { method: 'HEAD', headers: signed.headers });
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    const text = await res.text().catch(() => '');
    throw new Error(`R2 exists check failed (${res.status}) for key "${key}": ${text}`);
  }
}
