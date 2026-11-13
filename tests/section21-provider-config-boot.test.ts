/**
 * Section 21, Stage E (W2, B10) — boot-time provider config
 * validation.
 *
 * `validateProviderConfig` / `logProviderConfigIssues`
 * (services/provider-config.ts) used to run only at the lazy
 * provider-registry build; `instrumentation.ts register()` now
 * also calls them once at server startup (nodejs runtime only).
 * These tests pin the validator without booting Next:
 * - an empty/missing config returns no issues and never throws;
 * - a half credential pair / bad value returns an issue naming
 *   the env var (never the secret value);
 * - `logProviderConfigIssues` returns the issues and logs them
 *   server-side, never throwing;
 * - `register()` resolves under the nodejs runtime with a bad
 *   config present (boot never fails) and does nothing when the
 *   runtime is not nodejs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateProviderConfig,
  logProviderConfigIssues,
} from '@/services/provider-config';
import { register } from '@/instrumentation';

describe('validateProviderConfig — pure, never throws, never leaks a value', () => {
  it('an empty/missing config returns no issues', () => {
    expect(validateProviderConfig({ NODE_ENV: 'test' })).toEqual([]);
    expect(validateProviderConfig({ NODE_ENV: 'test' })).toEqual([]);
  });

  it('a half eBay credential pair is an error naming the missing var, not the set value', () => {
    const issues = validateProviderConfig({ NODE_ENV: 'test', EBAY_CLIENT_ID: 'id-only-value-123' });
    expect(issues).toHaveLength(1);
    expect(issues[0].providerKey).toBe('ebay');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].envVar).toBe('EBAY_CLIENT_SECRET');
    expect(issues[0].message).toContain('EBAY_CLIENT_SECRET');
    // No secret value anywhere in the returned descriptors.
    expect(JSON.stringify(issues)).not.toContain('id-only-value-123');
  });

  it('the reverse half pair names EBAY_CLIENT_ID', () => {
    const issues = validateProviderConfig({ NODE_ENV: 'test', EBAY_CLIENT_SECRET: 'secret-value-456' });
    expect(issues).toHaveLength(1);
    expect(issues[0].envVar).toBe('EBAY_CLIENT_ID');
    expect(JSON.stringify(issues)).not.toContain('secret-value-456');
  });

  it('an invalid marketplace id and a bad CSV url are errors naming the var', () => {
    const issues = validateProviderConfig({
      NODE_ENV: 'test',
      EBAY_MARKETPLACE_ID: 'NOT_A_MARKETPLACE',
      CSV_SOURCE_URL: 'not-a-url',
    });
    expect(issues.map((i) => i.envVar).sort()).toEqual([
      'CSV_SOURCE_URL',
      'EBAY_MARKETPLACE_ID',
    ]);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    expect(JSON.stringify(issues)).not.toContain('NOT_A_MARKETPLACE');
    expect(JSON.stringify(issues)).not.toContain('not-a-url');
  });

  it('a set Apify token is an error and the token value is never returned', () => {
    const issues = validateProviderConfig({ NODE_ENV: 'test', APIFY_API_TOKEN: 'apify-token-789' });
    expect(issues).toHaveLength(1);
    expect(issues[0].providerKey).toBe('apify');
    expect(issues[0].severity).toBe('error');
    expect(JSON.stringify(issues)).not.toContain('apify-token-789');
  });

  it('a set Best Buy key without a client is a warning, not an error', () => {
    const issues = validateProviderConfig({ NODE_ENV: 'test', BESTBUY_API_KEY: 'bb-key-000' });
    expect(issues).toHaveLength(1);
    expect(issues[0].providerKey).toBe('bestbuy');
    expect(issues[0].severity).toBe('warning');
    expect(JSON.stringify(issues)).not.toContain('bb-key-000');
  });
});

describe('logProviderConfigIssues — returns the issues, logs them, never throws', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('returns the issues and logs the error server-side', () => {
    const issues = logProviderConfigIssues({ NODE_ENV: 'test', EBAY_CLIENT_ID: 'id-only-value-123' });
    expect(issues).toHaveLength(1);
    expect(issues[0].envVar).toBe('EBAY_CLIENT_SECRET');
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls.join('\n')).toContain('EBAY_CLIENT_SECRET');
    expect(errorSpy.mock.calls.join('\n')).not.toContain('id-only-value-123');
  });

  it('an empty config returns [] and logs nothing', () => {
    expect(logProviderConfigIssues({ NODE_ENV: 'test' })).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('instrumentation register() — boot-time validation (B10)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
    delete process.env.NEXT_RUNTIME;
  });

  it('resolves under the nodejs runtime with a bad config present — boot never fails', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('EBAY_CLIENT_ID', 'id-only-value-123');
    await expect(register()).resolves.toBeUndefined();
    // The bad config surfaced as a server-side log line, not a throw.
    expect(errorSpy.mock.calls.join('\n')).toContain('EBAY_CLIENT_SECRET');
    expect(errorSpy.mock.calls.join('\n')).not.toContain('id-only-value-123');
  });

  it('does nothing (no validation log) when the runtime is not nodejs', async () => {
    delete process.env.NEXT_RUNTIME;
    vi.stubEnv('EBAY_CLIENT_ID', 'id-only-value-123');
    await expect(register()).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
