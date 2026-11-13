/**
 * Section 18, Phase 2 follow-up to item 45 — the error_log writer.
 *
 * `logApiError` (lib/api/error-logging.ts) persists every API error
 * to `error_log` (migration 048) best-effort via `writeErrorLog` /
 * `insertErrorLogRow` (services/error-log-admin.ts). Against mocked
 * Supabase clients (no DB, no network):
 * - the writer is called on error, with the right row shape
 *   (level/message/request_id/route/user_id/meta);
 * - a missing table (42P01/PGRST205 — migration 048 unapplied) is
 *   tolerated, never thrown;
 * - a writer failure (insert error, throwing client, missing
 *   service-role key) never throws and never blocks the response.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { logApiError, writeErrorLog } from '@/lib/api/error-logging';
import { insertErrorLogRow } from '@/services/error-log-admin';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { AnySupabaseClient } from '@/lib/supabase/types';

const mockedServiceClient = vi.mocked(createSupabaseServiceClient);

type InsertResult = { error: { code?: string; message?: string } | null };

function fakeService(insertImpl: (row: Record<string, unknown>) => Promise<InsertResult> | InsertResult) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const client = {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return insertImpl(row);
      },
    }),
  } as unknown as AnySupabaseClient;
  return { client, inserts };
}

/**
 * Section 21, Stage E (W2) — deterministic wait for the
 * fire-and-forget error_log writer: a plain bounded polling loop
 * instead of vitest's waitFor helper (this was the last waitFor
 * call in the tree). `logApiError` fires the write and returns immediately,
 * so the test cannot await the write directly — it polls the
 * fake client's inserts. The 5s bound is kept on purpose
 * (Section 19, Phase 0 §12 #90: the 1s default was too tight
 * under parallel load); the loop exits as soon as the insert
 * lands, and the `expect` after it fails loudly on timeout.
 */
async function waitForInserts(
  inserts: Array<{ table: string; row: Record<string, unknown> }>,
  count = 1,
  timeoutMs = 5000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (inserts.length < count) {
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('insertErrorLogRow', () => {
  it('inserts the row with the 048 columns and returns inserted', async () => {
    const { client, inserts } = fakeService(() => ({ error: null }));
    const outcome = await insertErrorLogRow(client, {
      level: 'error',
      message: 'boom',
      request_id: 'req-1',
      route: 'subscriptions',
      user_id: 'user-1',
      meta: { status: 500 },
    });
    expect(outcome).toBe('inserted');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('error_log');
    expect(inserts[0].row).toMatchObject({
      level: 'error',
      message: 'boom',
      request_id: 'req-1',
      route: 'subscriptions',
      user_id: 'user-1',
      meta: { status: 500 },
    });
  });

  it('defaults missing optionals to null / empty meta', async () => {
    const { client, inserts } = fakeService(() => ({ error: null }));
    await insertErrorLogRow(client, { level: 'error', message: 'boom' });
    expect(inserts[0].row).toMatchObject({
      request_id: null,
      route: null,
      user_id: null,
      meta: {},
    });
  });

  it('returns missing-table for 42P01 and PGRST205 (migration 048 unapplied)', async () => {
    for (const code of ['42P01', 'PGRST205']) {
      const { client } = fakeService(() => ({
        error: { code, message: 'table does not exist' },
      }));
      await expect(
        insertErrorLogRow(client, { level: 'error', message: 'boom' })
      ).resolves.toBe('missing-table');
    }
  });

  it('returns failed (never throws) on any other insert error or a throwing client', async () => {
    const { client } = fakeService(() => ({ error: { code: '23505', message: 'conflict' } }));
    await expect(
      insertErrorLogRow(client, { level: 'error', message: 'boom' })
    ).resolves.toBe('failed');
    const throwing = {
      from: () => ({
        insert: async () => {
          throw new Error('network down');
        },
      }),
    } as unknown as AnySupabaseClient;
    await expect(
      insertErrorLogRow(throwing, { level: 'error', message: 'boom' })
    ).resolves.toBe('failed');
  });
});

describe('writeErrorLog', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    mockedServiceClient.mockReset();
  });

  afterEach(() => {
    debugSpy.mockRestore();
  });

  it('writes through the service-role client', async () => {
    const { client, inserts } = fakeService(() => ({ error: null }));
    mockedServiceClient.mockReturnValue(client as never);
    await writeErrorLog({
      level: 'error',
      message: 'boom',
      requestId: 'req-9',
      route: 'subscriptions',
      userId: 'user-1',
      meta: { status: 500 },
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row).toMatchObject({
      level: 'error',
      message: 'boom',
      request_id: 'req-9',
      route: 'subscriptions',
      user_id: 'user-1',
    });
  });

  it('skips silently (no insert, no throw) when the service-role key is unconfigured', async () => {
    mockedServiceClient.mockReturnValue(null);
    await expect(
      writeErrorLog({ level: 'error', message: 'boom' })
    ).resolves.toBeUndefined();
  });

  it('tolerates a missing table and a throwing service client', async () => {
    const { client } = fakeService(() => ({
      error: { code: '42P01', message: 'relation "error_log" does not exist' },
    }));
    mockedServiceClient.mockReturnValue(client as never);
    await expect(
      writeErrorLog({ level: 'error', message: 'boom' })
    ).resolves.toBeUndefined();
    mockedServiceClient.mockImplementation(() => {
      throw new Error('env exploded');
    });
    await expect(
      writeErrorLog({ level: 'error', message: 'boom' })
    ).resolves.toBeUndefined();
  });
});

