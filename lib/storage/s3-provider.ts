/**
 * AWS S3 storage provider.
 *
 * Talks to the S3 REST API using plain `fetch()` with AWS Signature V4 (no
 * AWS SDK dependency). Uses virtual-host-style addressing by default:
 *   https://<bucket>.s3.<region>.amazonaws.com/<key>
 *
 * The provider is available only when all of the following are set:
 *   - AWS_S3_ACCESS_KEY_ID
 *   - AWS_S3_SECRET_ACCESS_KEY
 *   - AWS_S3_REGION
 *   - AWS_S3_BUCKET (the bucket name to operate on)
 *
 * Optional:
 *   - AWS_S3_PUBLIC_BASE_URL — custom public endpoint (e.g. CloudFront) used
 *     to build public URLs. Falls back to the S3 virtual-host URL otherwise.
 *
 * When unavailable, `isAvailable()` returns false and all other methods throw.
 */

import { logger } from '@/lib/config/logger';
import type { StorageObject, StorageProvider, UploadOptions } from './types';
import { signS3Request, formatAmzDate } from './sigv4';

const SERVICE = 's3';

interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  publicBaseUrl?: string;
}

function readConfig(): S3Config | null {
  const accessKeyId = process.env.AWS_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_S3_SECRET_ACCESS_KEY;
  const region = process.env.AWS_S3_REGION;
  const bucket = process.env.AWS_S3_BUCKET;
  const publicBaseUrl = process.env.AWS_S3_PUBLIC_BASE_URL;

  if (!accessKeyId || !secretAccessKey || !region || !bucket) {
    return null;
  }
  return { accessKeyId, secretAccessKey, region, bucket, publicBaseUrl };
}

export class S3StorageProvider implements StorageProvider {
  readonly key = 's3';
  readonly name = 'AWS S3';

  private readonly config: S3Config | null;

  constructor() {
    this.config = readConfig();
    if (this.config) {
      logger.info('S3 storage provider initialized', {
        bucket: this.config.bucket,
        region: this.config.region,
      });
    }
  }

  isAvailable(): boolean {
    return this.config !== null;
  }

  private requireConfig(): S3Config {
    if (!this.config) {
      throw new Error(
        'S3 storage provider is not available — set AWS_S3_ACCESS_KEY_ID, ' +
          'AWS_S3_SECRET_ACCESS_KEY, AWS_S3_REGION, and AWS_S3_BUCKET to enable it.'
      );
    }
    return this.config;
  }

  /**
   * Virtual-host-style endpoint: `<bucket>.s3.<region>.amazonaws.com/<key>`.
   * For us-east-1 the legacy global endpoint omits the region, but the
   * region-scoped form is also accepted, so we keep it uniform.
   */
  private objectUrl(config: S3Config, key: string): URL {
    const encodedKey = key
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    return new URL(
      `https://${config.bucket}.s3.${config.region}.amazonaws.com/${encodedKey}`
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
      region: config.region,
      service: SERVICE,
    });

    const res = await fetch(url, {
      method: 'PUT',
      headers: signed.headers,
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`S3 upload failed (${res.status}) for key "${key}": ${text}`);
    }

    logger.debug('S3 upload complete', { key, size: body.byteLength, contentType });

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
      region: config.region,
      service: SERVICE,
    });

    url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    url.searchParams.set(
      'X-Amz-Credential',
      `${config.accessKeyId}/${amzDate.slice(0, 8)}/${config.region}/${SERVICE}/aws4_request`
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
    return this.objectUrl(this.config, key).toString().split('?')[0];
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
      region: config.region,
      service: SERVICE,
    });

    const res = await fetch(url, { method: 'DELETE', headers: signed.headers });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`S3 delete failed (${res.status}) for key "${key}": ${text}`);
    }
    logger.debug('S3 delete complete', { key });
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
      region: config.region,
      service: SERVICE,
    });

    const res = await fetch(url, { method: 'HEAD', headers: signed.headers });
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    const text = await res.text().catch(() => '');
    throw new Error(`S3 exists check failed (${res.status}) for key "${key}": ${text}`);
  }
}
