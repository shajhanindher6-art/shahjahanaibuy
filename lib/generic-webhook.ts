/**
 * Generic outbound webhook channel (Section 6, item 16).
 *
 * SERVER ONLY — never import from a client component.
 *
 * The user registers THEIR OWN endpoint URL; SmartBuy POSTs
 * price-drop events to it. The secret is stored SHA-256 hashed
 * only (same pattern as lib/api-keys.ts `hashApiKey`) and is never
 * stored raw, never returned, never logged.
 *
 * Signing: the stored SHA-256 hash of the secret is the HMAC key
 * (the raw secret is not retained anywhere server-side, so it
 * cannot be the key). The receiver derives the same key by
 * hashing the secret they registered: HMAC-SHA256 hex over the
 * exact request body, sent as the `x-smartbuy-signature` header.
 * A delivery counts as sent ONLY on an HTTP 2xx — anything else
 * is 'failed', never claimed as sent.
 */

import { createHash, createHmac } from 'node:crypto';
import type { PriceDropMessage } from '@/services/alert-webhooks';
import { isSafePublicImageUrl } from '@/services/visual-search';

/** Header carrying the HMAC-SHA256 hex signature of the body. */
export const GENERIC_WEBHOOK_SIGNATURE_HEADER = 'x-smartbuy-signature';

/** Minimum length for a generic webhook secret (a real shared secret, not a guess). */
export const GENERIC_WEBHOOK_SECRET_MIN_LENGTH = 16;

export type GenericWebhookStatus = 'sent' | 'not_configured' | 'failed';

export interface GenericWebhookResult {
  status: GenericWebhookStatus;
  /** Human-readable detail for logs/status UI. Never contains a secret or the URL path. */
  detail: string;
}

/** SHA-256 hex digest of a webhook secret — the only form ever stored. */
export function hashGenericWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * HMAC-SHA256 hex signature of a request body, keyed by the stored
 * secret hash. The receiver reproduces it by hashing the secret
 * they registered, then HMAC-ing the body with that hash.
 */
export function signGenericWebhookPayload(secretHash: string, body: string): string {
  return createHmac('sha256', secretHash).update(body, 'utf8').digest('hex');
}

/**
 * POST a price-drop event to the user's own endpoint. The payload
 * is the existing PriceDropMessage shape plus a `type` discriminator.
 * Returns 'sent' ONLY on an HTTP 2xx; 'not_configured' when no URL
 * was registered; 'failed' on any network error, timeout (10s) or
 * non-2xx response. Nothing is ever claimed as sent without a 2xx.
 */
export async function sendGenericWebhook(
  url: string | null | undefined,
  secretHash: string | null | undefined,
  message: PriceDropMessage,
  fetchImpl: typeof fetch = fetch
): Promise<GenericWebhookResult> {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return { status: 'not_configured', detail: 'No generic webhook URL registered.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('bad protocol');
    }
  } catch {
    return { status: 'not_configured', detail: 'Registered generic webhook URL is not a valid http(s) URL.' };
  }
  // Section 20, §12 #96 — the URL is POSTed to server-side, so a
  // protocol check is not enough: it must resolve to a public
  // address (Section 18 SSRF guard). A private target is a failed
  // delivery, never 'sent', and no request is made to it.
  if (!(await isSafePublicImageUrl(parsed.toString()))) {
    return {
      status: 'failed',
      detail: 'Registered generic webhook URL did not resolve to a public address.',
    };
  }
  const body = JSON.stringify({ type: 'price_drop', ...message });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secretHash) {
    headers[GENERIC_WEBHOOK_SIGNATURE_HEADER] = signGenericWebhookPayload(secretHash, body);
  }
  try {
    const res = await fetchImpl(parsed.toString(), {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      return { status: 'sent', detail: 'Generic webhook accepted (HTTP 2xx).' };
    }
    return {
      status: 'failed',
      detail: `Generic webhook endpoint returned HTTP ${res.status} (transient — may retry).`,
    };
  } catch {
    return { status: 'failed', detail: 'Generic webhook request failed (transient — may retry).' };
  }
}
