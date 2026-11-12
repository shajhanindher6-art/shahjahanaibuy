/**
 * Newsletter sender tests (Section 15, P4-4).
 *
 * sendNewsletterToSubscribers against a mocked email service and
 * an in-memory newsletter_subscribers table; no DB, no network.
 * The tests assert the fail-closed ladder: no key → nothing sent,
 * missing table → nothing sent, a failed Resend send is counted
 * as failed and never as sent.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

type SubscriberRow = {
  email: string;
  unsubscribe_token: string;
  unsubscribed_at: string | null;
};

const fakeDb = vi.hoisted(() => ({
  rows: [] as SubscriberRow[],
  missingTable: false,
  loadError: false as boolean | string,
  deals: [{ id: 'd1', title: 'Deal X', discount_type: 'percentage', discount_value: 20, end_at: null }] as Array<Record<string, unknown>>,
  sentTo: [] as string[],
  sendResults: new Map<string, boolean>(),
  lastLimit: 0,
  configured: true,
  lastBodies: [] as string[],
}));

vi.mock('@/services/email', () => ({
  isEmailConfigured: () => fakeDb.configured,
  sendEmail: async (message: { to: string; text?: string }) => {
    fakeDb.sentTo.push(message.to);
    if (message.text) fakeDb.lastBodies.push(message.text);
    const ok = fakeDb.sendResults.get(message.to) ?? true;
    return ok ? { success: true, messageId: 'msg-1' } : { success: false, error: 'Resend rejected the sender' };
  },
}));

// Imported after the mock so the sender uses the fake email service.
import { sendNewsletterToSubscribers } from '@/services/newsletter-send';

function makeClient() {
  return {
    from: (table: string) => {
      const state: { limitN?: number } = {};
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: (n: number) => {
          state.limitN = n;
          // The deals fetch also calls .limit(5) — only track the
          // subscriber query's limit here.
          if (table === 'newsletter_subscribers') fakeDb.lastLimit = n;
          return chain;
        },
        then: (resolve: (value: unknown) => void) => {
          if (table === 'newsletter_subscribers') {
            if (fakeDb.missingTable) {
              resolve({ data: null, error: { code: 'PGRST205', message: 'table not found' } });
              return;
            }
            if (fakeDb.loadError) {
              resolve({ data: null, error: { code: 'XX000', message: String(fakeDb.loadError) } });
              return;
            }
            const rows = fakeDb.rows.slice(0, state.limitN ?? fakeDb.rows.length);
            resolve({ data: rows, error: null });
            return;
          }
          // deals (default content fetch)
          resolve({ data: fakeDb.deals, error: null });
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('sendNewsletterToSubscribers (P4-4)', () => {
  beforeEach(() => {
    fakeDb.rows = [
      { email: 'a@example.com', unsubscribe_token: 'tok-a', unsubscribed_at: null },
      { email: 'b@example.com', unsubscribe_token: 'tok-b', unsubscribed_at: null },
      { email: 'gone@example.com', unsubscribe_token: 'tok-gone', unsubscribed_at: '2026-11-12T00:00:00.000Z' },
    ];
    fakeDb.missingTable = false;
    fakeDb.loadError = false;
    fakeDb.sentTo = [];
    fakeDb.lastBodies = [];
    fakeDb.sendResults = new Map();
    fakeDb.lastLimit = 0;
    fakeDb.configured = true;
  });

  it('fails closed without RESEND_API_KEY — nothing is read or sent', async () => {
    fakeDb.configured = false;
    const result = await sendNewsletterToSubscribers(makeClient());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('email-not-configured');
    expect(result.sent).toBe(0);
    expect(fakeDb.sentTo).toEqual([]);
  });

  it('fails closed when migration 036 is unapplied — nothing is claimed sent', async () => {
    fakeDb.missingTable = true;
    const result = await sendNewsletterToSubscribers(makeClient());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('table-missing');
    expect(result.sent).toBe(0);
    expect(fakeDb.sentTo).toEqual([]);
  });

  it('sends only to still-subscribed rows and skips the unsubscribed one', async () => {
    const result = await sendNewsletterToSubscribers(makeClient());
    expect(result.ok).toBe(true);
    expect(result.total).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.skippedUnsubscribed).toBe(1);
    expect(fakeDb.sentTo).toEqual(['a@example.com', 'b@example.com']);
  });

  it('counts a rejected send as failed, never as sent', async () => {
    fakeDb.sendResults.set('b@example.com', false);
    const result = await sendNewsletterToSubscribers(makeClient());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('send-failed');
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(2);
  });

  it('reuses the digest composer — supplied deal content lands in the email body', async () => {
    const result = await sendNewsletterToSubscribers(makeClient(), {
      content: {
        topDeals: [{ title: 'Deal X', discount_value: 20, discount_type: 'percentage' }],
        priceDrops: [],
        searchSummary: [],
      },
    });
    expect(result.sent).toBe(2);
    expect(fakeDb.lastBodies).toHaveLength(2);
    expect(fakeDb.lastBodies[0]).toContain('Deal X');
    // Every mail carries a one-click unsubscribe link with the token.
    expect(fakeDb.lastBodies[0]).toContain('/api/v1/newsletter/unsubscribe?token=tok-a');
  });

  it('clamps the batch limit to 500', async () => {
    await sendNewsletterToSubscribers(makeClient(), { limit: 1000 });
    expect(fakeDb.lastLimit).toBe(500);
  });

  it('returns ok with zero recipients when the list is empty', async () => {
    fakeDb.rows = [];
    const result = await sendNewsletterToSubscribers(makeClient());
    expect(result.ok).toBe(true);
    expect(result.total).toBe(0);
    expect(result.sent).toBe(0);
    expect(fakeDb.sentTo).toEqual([]);
  });

  it('the sender reuses buildDigestEmail from services/notifications', () => {
    const senderPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'services',
      'newsletter-send.ts'
    );
    const text = fs.readFileSync(senderPath, 'utf8');
    expect(text).toContain('buildDigestEmail');
    expect(text).toContain("from '@/services/notifications'");
    expect(text).toContain('isEmailConfigured');
    expect(text).toContain('service-role');
  });
});
