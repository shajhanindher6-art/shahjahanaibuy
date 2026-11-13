import { describe, expect, it } from 'vitest';
import {
  hashGenericWebhookSecret,
  signGenericWebhookPayload,
  sendGenericWebhook,
  GENERIC_WEBHOOK_SIGNATURE_HEADER,
} from '@/lib/generic-webhook';

describe('generic webhook secret hashing (SHA-256 only, never raw)', () => {
  it('hashes deterministically and never contains the raw secret', () => {
    const hash = hashGenericWebhookSecret('my-shared-secret-1234');
    expect(hash).toBe(hashGenericWebhookSecret('my-shared-secret-1234'));
    expect(hash).not.toContain('my-shared-secret-1234');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashGenericWebhookSecret('a-different-secret-99')).not.toBe(hash);
  });
});

describe('generic webhook signing (HMAC-SHA256 over the body)', () => {
  it('signs deterministically and changes with the body or the key', () => {
    const body = JSON.stringify({ type: 'price_drop', productName: 'MacBook' });
    const sig = signGenericWebhookPayload('abc123hash', body);
    expect(sig).toBe(signGenericWebhookPayload('abc123hash', body));
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(signGenericWebhookPayload('abc123hash', body + ' ')).not.toBe(sig);
    expect(signGenericWebhookPayload('other-hash', body)).not.toBe(sig);
  });
});

describe('sendGenericWebhook (2xx only = sent)', () => {
  const message = {
    productName: 'MacBook Air 13',
    triggeredPrice: 999,
    targetPrice: 1099,
    productUrl: 'https://example.com/p/macbook',
  };

  it('returns not_configured when no URL is registered', async () => {
    expect((await sendGenericWebhook(null, null, message)).status).toBe('not_configured');
    expect((await sendGenericWebhook('', null, message)).status).toBe('not_configured');
  });

  it('returns not_configured for a non-http(s) URL', async () => {
    const result = await sendGenericWebhook('ftp://example.com/hook', null, message);
    expect(result.status).toBe('not_configured');
  });

  it('returns sent on HTTP 2xx and includes the HMAC signature header when a secret hash is set', async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';
    const fakeFetch = async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      capturedHeaders = init.headers;
      capturedBody = init.body;
      return { ok: true, status: 200 };
    };
    const secretHash = hashGenericWebhookSecret('my-shared-secret-1234');
    const result = await sendGenericWebhook(
      'https://8.8.8.8/hook',
      secretHash,
      message,
      fakeFetch as never
    );
    expect(result.status).toBe('sent');
    expect(capturedHeaders[GENERIC_WEBHOOK_SIGNATURE_HEADER]).toBe(
      signGenericWebhookPayload(secretHash, capturedBody)
    );
    const parsed = JSON.parse(capturedBody);
    expect(parsed.type).toBe('price_drop');
    expect(parsed.productName).toBe('MacBook Air 13');
    expect(parsed.triggeredPrice).toBe(999);
  });

  it('sends unsigned (no signature header) when no secret is registered', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fakeFetch = async (_url: string, init: { headers: Record<string, string> }) => {
      capturedHeaders = init.headers;
      return { ok: true, status: 200 };
    };
    const result = await sendGenericWebhook('https://8.8.8.8/hook', null, message, fakeFetch as never);
    expect(result.status).toBe('sent');
    expect(capturedHeaders[GENERIC_WEBHOOK_SIGNATURE_HEADER]).toBeUndefined();
  });

  it('returns failed — never sent — on a non-2xx response', async () => {
    const fakeFetch = async () => ({ ok: false, status: 500 });
    const result = await sendGenericWebhook(
      'https://8.8.8.8/hook',
      null,
      message,
      fakeFetch as never
    );
    expect(result.status).toBe('failed');
  });

  it('returns failed on a network error', async () => {
    const fakeFetch = async () => {
      throw new Error('network down');
    };
    const result = await sendGenericWebhook(
      'https://8.8.8.8/hook',
      null,
      message,
      fakeFetch as never
    );
    expect(result.status).toBe('failed');
  });
});
