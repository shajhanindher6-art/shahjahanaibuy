/**
 * Section 18, item 53 — Sentry release/env (audit §1 #73).
 *
 * `lib/sentry-config.ts` is the single source of truth every Sentry
 * init reads: release from `VERCEL_GIT_COMMIT_SHA` (undefined, never
 * invented, when unset) and environment from `VERCEL_ENV` first,
 * then `NODE_ENV`, then `'development'`. Also asserts the wiring:
 * all three sentry.*.config.ts files + instrumentation.ts read the
 * shared helper, and instrumentation.ts no longer carries its own
 * inline `environment: process.env.NODE_ENV`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSentryRelease, getSentryEnvironment } from '@/lib/sentry-config';

function readRepoFile(name: string): string {
  return readFileSync(join(process.cwd(), name), 'utf8');
}

describe('getSentryRelease', () => {
  let savedSha: string | undefined;

  beforeEach(() => {
    savedSha = process.env.VERCEL_GIT_COMMIT_SHA;
  });

  afterEach(() => {
    if (savedSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = savedSha;
  });

  it('returns the Vercel commit SHA when set', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc123def456';
    expect(getSentryRelease()).toBe('abc123def456');
  });

  it('trims surrounding whitespace', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = '  abc123  ';
    expect(getSentryRelease()).toBe('abc123');
  });

  it('returns undefined (never invents a version) when unset or blank', () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    expect(getSentryRelease()).toBeUndefined();
    process.env.VERCEL_GIT_COMMIT_SHA = '   ';
    expect(getSentryRelease()).toBeUndefined();
  });
});

describe('getSentryEnvironment', () => {
  // NODE_ENV is typed read-only in @types/node — mutate through a
  // plain record view of process.env, exactly as the runtime does.
  const env = process.env as Record<string, string | undefined>;
  let savedVercelEnv: string | undefined;
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    savedVercelEnv = env.VERCEL_ENV;
    savedNodeEnv = env.NODE_ENV;
  });

  afterEach(() => {
    if (savedVercelEnv === undefined) delete env.VERCEL_ENV;
    else env.VERCEL_ENV = savedVercelEnv;
    if (savedNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = savedNodeEnv;
  });

  it('prefers VERCEL_ENV over NODE_ENV', () => {
    env.VERCEL_ENV = 'preview';
    env.NODE_ENV = 'production';
    expect(getSentryEnvironment()).toBe('preview');
  });

  it('falls back to NODE_ENV when VERCEL_ENV is unset', () => {
    delete env.VERCEL_ENV;
    env.NODE_ENV = 'production';
    expect(getSentryEnvironment()).toBe('production');
  });

  it('falls back to development when neither is set', () => {
    delete env.VERCEL_ENV;
    delete env.NODE_ENV;
    expect(getSentryEnvironment()).toBe('development');
  });
});

describe('Sentry configs read the single source', () => {
  it('all three sentry config files use getSentryRelease + getSentryEnvironment', () => {
    for (const file of [
      'sentry.client.config.ts',
      'sentry.server.config.ts',
      'sentry.edge.config.ts',
    ]) {
      const src = readRepoFile(file);
      expect(src).toContain('getSentryRelease');
      expect(src).toContain('getSentryEnvironment');
      expect(src).toContain('release: getSentryRelease()');
      expect(src).toContain('environment: getSentryEnvironment()');
    }
  });

  it('instrumentation.ts uses the shared helper and no longer inlines NODE_ENV', () => {
    const src = readRepoFile('instrumentation.ts');
    expect(src).toContain('getSentryRelease');
    expect(src).toContain('getSentryEnvironment');
    expect(src).toContain('release: getSentryRelease()');
    expect(src).toContain('environment: getSentryEnvironment()');
    expect(src).not.toContain('environment: process.env.NODE_ENV');
  });

  it('no sentry config invents a release fallback', () => {
    for (const file of [
      'sentry.client.config.ts',
      'sentry.server.config.ts',
      'sentry.edge.config.ts',
      'instrumentation.ts',
    ]) {
      const src = readRepoFile(file);
      expect(src).not.toMatch(/release:\s*['"`]/);
    }
  });
});