describe('logApiError persists to error_log', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let savedDsn: string | undefined;
  let savedPublicDsn: string | undefined;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    savedDsn = process.env.SENTRY_DSN;
    savedPublicDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    mockedServiceClient.mockReset();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    debugSpy.mockRestore();
    if (savedDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = savedDsn;
    if (savedPublicDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = savedPublicDsn;
  });

  it('writer is called on error with request id, route, status and user id', async () => {
    const { client, inserts } = fakeService(() => ({ error: null }));
    mockedServiceClient.mockReturnValue(client as never);
    const request = new NextRequest('http://localhost/api/v1/subscriptions', {
      headers: { 'x-request-id': 'req-writer' },
    });
    const returned = logApiError(new Error('boom'), {
      request,
      route: 'subscriptions',
      status: 500,
      userId: 'user-7',
      startedAt: Date.now(),
    });
    expect(returned).toBe('req-writer');
    // Fire-and-forget writer: poll the fake inserts with the
    // plain bounded loop (see waitForInserts above).
    await waitForInserts(inserts);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row).toMatchObject({
      level: 'error',
      message: 'boom',
      request_id: 'req-writer',
      route: 'subscriptions',
      user_id: 'user-7',
    });
    expect((inserts[0].row.meta as Record<string, unknown>).status).toBe(500);
  });

  it('missing table (048 unapplied) never throws and never blocks the response', async () => {
    const { client, inserts } = fakeService(() => ({
      error: { code: 'PGRST205', message: 'Could not find the table' },
    }));
    mockedServiceClient.mockReturnValue(client as never);
    expect(() =>
      logApiError(new Error('boom'), { route: 'x', status: 500 })
    ).not.toThrow();
    // Fire-and-forget writer: poll the fake inserts with the
    // plain bounded loop (see waitForInserts above).
    await waitForInserts(inserts);
    expect(inserts).toHaveLength(1);
  });

  it('writer failure never throws and the log line still lands', async () => {
    mockedServiceClient.mockImplementation(() => {
      throw new Error('service client exploded');
    });
    expect(() =>
      logApiError(new Error('boom'), { route: 'x', status: 500 })
    ).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('no service-role key: no insert, no throw', async () => {
    mockedServiceClient.mockReturnValue(null);
    expect(() =>
      logApiError(new Error('boom'), { route: 'x', status: 500 })
    ).not.toThrow();
    // Give the fire-and-forget writer a tick to prove it stays quiet.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(errorSpy).toHaveBeenCalled();
  });
});
