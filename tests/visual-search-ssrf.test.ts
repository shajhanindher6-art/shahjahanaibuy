import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captionPublicImageUrl,
  isPrivateIpAddress,
  isSafePublicImageUrl,
} from '@/services/visual-search';

// Section 18, audit §1 #2 / §12 item 7 — SSRF regression tests.
// The guard must reject private/loopback/link-local/metadata targets
// BEFORE any fetch happens, validate redirect targets the same way,
// and still let a normal public URL through. Literal public IPs are
// used for the "passes" cases so the tests never depend on live DNS;
// localhost is resolved by the OS resolver (127.0.0.1 / ::1).

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isPrivateIpAddress', () => {
  it('flags loopback, RFC-1918, link-local and metadata addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '127.9.9.9',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '169.254.0.1',
      '0.0.0.0',
      '100.64.0.1',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      'fc00::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateIpAddress(ip), ip).toBe(true);
    }
  });

  it('accepts ordinary public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isPrivateIpAddress(ip), ip).toBe(false);
    }
  });

  it('fails closed on non-IP input', () => {
    expect(isPrivateIpAddress('not-an-ip')).toBe(true);
    expect(isPrivateIpAddress('')).toBe(true);
  });
});

describe('isSafePublicImageUrl (SSRF guard)', () => {
  it('rejects the cloud metadata address 169.254.169.254', async () => {
    await expect(
      isSafePublicImageUrl('http://169.254.169.254/latest/meta-data/')
    ).resolves.toBe(false);
  });

  it('rejects localhost and private-network URLs', async () => {
    await expect(isSafePublicImageUrl('http://localhost/image.jpg')).resolves.toBe(false);
    await expect(isSafePublicImageUrl('http://127.0.0.1/image.jpg')).resolves.toBe(false);
    await expect(isSafePublicImageUrl('http://10.0.0.5/image.jpg')).resolves.toBe(false);
    await expect(isSafePublicImageUrl('http://192.168.1.1/image.jpg')).resolves.toBe(false);
    await expect(isSafePublicImageUrl('http://172.16.0.1/image.jpg')).resolves.toBe(false);
    await expect(isSafePublicImageUrl('http://[::1]/image.jpg')).resolves.toBe(false);
    await expect(isSafePublicImageUrl('http://[fe80::1]/image.jpg')).resolves.toBe(false);
  });

  it('rejects non-http(s) URLs and unparseable input', async () => {
    await expect(isSafePublicImageUrl('ftp://8.8.8.8/image.jpg')).resolves.toBe(false);
    await expect(isSafePublicImageUrl('file:///etc/passwd')).resolves.toBe(false);
    await expect(isSafePublicImageUrl('not a url')).resolves.toBe(false);
  });

  it('rejects an unresolvable host (DNS failure fails closed)', async () => {
    await expect(
      isSafePublicImageUrl('https://nonexistent.invalid/image.jpg')
    ).resolves.toBe(false);
  });

  it('still passes a normal public https URL (literal public IP, no DNS needed)', async () => {
    await expect(isSafePublicImageUrl('https://8.8.8.8/image.jpg')).resolves.toBe(true);
    await expect(isSafePublicImageUrl('http://93.184.216.34/image.jpg')).resolves.toBe(true);
  });
});

describe('captionPublicImageUrl (fetch site)', () => {
  it('rejects the metadata address before any fetch happens', async () => {
    const fetchSpy = vi.fn(async () => new Response('x'));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await captionPublicImageUrl('http://169.254.169.254/latest/meta-data/');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects localhost before any fetch happens', async () => {
    const fetchSpy = vi.fn(async () => new Response('x'));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await captionPublicImageUrl('http://localhost/image.jpg');
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a redirect to a metadata address and does not follow it', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      })
    );
    vi.stubGlobal('fetch', fetchSpy);
    const result = await captionPublicImageUrl('https://8.8.8.8/image.jpg');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/non-public address/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect to a public address (proves manual redirect handling)', async () => {
    // First hop 302s to a literal public IP; second hop returns a
    // tiny PNG. HF_API_TOKEN is unset in tests, so captioning then
    // fails at the token check — that failure proves the second
    // fetch happened (the bytes were fetched, not faked).
    const fetchSpy = vi.fn(async (url: string) => {
      if (url === 'https://8.8.8.8/image.jpg') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://93.184.216.34/real.jpg' },
        });
      }
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const result = await captionPublicImageUrl('https://8.8.8.8/image.jpg');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Hugging Face API token is not configured/);
  });
});
