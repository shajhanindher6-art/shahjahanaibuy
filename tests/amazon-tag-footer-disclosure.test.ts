/**
 * Amazon Associates tag delta (2026-11-18) — wiring + disclosure tests.
 *
 * Covers the paths the audit found bypassing the geo affiliate engine
 * (the /api/v1/stores route and the batch transform endpoint the two
 * tool pages rely on), the visible Amazon Associates sentence in the
 * site footer, and the same sentence in the methodology disclosure
 * section. The tag value in every test is a fixture (`test-tag-20`),
 * never the live value — these tests pin the mechanism, not the
 * account.
 *
 * Boundaries stubbed so the render covers the page/footer, not the
 * shell (tool-pages.test.ts pattern): next/link → plain <a>,
 * SiteHeader → null, useRegion → English, NewsletterCapture → null,
 * Supabase server client → throws (the methodology page catches that
 * and renders with no freshness stamp, its honest-empty path).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) =>
    React.createElement('a', { href, ...props }, children),
}));

vi.mock('@/components/layout/site-header', () => ({
  SiteHeader: () => null,
}));

vi.mock('@/components/region/region-provider', () => ({
  useRegion: () => ({ language: 'en' }),
}));

vi.mock('@/components/home/newsletter-capture', () => ({
  NewsletterCapture: () => null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    throw new Error('no db in test');
  },
}));

// Imported after the mocks so the pages/routes use the fakes.
import { GET as storesGet } from '@/app/api/v1/stores/route';
import { POST as transformPost } from '@/app/api/v1/affiliate/transform/route';
import { SiteFooter } from '@/components/layout/site-footer';
import MethodologyPage from '@/app/methodology/page';

const TAG = 'AMAZON_ASSOC_TAG';
const savedTag = process.env[TAG];

function setTag(value: string | undefined): void {
  if (value === undefined) delete process.env[TAG];
  else process.env[TAG] = value;
}

afterEach(() => setTag(savedTag));

// Distinct IPs per request so the per-IP rate limits (stores 120/min,
// transform 30/min) never trip inside this file.
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function storesRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { 'x-real-ip': nextIp() },
  });
}

function transformRequest(urls: string[]): NextRequest {
  return new NextRequest(
    'http://localhost:3000/api/v1/affiliate/transform',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-real-ip': nextIp(),
      },
      body: JSON.stringify({ urls }),
    }
  );
}

type StoreEntry = { slug: string; searchUrl: string | null };

const AMAZON_SENTENCE =
  'As an Amazon Associate, I earn from qualifying purchases.';

describe('GET /api/v1/stores — affiliate transform', () => {
  it('tags the Amazon search URL + reports affiliateEnabled when a tag is configured', async () => {
    setTag('test-tag-20');
    const res = await storesGet(
      storesRequest('/api/v1/stores?country=US&q=laptop')
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.meta?.affiliateEnabled).toBe(true);
    const international = json.data.international as StoreEntry[];
    const amazon = international.find((s) => s.slug === 'amazon');
    expect(amazon).toBeDefined();
    expect(amazon!.searchUrl).toContain('amazon.com/s?k=laptop');
    expect(amazon!.searchUrl).toContain('tag=test-tag-20');
  });

  it('leaves search URLs plain + affiliateEnabled false when nothing is configured', async () => {
    setTag(undefined);
    const res = await storesGet(
      storesRequest('/api/v1/stores?country=US&q=laptop')
    );
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.meta?.affiliateEnabled).toBe(false);
    const international = json.data.international as StoreEntry[];
    const amazon = international.find((s) => s.slug === 'amazon');
    expect(amazon!.searchUrl).toBe('https://www.amazon.com/s?k=laptop');
    expect(amazon!.searchUrl).not.toContain('tag=');
  });

  it('never stamps the US tag on a GB visitor (locale scoping preserved)', async () => {
    setTag('test-tag-20');
    const res = await storesGet(
      storesRequest('/api/v1/stores?country=GB&q=laptop')
    );
    const json = await res.json();
    expect(json.success).toBe(true);
    const international = json.data.international as StoreEntry[];
    const amazon = international.find((s) => s.slug === 'amazon');
    expect(amazon).toBeDefined();
    expect(amazon!.searchUrl).not.toContain('tag=');
  });

  it('leaves non-Amazon store URLs unchanged even when a tag is configured', async () => {
    setTag('test-tag-20');
    const res = await storesGet(
      storesRequest('/api/v1/stores?country=US&q=laptop')
    );
    const json = await res.json();
    const all = [
      ...(json.data.local as StoreEntry[]),
      ...(json.data.international as StoreEntry[]),
    ];
    const ebay = all.find((s) => s.slug === 'ebay');
    expect(ebay).toBeDefined();
    expect(ebay!.searchUrl).toBe(
      'https://www.ebay.com/sch/i.html?_nkw=laptop'
    );
  });
});

describe('POST /api/v1/affiliate/transform — Amazon tagging', () => {
  it('stamps tag= on an Amazon search URL when a tag is configured', async () => {
    setTag('test-tag-20');
    const res = await transformPost(
      transformRequest(['https://www.amazon.com/s?k=laptop'])
    );
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.urls[0]).toContain('tag=test-tag-20');
    expect(json.meta?.affiliateEnabled).toBe(true);
  });

  it('returns the URL unchanged when nothing is configured', async () => {
    setTag(undefined);
    const res = await transformPost(
      transformRequest(['https://www.amazon.com/s?k=laptop'])
    );
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.urls[0]).toBe('https://www.amazon.com/s?k=laptop');
    expect(json.meta?.affiliateEnabled).toBe(false);
  });
});

describe('SiteFooter — Amazon Associates sentence', () => {
  it('renders the exact Amazon-required sentence + disclosure link', () => {
    const html = renderToStaticMarkup(React.createElement(SiteFooter));
    expect(html).toContain(AMAZON_SENTENCE);
    expect(html).toContain('href="/methodology#affiliate-disclosure"');
  });
});

describe('Methodology page — affiliate disclosure section', () => {
  // The page renders the real SiteFooter below the disclosure
  // section, and the footer now always carries the sentence — so
  // these assertions slice the disclosure section itself (between
  // its heading and the next heading) instead of the whole page.
  function disclosureSection(html: string): string {
    const start = html.indexOf('id="affiliate-disclosure"');
    const end = html.indexOf('Questions or corrections', start);
    return html.slice(start, end === -1 ? undefined : end);
  }

  it('includes the exact Amazon sentence when a tag is configured', async () => {
    setTag('test-tag-20');
    const html = renderToStaticMarkup(await MethodologyPage());
    expect(disclosureSection(html)).toContain(AMAZON_SENTENCE);
  });

  it('omits the sentence + says nothing is configured when no tag is set', async () => {
    setTag(undefined);
    const html = renderToStaticMarkup(await MethodologyPage());
    const section = disclosureSection(html);
    expect(section).not.toContain(AMAZON_SENTENCE);
    expect(section).toContain('No affiliate tag is currently configured');
  });
});
