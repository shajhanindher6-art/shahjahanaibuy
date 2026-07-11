/**
 * Minimal AWS Signature Version 4 signer for S3-compatible APIs.
 *
 * Both Cloudflare R2 and AWS S3 expose an S3 REST API that authenticates
 * requests with SigV4. Rather than pulling in the full AWS SDK, we implement
 * just enough signing here to PUT/GET/HEAD/DELETE objects via `fetch()`.
 *
 * Reference: https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
 */

import { createHmac, createHash, type BinaryToTextEncoding } from 'crypto';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Byte-oriented request body. We only ever sign binary payloads (Uint8Array
 * or ArrayBuffer) or empty bodies, so this is narrower than the DOM
 * `BodyInit` union — which keeps the hashing logic type-safe.
 */
export type SignableBody = Uint8Array | ArrayBuffer | string | undefined;

/**
 * Returns the hex-encoded SHA-256 hash of `data`.
 * For requests with no body (GET/HEAD/DELETE), pass `undefined` to use the
 * hash of the empty string.
 */
function sha256Hex(data: SignableBody): string {
  if (data === undefined || data === null) return EMPTY_SHA256;
  if (typeof data === 'string') {
    return createHash('sha256').update(data).digest('hex');
  }
  // ArrayBuffer / TypedArray
  const bytes =
    data instanceof ArrayBuffer
      ? Buffer.from(data)
      : Buffer.from(data as unknown as ArrayBufferLike);
  return createHash('sha256').update(bytes).digest('hex');
}

function hmac(key: Buffer | string, message: string, encoding: BinaryToTextEncoding): string {
  return createHmac('sha256', key).update(message).digest(encoding);
}

export interface SignRequestInput {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: SignableBody;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

export interface SignRequestResult {
  headers: Record<string, string>;
  signedHeaders: string;
}

/**
 * Signs an S3-compatible request in-place by adding an `Authorization`
 * header to the returned headers object. The caller is responsible for
 * sending those headers with the `fetch()` call.
 */
export function signS3Request(input: SignRequestInput): SignRequestResult {
  const { method, url, headers, body, accessKeyId, secretAccessKey, region, service } = input;

  const host = url.host;
  const payloadHash = sha256Hex(body);

  // Build canonical headers: lowercase names, sorted, trimmed values, with a
  // trailing newline. The `host` header is always required.
  const headerEntries = Object.entries({
    host,
    ...headers,
  })
    .map(([name, value]) => [name.toLowerCase().trim(), String(value).trim()])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const signedHeaders = headerEntries.map(([name]) => name).join(';');
  const canonicalHeaders = headerEntries.map(([name, value]) => `${name}:${value}\n`).join('');

  // Canonical query string: sorted by key, URI-encoded.
  const canonicalQuery = Array.from(url.searchParams.entries())
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  // Canonical path must be URI-encoded exactly once. `url.pathname` is already
  // encoded, so we use it directly.
  const canonicalUri = url.pathname || '/';

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const canonicalRequestHash = createHash('sha256')
    .update(canonicalRequest)
    .digest('hex');

  const amzDate = headers['x-amz-date'];
  const dateStamp = amzDate.slice(0, 8); // YYYYMMDD

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join('\n');

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp, 'base64');
  const kRegion = hmac(kDate, region, 'base64');
  const kService = hmac(kRegion, service, 'base64');
  const kSigning = hmac(kService, 'aws4_request', 'base64');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers: { ...headers, host, Authorization: authorization },
    signedHeaders,
  };
}

/**
 * Formats a `Date` as the `yyyyMMddTHHmmssZ` AMZ date string.
 */
export function formatAmzDate(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export { EMPTY_SHA256 };
