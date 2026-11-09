import { describe, it, expect } from 'vitest';
import { buildCsp } from '@/lib/csp';

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
