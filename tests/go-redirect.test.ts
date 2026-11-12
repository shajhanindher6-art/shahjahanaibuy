/**
 * /go redirect hub tests (Section 15, A6).
 *
 * The hub wraps existing outbound merchant links: it validates the
 * target with isTrackableClickHost, records the click in the same
 * affiliate_geo_clicks table the geo-click beacon writes to, then
 * redirects (302). It must NEVER become an open redirector: unlisted
 * hosts — including lookalikes such as amazon.evil.com — get a 400
 * and no redirect. No affiliate tag value may appear in the route
 * source (tags live in env only).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

// --- Mocked Supabase service client (in-memory click table) ---
const fakeDb = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  failInsert: false,
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({
    from: (_table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (fakeDb.failInsert) {
          return { error: { code: 'PGRST205', message: 'table not found' } };
        }
        fakeDb.rows.push(row);
        return { error: null };
      },
    }),
  }),
}));

// Imported after the mock so the route uses the fake client.
import { GET } from '@/app/go/route';
import { buildGoUrl } from '@/lib/affiliate-beacon';

let ipCounter = 0;
function goRequest(url: string): NextRequest {
  ipCounter += 1;
  return new NextRequest(url, {
    headers: { 'x-real-ip': `203.0.113.${ipCounter}` },
  });
}

function goUrl(target: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ u: target, ...(extra ?? {}) });
  return `http://localhost/go?${params.toString()}`;
}

describe('GET /go — allowed hosts redirect', () => {
  it.each([
    ['Amazon search', 'https://www.amazon.com/s?k=macbook+air+13'],
    ['Amazon locale domain', 'https://www.amazon.co.uk/s?k=macbook+air+13'],
    ['Best Buy search', 'https://www.bestbuy.com/site/searchpage.jsp?st=macbook+air'],
    ['eBay search', 'https://www.ebay.co.uk/sch/i.html?_nkw=macbook+air'],
    ['stores-directory host', 'https://www.daraz.pk/catalog/?q=macbook+air'],
    ['Skimlinks-wrapped link', 'https://go.skimresources.com/?id=x&url=https%3A%2F%2Fwww.amazon.com%2Fs%3Fk%3Dmacbook'],
  ])('%s: 302 to the target exactly', async (_label, target) => {
    fakeDb.rows.length = 0;
    const res = await GET(goRequest(goUrl(target)));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(target);
    // The click was recorded via the beacon path (same table/fields).
    expect(fakeDb.rows).toHaveLength(1);
    expect(fakeDb.rows[0]).toMatchObject({ target_url: target });
  });

  it('records product slug + merchant name when provided', async () => {
    fakeDb.rows.length = 0;
    const res = await GET(
      goRequest(
        goUrl('https://www.amazon.com/s?k=macbook+air+13', {
          s: 'macbook-air-13',
          m: 'Amazon',
        })
      )
    );
    expect(res.status).toBe(302);
    expect(fakeDb.rows).toHaveLength(1);
    expect(fakeDb.rows[0]).toMatchObject({
      product_slug: 'macbook-air-13',
      retailer_name: 'Amazon',
      product_id: null,
      country_code: null,
    });
  });

  it('still redirects when the click table is unavailable (fail-open)', async () => {
    fakeDb.rows.length = 0;
    fakeDb.failInsert = true;
    try {
      const res = await GET(goRequest(goUrl('https://www.amazon.com/s?k=macbook+air+13')));
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://www.amazon.com/s?k=macbook+air+13');
      expect(fakeDb.rows).toHaveLength(0);
    } finally {
      fakeDb.failInsert = false;
    }
  });
});

describe('GET /go — disallowed hosts are rejected, never redirected', () => {
  it.each([
    ['unrelated host', 'https://evil.com/s?k=macbook'],
    ['Amazon lookalike subdomain', 'https://amazon.evil.com/s?k=macbook'],
    ['Amazon as a subdomain label', 'https://amazon.com.evil.com/s?k=macbook'],
    ['unknown retailer', 'https://www.random-shop-xyz.example/s?k=macbook'],
  ])('%s: 400, no Location header, no click recorded', async (_label, target) => {
    fakeDb.rows.length = 0;
    const res = await GET(goRequest(goUrl(target)));
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect(fakeDb.rows).toHaveLength(0);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

describe('GET /go — invalid targets', () => {
  it('missing target → 400', async () => {
    const res = await GET(goRequest('http://localhost/go'));
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('empty target → 400', async () => {
    const res = await GET(goRequest('http://localhost/go?u=%20'));
    expect(res.status).toBe(400);
  });

  it.each([
    ['javascript: URL', 'javascript:alert(1)'],
    ['ftp: URL', 'ftp://example.com/file'],
    ['protocol-relative URL', '//evil.com/s?k=macbook'],
    ['not a URL at all', 'not-a-url'],
  ])('%s → 400, never redirected', async (_label, target) => {
    const res = await GET(goRequest(goUrl(target)));
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('buildGoUrl — destination preserved exactly', () => {
  it('round-trips the target through /go unchanged', () => {
    const target = 'https://www.daraz.pk/catalog/?q=macbook+air+13&lang=en';
    const href = buildGoUrl(target);
    expect(href.startsWith('/go?')).toBe(true);
    const parsed = new URL(`http://localhost${href}`);
    expect(parsed.searchParams.get('u')).toBe(target);
  });

  it('carries slug + merchant context as separate params', () => {
    const href = buildGoUrl('https://www.amazon.com/s?k=x', {
      productSlug: 'macbook-air-13',
      merchantName: 'Amazon',
    });
    const parsed = new URL(`http://localhost${href}`);
    expect(parsed.searchParams.get('u')).toBe('https://www.amazon.com/s?k=x');
    expect(parsed.searchParams.get('s')).toBe('macbook-air-13');
    expect(parsed.searchParams.get('m')).toBe('Amazon');
  });

  it('omits empty tracking context', () => {
    const parsed = new URL(`http://localhost${buildGoUrl('https://www.amazon.com/s?k=x')}`);
    expect(parsed.searchParams.get('s')).toBeNull();
    expect(parsed.searchParams.get('m')).toBeNull();
  });
});

describe('/go route source — no tag values, allowlist reuse mandatory', () => {
  const src = readFileSync(join(process.cwd(), 'app/go/route.ts'), 'utf8');

  it('contains no affiliate tag value and no tag env name', () => {
    expect(src).not.toContain('smartbuy-20');
    expect(src).not.toContain('AMAZON_ASSOC_TAG');
    expect(src).not.toContain('SKIMLINKS_PUBLISHER_ID');
  });

  it('validates hosts with isTrackableClickHost', () => {
    expect(src).toContain('isTrackableClickHost');
  });

  it('is force-dynamic', () => {
    expect(src).toContain("export const dynamic = 'force-dynamic'");
  });
});
