import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyNotificationsListQuery,
  isNotificationRead,
  mapNotificationRow,
  notificationTypeOptions,
  parseNotificationsListQuery,
  type NotificationEntry,
} from '@/lib/notifications';
import { NEWSLETTER_SOURCES } from '@/lib/newsletter';

// Section 14, Chunk 1 — correctness + quick wins. Pure-logic tests
// for the notifications list helpers, plus static guards for the
// wiring that only tsc + the build can prove at runtime (dead-file
// deletion, force-dynamic flags, outbound-link rendering).

function makeRow(overrides: Partial<NotificationEntry> = {}): NotificationEntry {
  return {
    id: 'n1',
    type: 'price-drop',
    channel: 'email',
    subject: 'Price dropped',
    body: 'A watched price dropped.',
    status: 'sent',
    scheduledFor: '2026-11-11T10:00:00Z',
    sentAt: null,
    createdAt: '2026-11-11T09:00:00Z',
    data: null,
    ...overrides,
  };
}

function repoFile(...parts: string[]): string {
  return fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...parts),
    'utf8'
  );
}

function repoExists(...parts: string[]): boolean {
  return fs.existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...parts));
}

describe('notifications list query parsing', () => {
  it('defaults to limit 20, offset 0, no type filter, all read states', () => {
    expect(parseNotificationsListQuery(new URLSearchParams(''))).toEqual({
      limit: 20,
      offset: 0,
      type: null,
      read: 'all',
    });
  });

  it('parses limit, offset, type and read', () => {
    expect(
      parseNotificationsListQuery(new URLSearchParams('limit=5&offset=10&type=digest&read=unread'))
    ).toEqual({ limit: 5, offset: 10, type: 'digest', read: 'unread' });
  });

  it('clamps limit to 1–100 and offset to >= 0, and falls back on garbage', () => {
    expect(parseNotificationsListQuery(new URLSearchParams('limit=500')).limit).toBe(100);
    expect(parseNotificationsListQuery(new URLSearchParams('limit=0')).limit).toBe(1);
    expect(parseNotificationsListQuery(new URLSearchParams('limit=abc')).limit).toBe(20);
    expect(parseNotificationsListQuery(new URLSearchParams('offset=-3')).offset).toBe(0);
    expect(parseNotificationsListQuery(new URLSearchParams('offset=xyz')).offset).toBe(0);
  });

  it('treats an unknown read value as all and trims the type', () => {
    const q = parseNotificationsListQuery(new URLSearchParams('read=maybe&type=%20digest%20'));
    expect(q.read).toBe('all');
    expect(q.type).toBe('digest');
    expect(parseNotificationsListQuery(new URLSearchParams('type=%20%20')).type).toBeNull();
  });
});

describe('notification row mapping and read state', () => {
  it('maps snake_case DB columns to the camelCase page shape', () => {
    const mapped = mapNotificationRow({
      id: 'n1',
      type: 'digest',
      channel: 'email',
      subject: null,
      body: 'Weekly digest',
      status: 'pending',
      scheduled_for: '2026-11-11T10:00:00Z',
      sent_at: null,
      created_at: '2026-11-11T09:00:00Z',
      data: { read: true },
    });
    expect(mapped.scheduledFor).toBe('2026-11-11T10:00:00Z');
    expect(mapped.sentAt).toBeNull();
    expect(mapped.createdAt).toBe('2026-11-11T09:00:00Z');
    expect(mapped.subject).toBeNull();
  });

  it('treats a missing read flag as unread', () => {
    expect(isNotificationRead({ data: null })).toBe(false);
    expect(isNotificationRead({ data: {} })).toBe(false);
    expect(isNotificationRead({ data: { read: false } })).toBe(false);
    expect(isNotificationRead({ data: { read: true } })).toBe(true);
  });
});

describe('notifications list filtering and paging', () => {
  const rows = [
    makeRow({ id: 'a', type: 'price-drop', data: null }),
    makeRow({ id: 'b', type: 'digest', data: { read: true } }),
    makeRow({ id: 'c', type: 'price-drop', data: { read: true } }),
    makeRow({ id: 'd', type: 'deal', data: null }),
  ];

  it('filters by type and counts the filtered total', () => {
    const out = applyNotificationsListQuery(rows, {
      limit: 20,
      offset: 0,
      type: 'price-drop',
      read: 'all',
    });
    expect(out.page.map((r) => r.id)).toEqual(['a', 'c']);
    expect(out.total).toBe(2);
  });

  it('filters unread only and keeps the global unread count', () => {
    const out = applyNotificationsListQuery(rows, {
      limit: 20,
      offset: 0,
      type: null,
      read: 'unread',
    });
    expect(out.page.map((r) => r.id)).toEqual(['a', 'd']);
    expect(out.total).toBe(2);
    expect(out.unreadCount).toBe(2);
  });

  it('pages with limit/offset and reports the unread count across all rows', () => {
    const out = applyNotificationsListQuery(rows, {
      limit: 2,
      offset: 2,
      type: null,
      read: 'all',
    });
    expect(out.page.map((r) => r.id)).toEqual(['c', 'd']);
    expect(out.total).toBe(4);
    expect(out.unreadCount).toBe(2);
  });

  it('derives type options from real rows only', () => {
    expect(notificationTypeOptions(rows)).toEqual(['deal', 'digest', 'price-drop']);
  });
});

