/**
 * Section 18, Phase 0 — API error logging + Sentry capture helper
 * + request IDs (audit §1 #4/#37, §12 items 44, 9, 52).
 *
 * - logApiError: structured fields present (status / duration /
 *   request id); captureException called when Sentry is configured
 *   and NOT called / never throwing when unconfigured.
 * - Request ids: generated once in middleware, echoed as the
 *   x-request-id response header, present in log records.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => NextResponse.next(),
}));
vi.mock('@/lib/middleware/slug-exists', () => ({
  resolveSlugRequest: vi.fn(async () => 'pass' as const),
}));

import * as Sentry from '@sentry/nextjs';
import { logApiError, isSentryConfigured } from '@/lib/api/error-logging';
import {
  getRequestId,
  ensureRequestId,
  REQUEST_ID_HEADER,
} from '@/lib/api/request-id';
import { logApiRequest } from '@/lib/api/middleware';
import { middleware } from '@/middleware';
import { resolveSlugRequest } from '@/lib/middleware/slug-exists';

const captureException = vi.mocked(Sentry.captureException);
const mockedResolveSlug = vi.mocked(resolveSlugRequest);

function apiRequest(url = 'http://localhost/api/v1/subscriptions', requestId?: string) {
  return new NextRequest(url, {
    headers: requestId ? { [REQUEST_ID_HEADER]: requestId } : {},
  });
}

/** The logger writes `[ISO] LEVEL: message {json-meta}` to console. */
function parseLogMeta(calls: unknown[][]): Record<string, unknown> {
  const text = calls.map((args) => args.map(String).join(' ')).join('\n');
  const jsonStart = text.indexOf('{');
  expect(jsonStart).toBeGreaterThanOrEqual(0);
  return JSON.parse(text.slice(jsonStart)) as Record<string, unknown>;
}

describe('getRequestId / ensureRequestId', () => {
  it('reuses an inbound x-request-id', () => {
    expect(getRequestId(apiRequest('http://localhost/api/x', 'inbound-123'))).toBe('inbound-123');
  });

  it('mints a UUID when no id is present', () => {
    const id = getRequestId(apiRequest());
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('ensureRequestId stamps the header and is idempotent', () => {
    const req = apiRequest();
    const first = ensureRequestId(req);
    expect(req.headers.get(REQUEST_ID_HEADER)).toBe(first);
    expect(ensureRequestId(req)).toBe(first);
  });

  it('ensureRequestId keeps an inbound id untouched', () => {
    const req = apiRequest('http://localhost/api/x', 'kept-1');
    expect(ensureRequestId(req)).toBe('kept-1');
  });
});

describe('logApiError', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let savedDsn: string | undefined;
  let savedPublicDsn: string | undefined;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    savedDsn = process.env.SENTRY_DSN;
    savedPublicDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    captureException.mockClear();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    if (savedDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = savedDsn;
    if (savedPublicDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = savedPublicDsn;
  });

  it('logs status, duration, request id, route and error — and returns the id', () => {
    const startedAt = Date.now() - 42;
    const returned = logApiError(new Error('boom'), {
      request: apiRequest('http://localhost/api/v1/subscriptions', 'req-abc'),
      route: 'subscriptions',
      status: 500,
      startedAt,
    });
    expect(returned).toBe('req-abc');
    const meta = parseLogMeta(errorSpy.mock.calls);
    expect(meta.requestId).toBe('req-abc');
    expect(meta.route).toBe('subscriptions');
    expect(meta.status).toBe(500);
    expect(typeof meta.durationMs).toBe('number');
    expect(meta.durationMs as number).toBeGreaterThanOrEqual(42);
    expect(meta.error).toBe('boom');
    expect(meta.method).toBe('GET');
    expect(meta.path).toBe('/api/v1/subscriptions');
  });

  it('uses an explicit durationMs over startedAt', () => {
    logApiError(new Error('boom'), {
      route: 'x',
      startedAt: Date.now() - 9999,
      durationMs: 7,
    });
    expect(parseLogMeta(errorSpy.mock.calls).durationMs).toBe(7);
  });

  it('defaults to status 500 and route from the request path', () => {
    logApiError('plain string failure', {
      request: apiRequest('http://localhost/api/v1/health', 'req-h'),
    });
    const meta = parseLogMeta(errorSpy.mock.calls);
    expect(meta.status).toBe(500);
    expect(meta.route).toBe('/api/v1/health');
    expect(meta.error).toBe('plain string failure');
  });

  it('does NOT call captureException when Sentry is unconfigured', () => {
    expect(isSentryConfigured()).toBe(false);
    expect(() =>
      logApiError(new Error('boom'), { route: 'x', status: 500 })
    ).not.toThrow();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('calls captureException with request id + tags when Sentry is configured', () => {
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';
    expect(isSentryConfigured()).toBe(true);
    logApiError(new Error('boom'), {
      request: apiRequest('http://localhost/api/v1/subscriptions', 'req-sentry'),
      route: 'subscriptions',
      status: 500,
      startedAt: Date.now(),
    });
    expect(captureException).toHaveBeenCalledTimes(1);
    const [err, ctx] = captureException.mock.calls[0] as [
      unknown,
      { tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('boom');
    expect(ctx.tags.route).toBe('subscriptions');
    expect(ctx.tags.status).toBe('500');
    expect(ctx.extra.requestId).toBe('req-sentry');
  });

  it('never throws when captureException itself throws', () => {
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';
    captureException.mockImplementationOnce(() => {
      throw new Error('sentry down');
    });
    expect(() =>
      logApiError(new Error('boom'), { route: 'x', status: 500 })
    ).not.toThrow();
  });
});

describe('logApiRequest includes the request id', () => {
  it('carries the inbound x-request-id in the log record', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      logApiRequest(apiRequest('http://localhost/api/v1/subscriptions', 'req-log'), {
        endpoint: 'subscriptions',
      });
      const meta = parseLogMeta(infoSpy.mock.calls);
      expect(meta.requestId).toBe('req-log');
      expect(meta.method).toBe('GET');
      expect(meta.endpoint).toBe('subscriptions');
    } finally {
      infoSpy.mockRestore();
    }
  });
});

describe('middleware request-id propagation', () => {
  beforeEach(() => {
    mockedResolveSlug.mockResolvedValue('pass');
  });

  it('echoes a generated x-request-id on the response header', async () => {
    const res = await middleware(apiRequest('http://localhost/api/v1/subscriptions'));
    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('echoes an inbound x-request-id unchanged', async () => {
    const res = await middleware(
      apiRequest('http://localhost/api/v1/subscriptions', 'caller-99')
    );
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('caller-99');
  });

  it('sets x-request-id on the soft-404 rewrite response too', async () => {
    mockedResolveSlug.mockResolvedValue('rewrite');
    const res = await middleware(
      apiRequest('http://localhost/products/no-such-slug', 'req-404')
    );
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('req-404');
  });
});
