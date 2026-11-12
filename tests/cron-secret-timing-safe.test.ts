/**
 * CRON_SECRET timing-safe comparison (Section 17, Stage G, audit §4 #11).
 *
 * The six CRON_SECRET-protected cron routes used to compare the
 * `Authorization` header with a plain `!==` string compare. They
 * now share lib/api/cron-auth.ts, which follows the pattern in
 * lib/smart-home-agent.ts:80-92 — an equal-length guard plus
 * timingSafeEqual, failing closed when the secret is unset.
 *
 * These tests pin the helper's behaviour and that every cron route
 * uses it (and that no plain Bearer compare survives anywhere).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidCronAuthorization, isCronAuthorized } from '@/lib/api/cron-auth';

const SECRET = 'test-cron-secret-at-least-32-chars-long';

const CRON_ROUTES = [
  'app/api/v1/alerts/check/route.ts',
  'app/api/v1/monitoring/uptime/check/route.ts',
  'app/api/v1/notifications/digest/route.ts',
  'app/api/v1/notifications/process/route.ts',
  'app/api/v1/predictions/outcomes/route.ts',
  'app/api/v1/prices/refresh/route.ts',
];

function routeSource(relative: string): string {
  return fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', relative),
    'utf8'
  );
}

describe('isValidCronAuthorization — timing-safe compare', () => {
  it('accepts the exact Bearer secret', () => {
    expect(isValidCronAuthorization(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it('rejects a wrong secret of the SAME length (the timing-attack case)', () => {
    const wrong = `${SECRET.slice(0, -1)}X`;
    expect(wrong.length).toBe(SECRET.length);
    expect(isValidCronAuthorization(`Bearer ${wrong}`, SECRET)).toBe(false);
  });

  it('rejects a wrong secret of a DIFFERENT length', () => {
    expect(isValidCronAuthorization('Bearer short', SECRET)).toBe(false);
    expect(isValidCronAuthorization(`Bearer ${SECRET}-extra`, SECRET)).toBe(false);
  });

  it('rejects a missing, undefined or empty header', () => {
    expect(isValidCronAuthorization(null, SECRET)).toBe(false);
    expect(isValidCronAuthorization(undefined, SECRET)).toBe(false);
    expect(isValidCronAuthorization('', SECRET)).toBe(false);
  });

  it('rejects everything when the secret is unset or empty (fail closed)', () => {
    expect(isValidCronAuthorization(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(isValidCronAuthorization(`Bearer ${SECRET}`, null)).toBe(false);
    expect(isValidCronAuthorization(`Bearer ${SECRET}`, '')).toBe(false);
  });

  it('is case-sensitive on the scheme (lowercase bearer is not valid)', () => {
    expect(isValidCronAuthorization(`bearer ${SECRET}`, SECRET)).toBe(false);
  });

  it('rejects a bare secret with no Bearer scheme', () => {
    expect(isValidCronAuthorization(SECRET, SECRET)).toBe(false);
  });
});

describe('isCronAuthorized — request + env wiring', () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  function fakeRequest(authorization: string | null) {
    return {
      headers: {
        get: (name: string) => (name === 'authorization' ? authorization : null),
      },
    };
  }

  it('authorizes the exact header from the environment secret', () => {
    expect(isCronAuthorized(fakeRequest(`Bearer ${SECRET}`))).toBe(true);
  });

  it('rejects a wrong header and a missing header', () => {
    expect(isCronAuthorized(fakeRequest('Bearer nope-nope-nope-nope-nope-nope'))).toBe(false);
    expect(isCronAuthorized(fakeRequest(null))).toBe(false);
  });

  it('fails closed when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET;
    expect(isCronAuthorized(fakeRequest(`Bearer ${SECRET}`))).toBe(false);
  });
});

describe('all six CRON_SECRET routes use the shared timing-safe helper', () => {
  it('each route imports isCronAuthorized from lib/api/cron-auth', () => {
    expect(CRON_ROUTES).toHaveLength(6);
    for (const route of CRON_ROUTES) {
      const source = routeSource(route);
      expect(source).toContain("from '@/lib/api/cron-auth'");
      expect(source).toContain('isCronAuthorized');
    }
  });

  it('no route keeps a plain Bearer string compare', () => {
    for (const route of CRON_ROUTES) {
      const source = routeSource(route);
      expect(source).not.toContain('!== `Bearer ${cronSecret}`');
      expect(source).not.toContain('=== `Bearer ${cronSecret}`');
      expect(source).not.toContain("!== 'Bearer ' + cronSecret");
      expect(source).not.toContain('authHeader !==');
    }
  });

  it('the helper itself uses timingSafeEqual with an equal-length guard', () => {
    const source = routeSource('lib/api/cron-auth.ts');
    expect(source).toContain('timingSafeEqual');
    expect(source).toContain("from 'node:crypto'");
    expect(source).toContain('length !== expected.length');
  });
});
