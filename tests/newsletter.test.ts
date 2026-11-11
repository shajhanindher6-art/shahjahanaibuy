/**
 * Newsletter / deal-alert capture tests (Section 12, Chunk D).
 *
 * Pure-helper tests (no DB, no network) plus route tests against a
 * mocked Supabase client: the route is capture-only, so the tests
 * assert it validates input, dedupes without leaking existence,
 * fails honestly when migration 036 has not been applied yet, and
 * is rate-limited (60/IP/minute, same limit as guided-finder).
 * Nothing here sends an email — there is no sendEmail call in the
 * code under test.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import {
  NEWSLETTER_COPY,
  NEWSLETTER_SOURCES,
  NEWSLETTER_SUBSCRIBED_MESSAGE,
  isValidEmailAddress,
  normalizeEmail,
  parseNewsletterSource,
  resolveSubscribeInsertResult,
  subscribeToNewsletterStore,
} from '@/lib/newsletter';
import { checkRateLimit } from '@/lib/api/middleware';

// --- Mocked Supabase server client (in-memory newsletter table) ---
const fakeDb = vi.hoisted(() => ({
  emails: new Set<string>(),
  missingTable: false,
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (_table: string) => ({
      insert: async (row: { email: string; source: string }) => {
        if (fakeDb.missingTable) {
          return { error: { code: 'PGRST205', message: 'table not found' } };
        }
        if (fakeDb.emails.has(row.email)) {
          return { error: { code: '23505', message: 'duplicate key' } };
        }
        fakeDb.emails.add(row.email);
        return { error: null };
      },
    }),
  }),
}));

// Imported after the mock so the route uses the fake client.
import { POST } from '@/app/api/v1/newsletter/subscribe/route';

function subscribeRequest(email: unknown, source: unknown, ip = '203.0.113.7') {
  return new NextRequest('http://localhost/api/v1/newsletter/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-real-ip': ip,
    },
    body: JSON.stringify({ email, source }),
  });
}

describe('isValidEmailAddress', () => {
  it('accepts ordinary valid addresses', () => {
    for (const email of [
      'user@example.com',
      'first.last+tag@sub.domain.co.uk',
      'a@b.co',
    ]) {
      expect(isValidEmailAddress(email)).toBe(true);
    }
  });

  it('rejects invalid addresses', () => {
    for (const email of [
      '',
      '   ',
      'not-an-email',
      'user@',
      '@example.com',
      'user@example',
      'user@exam ple.com',
      'user name@example.com',
      'user@example.c',
      42,
      null,
      undefined,
      { email: 'user@example.com' },
    ]) {
      expect(isValidEmailAddress(email)).toBe(false);
    }
  });

  it('rejects an address over 254 characters', () => {
    expect(isValidEmailAddress(`${'a'.repeat(250)}@b.com`)).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('trims whitespace and lowercases', () => {
    expect(normalizeEmail('  USER@Example.COM  ')).toBe('user@example.com');
    expect(normalizeEmail('already@lower.com')).toBe('already@lower.com');
  });

  it('returns empty string for non-strings', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(123)).toBe('');
  });
});

describe('parseNewsletterSource', () => {
  it('accepts footer and homepage', () => {
    expect(parseNewsletterSource('footer')).toEqual({ ok: true, source: 'footer' });
    expect(parseNewsletterSource('homepage')).toEqual({ ok: true, source: 'homepage' });
  });

  it('rejects anything else', () => {
    for (const value of [undefined, null, '', 'sidebar', 'FOOTER', 1]) {
      const result = parseNewsletterSource(value);
      expect(result.ok).toBe(false);
    }
  });
});

describe('subscribeToNewsletterStore (dedupe)', () => {
  it('stores a new email once, normalized', () => {
    const store = new Set<string>();
    const result = subscribeToNewsletterStore(store, '  New@Example.com ');
    expect(result).toEqual({ ok: true, email: 'new@example.com', alreadySubscribed: false });
    expect(store.size).toBe(1);
    expect(store.has('new@example.com')).toBe(true);
  });

  it('reports a repeat signup as already-subscribed without a second row', () => {
    const store = new Set<string>(['user@example.com']);
    const result = subscribeToNewsletterStore(store, 'USER@example.com');
    expect(result).toEqual({ ok: true, email: 'user@example.com', alreadySubscribed: true });
    expect(store.size).toBe(1);
  });

  it('rejects an invalid email before storing anything', () => {
    const store = new Set<string>();
    expect(subscribeToNewsletterStore(store, 'not-an-email')).toEqual({
      ok: false,
      error: 'A valid email address is required.',
    });
    expect(store.size).toBe(0);
  });
});

describe('resolveSubscribeInsertResult', () => {
  it('maps no error to subscribed, 23505 to already-subscribed', () => {
    expect(resolveSubscribeInsertResult(null)).toBe('subscribed');
    expect(resolveSubscribeInsertResult({ code: '23505' })).toBe('already-subscribed');
  });

  it('maps a missing table (PGRST205 / 42P01) to missing-table', () => {
    expect(resolveSubscribeInsertResult({ code: 'PGRST205' })).toBe('missing-table');
    expect(resolveSubscribeInsertResult({ code: '42P01' })).toBe('missing-table');
  });

  it('maps any other error to error', () => {
    expect(resolveSubscribeInsertResult({ code: '42501' })).toBe('error');
  });
});

describe('POST /api/v1/newsletter/subscribe', () => {
  beforeEach(() => {
    fakeDb.emails.clear();
    fakeDb.missingTable = false;
  });

  it('stores a valid signup and returns the honest generic message', async () => {
    const res = await POST(subscribeRequest('new@example.com', 'homepage'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.subscribed).toBe(true);
    expect(body.data.email).toBe('new@example.com');
    expect(body.data.message).toBe(NEWSLETTER_SUBSCRIBED_MESSAGE);
    // Honest delivery note: stored, nothing sent yet.
    expect(body.data.delivery).toContain('No email has been sent');
    expect(fakeDb.emails.has('new@example.com')).toBe(true);
  });

  it('returns the IDENTICAL success response for an already-subscribed email (no existence leak)', async () => {
    const first = await POST(subscribeRequest('dup@example.com', 'footer', '203.0.113.8'));
    const second = await POST(subscribeRequest('DUP@example.com', 'footer', '203.0.113.8'));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody).toEqual(firstBody);
    expect(secondBody.data.message).toBe(NEWSLETTER_SUBSCRIBED_MESSAGE);
    expect(fakeDb.emails.size).toBe(1);
  });

  it('rejects an invalid email with 400', async () => {
    const res = await POST(subscribeRequest('not-an-email', 'homepage', '203.0.113.9'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toContain('valid email');
    expect(fakeDb.emails.size).toBe(0);
  });

  it('rejects a missing email and an unknown source with 400', async () => {
    const noEmail = await POST(subscribeRequest(undefined, 'homepage', '203.0.113.10'));
    expect(noEmail.status).toBe(400);
    const badSource = await POST(subscribeRequest('ok@example.com', 'sidebar', '203.0.113.11'));
    expect(badSource.status).toBe(400);
    expect((await badSource.json()).error.message).toContain('footer');
    expect(fakeDb.emails.size).toBe(0);
  });

  it('rejects unparsable JSON with 400', async () => {
    const req = new NextRequest('http://localhost/api/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.12' },
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('fails honestly with 503 when migration 036 has not been applied yet', async () => {
    fakeDb.missingTable = true;
    const res = await POST(subscribeRequest('late@example.com', 'homepage', '203.0.113.13'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toContain('not available yet');
  });

  it('never calls any email sender (route source has no sendEmail import)', () => {
    const routePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'app',
      'api',
      'v1',
      'newsletter',
      'subscribe',
      'route.ts'
    );
    const text = fs.readFileSync(routePath, 'utf8');
    expect(text).not.toContain('sendEmail');
    // No import of the email service (a doc comment naming it is fine).
    expect(text).not.toMatch(/from ['"]@\/services\/email['"]/);
    expect(text).not.toMatch(/import.*email.*from/);
    expect(text).toContain("export const dynamic = 'force-dynamic'");
    expect(text).toContain('rateLimitResponse(');
  });
});

describe('newsletter rate limiting (60/IP/minute, guided-finder limit)', () => {
  it('the in-memory bucket allows 60 requests, then blocks the 61st', () => {
    const key = `newsletter-test:${Date.now()}`;
    for (let i = 0; i < 60; i++) {
      expect(checkRateLimit(key, 60, 60_000).allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, 60, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('the route calls rateLimitResponse with limit 60', () => {
    const routePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'app',
      'api',
      'v1',
      'newsletter',
      'subscribe',
      'route.ts'
    );
    const text = fs.readFileSync(routePath, 'utf8');
    expect(text).toContain('newsletter-subscribe:');
    expect(text).toMatch(/rateLimitResponse\(\s*`newsletter-subscribe:\$\{getClientIp\(request\)\}`,\s*60,/);
  });
});

describe('newsletter copy (honest, no fake delivery promises)', () => {
  it('the shared copy says sending starts once email delivery is configured', () => {
    expect(NEWSLETTER_COPY.description).toContain(
      'sending starts once email delivery is configured'
    );
    expect(NEWSLETTER_COPY.successMessage).toContain(
      'sending starts once email delivery is configured'
    );
    expect(NEWSLETTER_COPY.successMessage).toContain('No email has been sent yet');
  });

  it('no copy promises a weekly digest or any delivery schedule', () => {
    const allCopy = Object.values(NEWSLETTER_COPY).join(' ');
    expect(allCopy).not.toMatch(/weekly deals in your inbox/i);
    expect(allCopy).not.toMatch(/every week/i);
    expect(allCopy).not.toMatch(/delivered to your inbox/i);
  });

  it('the capture component renders the honest wording', () => {
    const componentPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'components',
      'home',
      'newsletter-capture.tsx'
    );
    const text = fs.readFileSync(componentPath, 'utf8');
    expect(text).toContain('NEWSLETTER_COPY');
    expect(text).toContain('NewsletterCapture');
    expect(text).not.toContain('sendEmail');
    // The component uses the shared copy, which carries the wording.
    expect(NEWSLETTER_COPY.description).toContain(
      'sending starts once email delivery is configured'
    );
  });

  it('the migration is written but marked DO NOT APPLY YET', () => {
    const migrationPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'supabase',
      'migrations',
      '20261111133000_036_newsletter_subscribers.sql'
    );
    const text = fs.readFileSync(migrationPath, 'utf8');
    expect(text).toContain('DO NOT APPLY YET');
    expect(text).toContain('CREATE TABLE IF NOT EXISTS public.newsletter_subscribers');
    expect(text).toContain('confirmed_at timestamptz NULL DEFAULT NULL');
    expect(text).toContain('unsubscribed_at timestamptz NULL DEFAULT NULL');
    expect(text).toContain('ENABLE ROW LEVEL SECURITY');
    // No public read: only an insert policy exists.
    expect(text).toContain('FOR INSERT TO anon');
    expect(text).not.toMatch(/FOR SELECT TO (anon|authenticated)/);
  });

  it('the source CHECK lists every NEWSLETTER_SOURCES value (Section 14, Chunk 1)', () => {
    // The CHECK used to list only footer/homepage, so a signup from
    // /deals, the digest or the notifications page would have been
    // rejected by the database even though the route accepted it.
    const migrationPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'supabase',
      'migrations',
      '20261111133000_036_newsletter_subscribers.sql'
    );
    const text = fs.readFileSync(migrationPath, 'utf8');
    for (const source of NEWSLETTER_SOURCES) {
      expect(text).toContain(`'${source}'`);
    }
  });
});