describe('Section 14 Chunk 1 static wiring guards', () => {
  it('dead PriceChart is gone (zero importers at deletion time)', () => {
    expect(repoExists('components', 'products', 'price-chart.tsx')).toBe(false);
    // No live importer may reference it.
    for (const file of ['app', 'components', 'lib', 'services']) {
      const hits: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(tsx?)$/.test(entry.name)) {
            const text = fs.readFileSync(full, 'utf8');
            if (/from\s+['"]@\/components\/products\/price-chart['"]/.test(text)) hits.push(full);
          }
        }
      };
      walk(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', file));
      expect(hits).toEqual([]);
    }
  });

  it('Deal Hotspots Calendar is wired into /deals (not dead)', () => {
    const deals = repoFile('app', 'deals', 'page.tsx');
    expect(deals).toContain("from '@/components/deals/deal-hotspots-calendar'");
    expect(deals).toContain('<DealHotspotsCalendar');
  });

  it('chat input has an accessible label', () => {
    const widget = repoFile('components', 'chat', 'ai-deal-finder-widget.tsx');
    expect(widget).toContain('aria-label="Ask the AI Deal Finder"');
  });

  it('product GET routes are force-dynamic (except the chunk-owned list route)', () => {
    const routes = [
      ['app', 'api', 'v1', 'products', '[slug]', 'route.ts'],
      ['app', 'api', 'v1', 'products', '[slug]', 'deals', 'route.ts'],
      ['app', 'api', 'v1', 'products', '[slug]', 'merchants', 'route.ts'],
      ['app', 'api', 'v1', 'products', '[slug]', 'prices', 'route.ts'],
      ['app', 'api', 'v1', 'products', '[slug]', 'similar', 'route.ts'],
      ['app', 'api', 'v1', 'predictions', '[productId]', 'route.ts'],
      ['app', 'api', 'v1', 'ai-summary', '[productId]', 'route.ts'],
    ];
    for (const route of routes) {
      expect(repoFile(...route)).toContain("export const dynamic = 'force-dynamic'");
    }
  });

  it('comparison API transforms retailer URLs server-side; compare page links out', () => {
    const route = repoFile('app', 'api', 'v1', 'comparison', 'route.ts');
    expect(route).toContain('buildGeoAffiliateUrl');
    expect(route).toContain('affiliateEnabled');
    const page = repoFile('app', 'compare', 'page.tsx');
    expect(page).toContain('href={row.url}');
    expect(page).toContain('href={r.url}');
    expect(page).toContain('rel="noopener noreferrer"');
    expect(page).toContain('Affiliate disclosure: SmartBuy may earn a commission');
  });

  it('notifications list API supports limit/offset/filters and the bulk endpoint exists', () => {
    const route = repoFile('app', 'api', 'v1', 'notifications', 'route.ts');
    expect(route).toContain('parseNotificationsListQuery');
    expect(route).toContain('unreadCount');
    expect(repoExists('app', 'api', 'v1', 'notifications', 'read-all', 'route.ts')).toBe(true);
    const bulk = repoFile('app', 'api', 'v1', 'notifications', 'read-all', 'route.ts');
    expect(bulk).toContain("read must be a boolean");
    const page = repoFile('app', 'dashboard', 'notifications', 'page.tsx');
    expect(page).toContain('/api/v1/notifications/read-all');
    expect(page).toContain('unread');
    const sidebar = repoFile('components', 'layout', 'dashboard-sidebar.tsx');
    expect(sidebar).toContain('unreadNotifications');
  });

  it('migration 036 CHECK lists every NEWSLETTER_SOURCES value', () => {
    const sql = repoFile(
      'supabase',
      'migrations',
      '20261111133000_036_newsletter_subscribers.sql'
    );
    expect(sql).toContain('DO NOT APPLY YET');
    for (const source of NEWSLETTER_SOURCES) {
      expect(sql).toContain(`'${source}'`);
    }
  });
});
