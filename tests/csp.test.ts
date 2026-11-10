import { describe, it, expect, afterEach } from 'vitest';
import { buildCsp } from '@/lib/csp';
import {
  isValidGa4Id,
  isValidMetaPixelId,
  getGa4Id,
  getMetaPixelId,
} from '@/components/providers/analytics-config';

// P0 fix (2026-11-09 audit): the PostHog analytics host was missing
// from connect-src, so the browser silently blocked every PostHog
// event even with a valid key and granted consent.

describe('buildCsp', () => {
  it('includes the nonce in script-src (no unsafe-inline there)', () => {
    const csp = buildCsp('test-nonce-123');
    const scriptSrc = csp
      .split('; ')
      .find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toContain("'nonce-test-nonce-123'");
    // style-src keeps 'unsafe-inline' by documented design (React
    // style attributes); script-src must never have it.
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('includes the PostHog host in connect-src', () => {
    const csp = buildCsp('n');
    // NEXT_PUBLIC_POSTHOG_HOST is unset in tests, so the default US
    // cloud host must appear.
    expect(csp).toContain('https://us.i.posthog.com');
    const connectSrc = csp
      .split('; ')
      .find((d) => d.startsWith('connect-src'));
    expect(connectSrc).toContain('https://us.i.posthog.com');
  });

  it('keeps the existing Supabase and Sentry origins', () => {
    const csp = buildCsp('n');
    expect(csp).toContain('https://*.supabase.co');
    expect(csp).toContain('https://*.ingest.sentry.io');
  });
});

// GA4 + Meta Pixel (Section 3 item 16, 2026-11-10): vendor hosts
// are allowed ONLY when the matching env ID is set and valid —
// while dormant (no ID) the policy stays exactly as tight as
// before, and a malformed ID is treated as unset, never injected.

describe('GA4 / Meta Pixel CSP gating', () => {
  const savedGa4 = process.env.NEXT_PUBLIC_GA4_ID;
  const savedPixel = process.env.NEXT_PUBLIC_META_PIXEL_ID;

  afterEach(() => {
    if (savedGa4 === undefined) delete process.env.NEXT_PUBLIC_GA4_ID;
    else process.env.NEXT_PUBLIC_GA4_ID = savedGa4;
    if (savedPixel === undefined) delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
    else process.env.NEXT_PUBLIC_META_PIXEL_ID = savedPixel;
  });

  it('adds no vendor hosts while both IDs are unset (dormant)', () => {
    delete process.env.NEXT_PUBLIC_GA4_ID;
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
    const csp = buildCsp('n');
    expect(csp).not.toContain('googletagmanager.com');
    expect(csp).not.toContain('google-analytics.com');
    expect(csp).not.toContain('facebook.net');
    expect(csp).not.toContain('facebook.com');
  });

  it('adds GA4 hosts only when a valid GA4 ID is set', () => {
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
    process.env.NEXT_PUBLIC_GA4_ID = 'G-ABC1234567';
    const csp = buildCsp('n');
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'));
    const connectSrc = csp.split('; ').find((d) => d.startsWith('connect-src'));
    expect(scriptSrc).toContain('https://www.googletagmanager.com');
    expect(connectSrc).toContain('https://www.google-analytics.com');
    expect(connectSrc).toContain('https://region1.google-analytics.com');
    expect(csp).not.toContain('facebook.net');
  });

  it('adds Meta Pixel hosts only when a valid Pixel ID is set', () => {
    delete process.env.NEXT_PUBLIC_GA4_ID;
    process.env.NEXT_PUBLIC_META_PIXEL_ID = '123456789012345';
    const csp = buildCsp('n');
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'));
    const connectSrc = csp.split('; ').find((d) => d.startsWith('connect-src'));
    expect(scriptSrc).toContain('https://connect.facebook.net');
    expect(connectSrc).toContain('https://www.facebook.com');
    expect(connectSrc).toContain('https://graph.facebook.com');
    expect(csp).not.toContain('googletagmanager.com');
  });

  it('treats a malformed ID as unset (no hosts, no injection)', () => {
    process.env.NEXT_PUBLIC_GA4_ID = 'G-"; alert(1); //';
    process.env.NEXT_PUBLIC_META_PIXEL_ID = 'not-a-number';
    const csp = buildCsp('n');
    expect(csp).not.toContain('googletagmanager.com');
    expect(csp).not.toContain('facebook.net');
    expect(csp).not.toContain('alert(1)');
  });
});

describe('analytics ID validation', () => {
  it('accepts real GA4 measurement IDs, rejects the rest', () => {
    expect(isValidGa4Id('G-ABC1234567')).toBe(true);
    expect(isValidGa4Id('G-1234')).toBe(true);
    expect(isValidGa4Id('UA-123456-1')).toBe(false);
    expect(isValidGa4Id('G-')).toBe(false);
    expect(isValidGa4Id('G-abc')).toBe(false);
    expect(isValidGa4Id('G-AB CD')).toBe(false);
    expect(isValidGa4Id(null)).toBe(false);
    expect(isValidGa4Id(undefined)).toBe(false);
  });

  it('accepts numeric Pixel IDs, rejects the rest', () => {
    expect(isValidMetaPixelId('123456789012345')).toBe(true);
    expect(isValidMetaPixelId('1234567890')).toBe(true);
    expect(isValidMetaPixelId('12345')).toBe(false);
    expect(isValidMetaPixelId('123456789012345678901')).toBe(false);
    expect(isValidMetaPixelId('abc123456789012')).toBe(false);
    expect(isValidMetaPixelId(null)).toBe(false);
  });

  it('getGa4Id / getMetaPixelId return null when unset or invalid', () => {
    const savedGa4 = process.env.NEXT_PUBLIC_GA4_ID;
    const savedPixel = process.env.NEXT_PUBLIC_META_PIXEL_ID;
    try {
      delete process.env.NEXT_PUBLIC_GA4_ID;
      delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
      expect(getGa4Id()).toBeNull();
      expect(getMetaPixelId()).toBeNull();
      process.env.NEXT_PUBLIC_GA4_ID = 'bogus';
      process.env.NEXT_PUBLIC_META_PIXEL_ID = 'bogus';
      expect(getGa4Id()).toBeNull();
      expect(getMetaPixelId()).toBeNull();
      process.env.NEXT_PUBLIC_GA4_ID = 'G-ABC1234567';
      process.env.NEXT_PUBLIC_META_PIXEL_ID = '123456789012345';
      expect(getGa4Id()).toBe('G-ABC1234567');
      expect(getMetaPixelId()).toBe('123456789012345');
    } finally {
      if (savedGa4 === undefined) delete process.env.NEXT_PUBLIC_GA4_ID;
      else process.env.NEXT_PUBLIC_GA4_ID = savedGa4;
      if (savedPixel === undefined) delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
      else process.env.NEXT_PUBLIC_META_PIXEL_ID = savedPixel;
    }
  });
});
