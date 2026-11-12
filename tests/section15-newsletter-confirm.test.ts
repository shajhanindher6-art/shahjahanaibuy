/**
 * Newsletter confirm / unsubscribe tests (Section 15, P4-3 + P4-1).
 *
 * Route tests against a mocked service-role client (in-memory
 * newsletter_subscribers table); no DB, no network. The welcome
 * email is mocked too — the tests assert the route calls it and
 * reports its result honestly. Also locks the P4-1 migration fix:
 * the 036 insert policy must cover `authenticated` as well as
 * `anon`, with the Section 14 five-source CHECK intact.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';

type SubscriberRow = {
  email: string;
  unsubscribe_token: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
};

const fakeDb = vi.hoisted(() => ({
  rows: [] as SubscriberRow[],
  missingTable: false,
  noServiceClient: false,
  welcomeResult: { success: true } as { success: boolean; error?: string },
  welcomeCalls: [] as string[],
  updates: [] as Array<{ patch: Record<string, unknown>; token: string }>,
}));

function makeServiceClient() {
  return {
    from: (table: string) => {
      if (table !== 'newsletter_subscribers') {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: (_col: string, token: string) => ({
            maybeSingle: async () => {
              if (fakeDb.missingTable) {
                return { data: null, error: { code: 'PGRST205', message: 'table not found' } };
              }
              const row = fakeDb.rows.find((r) => r.unsubscribe_token === token);
              return { data: row ?? null, error: null };
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, token: string) => {
            if (fakeDb.missingTable) {
              return { data: null, error: { code: 'PGRST205', message: 'table not found' } };
            }
            const row = fakeDb.rows.find((r) => r.unsubscribe_token === token);
            if (row) Object.assign(row, patch);
            fakeDb.updates.push({ patch, token });
            return { data: null, error: null };
          },
        }),
      };
    },
  };
}

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () =>
    fakeDb.noServiceClient ? null : makeServiceClient(),
}));

vi.mock('@/services/email', () => ({
  sendWelcomeEmail: async (email: string) => {
    fakeDb.welcomeCalls.push(email);
    return fakeDb.welcomeResult;
  },
}));

// Imported after the mocks so the routes use the fake clients.
import { GET as confirmGET, POST as confirmPOST } from '@/app/api/v1/newsletter/confirm/route';
import { GET as unsubGET, POST as unsubPOST } from '@/app/api/v1/newsletter/unsubscribe/route';

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function confirmRequest(token: string | null, method: 'GET' | 'POST' = 'GET') {
  const url = `http://localhost/api/v1/newsletter/confirm${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  if (method === 'GET') {
    return new NextRequest(url, { method: 'GET', headers: { 'x-real-ip': nextIp() } });
  }
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': nextIp() },
    body: JSON.stringify({ token }),
  });
}

function unsubRequest(token: string | null, method: 'GET' | 'POST' = 'POST') {
  const url = `http://localhost/api/v1/newsletter/unsubscribe${method === 'GET' && token ? `?token=${encodeURIComponent(token)}` : ''}`;
  if (method === 'GET') {
    return new NextRequest(url, { method: 'GET', headers: { 'x-real-ip': nextIp() } });
  }
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': nextIp() },
    body: JSON.stringify({ token }),
  });
}

function seedRows() {
  fakeDb.rows = [
    {
      email: 'new@example.com',
      unsubscribe_token: 'tok-new',
      confirmed_at: null,
      unsubscribed_at: null,
    },
    {
      email: 'done@example.com',
      unsubscribe_token: 'tok-done',
      confirmed_at: '2026-11-12T00:00:00.000Z',
      unsubscribed_at: null,
    },
    {
      email: 'gone@example.com',
      unsubscribe_token: 'tok-gone',
      confirmed_at: null,
      unsubscribed_at: '2026-11-12T00:00:00.000Z',
    },
  ];
}

describe('GET/POST /api/v1/newsletter/confirm (P4-3)', () => {
  beforeEach(() => {
    seedRows();
    fakeDb.missingTable = false;
    fakeDb.noServiceClient = false;
    fakeDb.welcomeResult = { success: true };
    fakeDb.welcomeCalls = [];
    fakeDb.updates = [];
  });

  it('confirms an unconfirmed row and sends the welcome email', async () => {
    const res = await confirmGET(confirmRequest('tok-new'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.confirmed).toBe(true);
    expect(body.data.welcomeEmailSent).toBe(true);
    expect(fakeDb.rows[0].confirmed_at).not.toBeNull();
    expect(fakeDb.welcomeCalls).toEqual(['new@example.com']);
  });

  it('works the same via POST with a JSON token', async () => {
    fakeDb.rows[0].confirmed_at = null;
    const res = await confirmPOST(confirmRequest('tok-new', 'POST'));
    expect(res.status).toBe(200);
    expect((await res.json()).data.welcomeEmailSent).toBe(true);
    expect(fakeDb.welcomeCalls).toEqual(['new@example.com']);
  });

  it('still stores the confirmation when the welcome email fails — and says so', async () => {
    fakeDb.welcomeResult = { success: false, error: 'Email provider not configured' };
    const res = await confirmGET(confirmRequest('tok-new'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.confirmed).toBe(true);
    expect(body.data.welcomeEmailSent).toBe(false);
    expect(body.data.delivery).toContain('No welcome email has been sent');
    expect(fakeDb.rows[0].confirmed_at).not.toBeNull();
  });

  it('is idempotent for an already-confirmed row and does not re-send the welcome', async () => {
    const res = await confirmGET(confirmRequest('tok-done'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.confirmed).toBe(true);
    expect(body.data.welcomeEmailSent).toBe(false);
    expect(fakeDb.welcomeCalls).toEqual([]);
  });

  it('does not email an already-unsubscribed row', async () => {
    const res = await confirmGET(confirmRequest('tok-gone'));
    expect(res.status).toBe(200);
    expect(fakeDb.welcomeCalls).toEqual([]);
    expect(fakeDb.updates).toEqual([]);
  });

  it('returns the same generic success for an unknown token (no existence leak)', async () => {
    const res = await confirmGET(confirmRequest('tok-nope'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.confirmed).toBe(true);
    expect(body.data.welcomeEmailSent).toBe(false);
    expect(body.data.message).toContain('If that newsletter signup existed');
    expect(fakeDb.welcomeCalls).toEqual([]);
    expect(fakeDb.updates).toEqual([]);
  });

  it('rejects a missing token with 400', async () => {
    const res = await confirmGET(confirmRequest(null));
    expect(res.status).toBe(400);
  });

  it('fails honestly with 503 when migration 036 has not been applied yet', async () => {
    fakeDb.missingTable = true;
    const res = await confirmGET(confirmRequest('tok-new'));
    expect(res.status).toBe(503);
    expect((await res.json()).error.message).toContain('not available yet');
    expect(fakeDb.welcomeCalls).toEqual([]);
  });

  it('calls the existing sendWelcomeEmail (no longer dead code)', () => {
    const routePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'app',
      'api',
      'v1',
      'newsletter',
      'confirm',
      'route.ts'
    );
    const text = fs.readFileSync(routePath, 'utf8');
    expect(text).toContain('sendWelcomeEmail');
    expect(text).toContain("export const dynamic = 'force-dynamic'");
    expect(text).toContain('createSupabaseServiceClient');
    expect(text).not.toContain('createSupabaseServerClient');
  });
});

describe('GET/POST /api/v1/newsletter/unsubscribe (P4-3)', () => {
  beforeEach(() => {
    seedRows();
    fakeDb.missingTable = false;
    fakeDb.noServiceClient = false;
    fakeDb.updates = [];
  });

  it('sets unsubscribed_at on the matching row', async () => {
    const res = await unsubPOST(unsubRequest('tok-new'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.unsubscribed).toBe(true);
    expect(fakeDb.rows[0].unsubscribed_at).not.toBeNull();
  });

  it('works via the one-click GET link', async () => {
    const res = await unsubGET(unsubRequest('tok-new', 'GET'));
    expect(res.status).toBe(200);
    expect(fakeDb.rows[0].unsubscribed_at).not.toBeNull();
  });

  it('returns the same generic success for an unknown token (no existence leak)', async () => {
    const res = await unsubPOST(unsubRequest('tok-nope'));
    expect(res.status).toBe(200);
    expect((await res.json()).data.message).toContain('If that newsletter signup existed');
  });

  it('rejects a missing token with 400', async () => {
    const res = await unsubPOST(unsubRequest(null));
    expect(res.status).toBe(400);
  });

  it('fails honestly with 503 when migration 036 has not been applied yet', async () => {
    fakeDb.missingTable = true;
    const res = await unsubPOST(unsubRequest('tok-new'));
    expect(res.status).toBe(503);
    expect((await res.json()).error.message).toContain('not available yet');
  });
});

describe('migration 036 RLS fix (P4-1)', () => {
  it('the insert policy covers authenticated as well as anon, CHECK intact', () => {
    const migrationPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'supabase',
      'migrations',
      '20261111133000_036_newsletter_subscribers.sql'
    );
    const text = fs.readFileSync(migrationPath, 'utf8');
    expect(text).toContain('FOR INSERT TO anon, authenticated');
    // Section 14 CHECK fix intact: all five sources.
    for (const source of ['footer', 'homepage', 'deals', 'digest', 'notifications']) {
      expect(text).toContain(`'${source}'`);
    }
    // Still write-only: no SELECT policy for anyone.
    expect(text).not.toMatch(/FOR SELECT TO (anon|authenticated)/);
    // Still unapplied by design.
    expect(text).toContain('DO NOT APPLY YET');
  });
});
