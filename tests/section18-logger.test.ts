/**
 * Section 18, item 56 — JSON logs + logger tests (audit §1 #76).
 *
 * - Every log record is ONE JSON object per line:
 *   `{ timestamp, level, message, ...meta }` — parseable, not the
 *   old `[ISO] LEVEL: msg {json-meta}` text format.
 * - Base fields (timestamp/level/message) always win on a key
 *   collision with meta.
 * - maskSensitive replaces values under sensitive keys with
 *   '[REDACTED]' (password/token/secret/key/authorization/email/
 *   phone/ssn/credit_card/apikey, including substring matches like
 *   userPassword / apiKey / toEmail), recursively, including arrays.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, maskSensitive } from '@/lib/config/logger';

type LogRecord = Record<string, unknown>;

function parseLines(calls: unknown[][]): LogRecord[] {
  return calls
    .flatMap((args) => args.map(String))
    .map((line) => JSON.parse(line) as LogRecord);
}

describe('logger emits structured JSON lines', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('info emits one JSON object per line with timestamp, level, message and meta', () => {
    logger.info('hello', { route: 'subscriptions', status: 500, requestId: 'req-1' });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [record] = parseLines(infoSpy.mock.calls);
    expect(record.level).toBe('info');
    expect(record.message).toBe('hello');
    expect(typeof record.timestamp).toBe('string');
    expect(new Date(record.timestamp as string).toISOString()).toBe(record.timestamp);
    expect(record.route).toBe('subscriptions');
    expect(record.status).toBe(500);
    expect(record.requestId).toBe('req-1');
  });

  it('warn/error/debug carry their own level and no text prefix', () => {
    logger.warn('w', { a: 1 });
    logger.error('e', { b: 2 });
    logger.debug('d', { c: 3 });
    expect(parseLines(warnSpy.mock.calls)[0].level).toBe('warn');
    expect(parseLines(errorSpy.mock.calls)[0].level).toBe('error');
    expect(parseLines(debugSpy.mock.calls)[0].level).toBe('debug');
    // No old text format anywhere: no "[2026-...] WARN:" prefix.
    for (const spy of [warnSpy, errorSpy, debugSpy]) {
      expect(String(spy.mock.calls[0][0])).not.toMatch(/^\[/);
    }
  });

  it('works without meta', () => {
    logger.info('bare message');
    const [record] = parseLines(infoSpy.mock.calls);
    expect(record.message).toBe('bare message');
    expect(record.level).toBe('info');
    expect(record.timestamp).toBeDefined();
  });

  it('base fields win when meta collides with timestamp/level/message', () => {
    logger.info('real message', { level: 'fake', message: 'fake', timestamp: 'fake' });
    const [record] = parseLines(infoSpy.mock.calls);
    expect(record.level).toBe('info');
    expect(record.message).toBe('real message');
    expect(record.timestamp).not.toBe('fake');
  });
});

describe('maskSensitive', () => {
  it('redacts every listed sensitive key', () => {
    const masked = maskSensitive({
      password: 'hunter2',
      token: 'tok-1',
      secret: 's',
      key: 'k',
      authorization: 'Bearer x',
      email: 'a@b.com',
      phone: '+92-300-1',
      ssn: '123-45-6789',
      credit_card: '4111111111111111',
      apikey: 'ak-1',
    }) as Record<string, unknown>;
    for (const value of Object.values(masked)) {
      expect(value).toBe('[REDACTED]');
    }
  });

  it('redacts substring matches (userPassword, apiKey, toEmail, authToken)', () => {
    const masked = maskSensitive({
      userPassword: 'x',
      apiKey: 'x',
      toEmail: 'a@b.com',
      authToken: 'x',
      refreshToken: 'x',
      clientSecret: 'x',
    }) as Record<string, unknown>;
    for (const value of Object.values(masked)) {
      expect(value).toBe('[REDACTED]');
    }
  });

  it('leaves non-sensitive keys untouched', () => {
    const masked = maskSensitive({
      route: 'subscriptions',
      status: 500,
      productId: 'prod-1',
      count: 3,
    }) as Record<string, unknown>;
    expect(masked).toEqual({ route: 'subscriptions', status: 500, productId: 'prod-1', count: 3 });
  });

  it('masks recursively in nested objects and arrays', () => {
    const masked = maskSensitive({
      user: { email: 'a@b.com', name: 'Ada' },
      attempts: [{ password: 'x' }, { ok: true }],
    }) as {
      user: Record<string, unknown>;
      attempts: Array<Record<string, unknown>>;
    };
    expect(masked.user.email).toBe('[REDACTED]');
    expect(masked.user.name).toBe('Ada');
    expect(masked.attempts[0].password).toBe('[REDACTED]');
    expect(masked.attempts[1].ok).toBe(true);
  });

  it('passes primitives through unchanged', () => {
    expect(maskSensitive('plain')).toBe('plain');
    expect(maskSensitive(42)).toBe(42);
    expect(maskSensitive(null)).toBeNull();
  });

  it('the logger masks sensitive meta in the emitted JSON line', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      logger.error('API error', { route: 'x', error: 'boom', userEmail: 'a@b.com' });
      const [record] = parseLines(errorSpy.mock.calls);
      expect(record.route).toBe('x');
      expect(record.error).toBe('boom');
      expect(record.userEmail).toBe('[REDACTED]');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
