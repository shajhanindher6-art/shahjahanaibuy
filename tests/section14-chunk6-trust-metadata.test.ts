/**
 * Section 14, Chunk 6 — trust / metadata / SEO tests.
 *
 * The three new JSON-LD builders are tested as pure modules. The
 * page wiring (which page carries which metadata / schema) is
 * asserted by reading the source files as text — those pages import
 * the React site header / footer, so they are not imported here
 * (same approach as the Section 13 trust tests). No database, no
 * network.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildCreatorPersonJsonLd,
  buildLiveSessionEventJsonLd,
  buildToolsItemListJsonLd,
} from '@/lib/json-ld';

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(process.cwd(), rel));
}

const SITE = 'https://shahjahanaibuy-b1zp.vercel.app';

describe('buildLiveSessionEventJsonLd (live session Event)', () => {
  const base = {
    slug: 'friday-deals-live',
    title: 'Friday Deals Live',
    hostNote: 'The host walks through real laptops at real prices.',
    startsAt: '2026-11-13T15:00:00Z',
    endsAt: '2026-11-13T16:00:00Z',
  };

  it('includes the session URL, scheduled start, and recorded end', () => {
    const schema = buildLiveSessionEventJsonLd(SITE, base);
    expect(schema['@type']).toBe('Event');
    expect(schema.name).toBe('Friday Deals Live');
    expect(schema.url).toBe(`${SITE}/live/friday-deals-live`);
    expect(schema.startDate).toBe('2026-11-13T15:00:00Z');
    expect(schema.endDate).toBe('2026-11-13T16:00:00Z');
    expect(schema.description).toBe(
      'The host walks through real laptops at real prices.'
    );
  });

  it('omits endDate and description when none is recorded', () => {
    const schema = buildLiveSessionEventJsonLd(SITE, {
      slug: 'friday-deals-live',
      title: 'Friday Deals Live',
      startsAt: '2026-11-13T15:00:00Z',
    });
    expect(schema).not.toHaveProperty('endDate');
    expect(schema).not.toHaveProperty('description');
  });

  it('never claims a location or a performer — no venue or host name is recorded', () => {
    const schema = buildLiveSessionEventJsonLd(SITE, base);
    expect(schema).not.toHaveProperty('location');
    expect(schema).not.toHaveProperty('performer');
    expect(schema).not.toHaveProperty('organizer');
  });

  it('escapes a </script> sequence in the host note via toJsonLd, not the builder', () => {
    // The builder returns plain data; pages serialize with toJsonLd.
    // This just pins that the builder keeps the raw note (no silent drop).
    const schema = buildLiveSessionEventJsonLd(SITE, {
      ...base,
      hostNote: 'Deals </script> live',
    });
    expect(schema.description).toBe('Deals </script> live');
  });
});

describe('buildCreatorPersonJsonLd (creator storefront Person)', () => {
  it('includes the storefront URL and the recorded bio', () => {
    const schema = buildCreatorPersonJsonLd(SITE, {
      slug: 'deal-hunter',
      displayName: 'Deal Hunter',
      bio: 'I share verified laptop deals.',
    });
    expect(schema['@type']).toBe('Person');
    expect(schema.name).toBe('Deal Hunter');
    expect(schema.url).toBe(`${SITE}/creators/deal-hunter`);
    expect(schema.description).toBe('I share verified laptop deals.');
  });

  it('falls back to "Creator" and omits description when none is recorded', () => {
    const schema = buildCreatorPersonJsonLd(SITE, { slug: 'anon' });
    expect(schema.name).toBe('Creator');
    expect(schema).not.toHaveProperty('description');
  });

  it('never claims social profiles, follower counts, or earnings — none are recorded', () => {
    const schema = buildCreatorPersonJsonLd(SITE, {
      slug: 'deal-hunter',
      displayName: 'Deal Hunter',
      bio: 'I share verified laptop deals.',
    });
    expect(schema).not.toHaveProperty('sameAs');
    expect(schema).not.toHaveProperty('follows');
    expect(schema).not.toHaveProperty('knowsAbout');
  });
});

describe('buildToolsItemListJsonLd (tools hub ItemList)', () => {
  it('lists the real tool pages as an ItemList', () => {
    const list = buildToolsItemListJsonLd(SITE, [
      { name: 'Help Me Choose', path: '/tools/help-me-choose' },
      { name: 'Price History Explorer', path: '/tools/price-history' },
    ]);
    expect(list['@type']).toBe('ItemList');
    const items = list.itemListElement as Array<{
      position: number;
      name: string;
      url: string;
    }>;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      name: 'Help Me Choose',
      url: `${SITE}/tools/help-me-choose`,
    });
    expect(items[1].position).toBe(2);
  });

  it('emits an empty ItemList for an empty tool list — no invented tools', () => {
    const list = buildToolsItemListJsonLd(SITE, []);
    expect(list['@type']).toBe('ItemList');
    expect(list.itemListElement).toEqual([]);
  });
});

describe('generateMetadata wiring (live + creator detail pages)', () => {
  it('live/[slug] uses generateMetadata per session with a self-canonical URL', () => {
    const text = readSource('app/live/[slug]/page.tsx');
    expect(text).toContain('export async function generateMetadata');
    expect(text).toContain('getLiveSessionDetail');
    expect(text).toContain('/live/${session.slug}');
    expect(text).toContain('openGraph');
  });

  it('live/[slug] renders the Event schema from the recorded session', () => {
    const text = readSource('app/live/[slug]/page.tsx');
    expect(text).toContain('buildLiveSessionEventJsonLd(');
    expect(text).toContain('type="application/ld+json"');
  });

  it('creators/[slug] uses generateMetadata per creator with a self-canonical URL', () => {
    const text = readSource('app/creators/[slug]/page.tsx');
    expect(text).toContain('export async function generateMetadata');
    expect(text).toContain('getCreatorBySlug');
    expect(text).toContain('/creators/${creator.slug}');
    expect(text).toContain('openGraph');
  });

  it('creators/[slug] renders the Person schema from the recorded storefront', () => {
    const text = readSource('app/creators/[slug]/page.tsx');
    expect(text).toContain('buildCreatorPersonJsonLd(');
    expect(text).toContain('type="application/ld+json"');
  });

  it('live index and creators index already had metadata — they were NOT duplicated', () => {
    expect(readSource('app/live/page.tsx')).toContain('export const metadata');
    expect(readSource('app/creators/page.tsx')).toContain('export const metadata');
    expect(readSource('app/live/page.tsx')).not.toContain('generateMetadata');
    expect(readSource('app/creators/page.tsx')).not.toContain('generateMetadata');
  });
});

describe('auth metadata wrappers (sign-in / sign-up)', () => {
  it('both layouts exist, export metadata once, and self-canonicalize', () => {
    for (const [rel, path] of [
      ['app/sign-in/layout.tsx', '/sign-in'],
      ['app/sign-up/layout.tsx', '/sign-up'],
    ] as const) {
      expect(exists(rel)).toBe(true);
      const text = readSource(rel);
      expect(text).toContain('export const metadata');
      expect(text).toContain(`${'${appConfig.url}'}${path}`);
      expect(text).toContain('openGraph');
      // Auth forms are not content to index.
      expect(text).toContain('index: false');
    }
  });

  it('the client pages themselves export no metadata (no duplicate source)', () => {
    expect(readSource('app/sign-in/page.tsx')).not.toContain('export const metadata');
    expect(readSource('app/sign-up/page.tsx')).not.toContain('export const metadata');
  });
});

describe('noindex wrappers for the remaining gated / non-content pages', () => {
  it('admin and dashboard layouts carry robots noindex (no canonical, no OG)', () => {
    for (const rel of ['app/admin/layout.tsx', 'app/dashboard/layout.tsx']) {
      const text = readSource(rel);
      expect(text).toContain('index: false');
      // No canonical or OG in the metadata object (the word appears
      // in the header comment explaining why — check the keys).
      expect(text).not.toContain('canonical:');
      expect(text).not.toContain('openGraph:');
    }
  });

  it('forgot-password, verify-email, auth callback, and shared wishlists have noindex layouts', () => {
    for (const rel of [
      'app/forgot-password/layout.tsx',
      'app/verify-email/layout.tsx',
      'app/auth/layout.tsx',
      'app/wishlists/layout.tsx',
    ]) {
      expect(exists(rel)).toBe(true);
      expect(readSource(rel)).toContain('index: false');
    }
  });
});

describe('llms.txt refresh', () => {
  it('adds the missing key pages', () => {
    const text = readSource('public/llms.txt');
    for (const path of [
      '/live',
      '/creators',
      '/events',
      '/extension',
      '/platforms',
      '/price-index',
      '/market-reports',
      '/mobile-app',
      '/help',
      '/faq',
      '/methodology',
      '/api-docs',
      '/status',
    ]) {
      expect(text).toContain(`https://shahjahanaibuy-b1zp.vercel.app${path}`);
    }
  });

  it('keeps the languages qualifier honest', () => {
    const text = readSource('public/llms.txt');
    expect(text).toContain('only 167 chrome strings are translated');
    expect(text).toContain('12 of the 20 languages are machine-translated');
  });
});

describe('already-present at base — verified, not re-built', () => {
  it('all 13 original tool layouts already carry canonical + Open Graph', () => {
    const original13 = [
      'best-time-calendar',
      'eco-coach',
      'expense-tracker',
      'future-you-planner',
      'list-optimizer',
      'monthly-planner',
      'price-drop-digest',
      'product-qa',
      'savings-dashboard',
      'smart-home-agent',
      'subscription-manager',
      'trade-in-finder',
      'warranty-claim-helper',
    ];
    for (const tool of original13) {
      const text = readSource(`app/tools/${tool}/layout.tsx`);
      expect(text).toContain('export const metadata');
      expect(text).toContain(`/tools/${tool}`);
      expect(text).toContain('openGraph');
    }
  });

  it('robots.ts already exists with honest rules', () => {
    const text = readSource('app/robots.ts');
    // Section 17, Stage H item 19 added '/owner/' (the admin-only
    // owner dashboard, same as '/admin/').
    expect(text).toContain("disallow: ['/api/', '/dashboard/', '/admin/', '/owner/', '/auth/']");
    expect(text).toContain('/sitemap.xml');
  });

  it('hreflang already exists in the root layout (no localized routes — alternates point at the same URL)', () => {
    const text = readSource('app/layout.tsx');
    expect(text).toContain('languageAlternates');
    expect(text).toContain("'x-default': appConfig.url");
  });

  it('the generic ItemList builder already exists and is already wired on listing pages', () => {
    const lib = readSource('lib/json-ld.ts');
    expect(lib).toContain('export function buildItemListJsonLd');
    expect(readSource('app/blog/page.tsx')).toContain('buildItemListJsonLd(');
    expect(readSource('app/deals/page.tsx')).toContain('buildItemListJsonLd(');
  });
});
