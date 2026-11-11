/**
 * Section 14, Chunk 8 — PWA / i18n / a11y / Perf.
 *
 * Static assertions in the repo's existing style (read the source,
 * assert on it — same as tests/press-status.test.ts). Nothing here
 * renders a page or calls a live service.
 *
 * Drops (documented, not tested — there is nothing to assert):
 * P-3 manifest screenshots, E-1 store listing pack and A-3 axe
 * audit are all dropped: no real screenshots can be captured in
 * this sandbox and Playwright is not installed. The manifest test
 * below locks the honest state (screenshots stays empty) so no
 * fake capture can be added later.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirForLanguage, tFor } from '@/lib/i18n';

const root = (...parts: string[]) => join(process.cwd(), ...parts);
const read = (rel: string) => readFileSync(root(rel), 'utf8');

describe('PWA — iOS install guidance (P-1)', () => {
  const src = read('components/pwa/install-prompt.tsx');

  it('detects iOS, including iPadOS reporting as Macintosh', () => {
    expect(src).toContain('iPad|iPhone|iPod');
    expect(src).toContain('maxTouchPoints');
  });

  it('shows the manual Share → Add to Home Screen steps, with a link to the full guide', () => {
    expect(src).toContain('Add to Home Screen');
    expect(src).toContain('Share');
    expect(src).toContain('href="/mobile-app"');
    expect(src).toContain('Full install guide');
  });

  it('never claims an App Store download exists', () => {
    expect(src).not.toMatch(/available on the App Store|download.*from the App Store|get it on the App Store/i);
    expect(src).toContain('no App Store download');
  });

  it('is dismissible with the same flag as the Chromium card', () => {
    expect(src).toContain('sb-pwa-install-dismissed');
    expect(src).toContain('Not now');
  });
});

describe('PWA — manifest screenshots stay honest (P-3 dropped)', () => {
  it('has no screenshots: real captures only, none capturable here', () => {
    const manifest = JSON.parse(read('public/manifest.json')) as {
      screenshots?: unknown[];
    };
    expect(manifest.screenshots).toEqual([]);
  });
});

describe('PWA — offline page depth (P-2)', () => {
  const src = read('app/offline/page.tsx');

  it('reloads itself when the connection returns and shows live status', () => {
    expect(src).toContain("addEventListener('online'");
    expect(src).toContain('window.location.reload()');
    expect(src).toContain('Status: offline');
  });

  it('shows recently viewed products from this device, labelled as cache-only', () => {
    expect(src).toContain('getRecentlyViewed');
    expect(src).toContain('Recently viewed on this device');
    expect(src).toContain('may open from your device');
  });

  it('offers cached-page quick links and keeps the honest limits', () => {
    expect(src).toContain('href="/deals"');
    expect(src).toContain('href="/tools"');
    expect(src).toContain('never served stale');
  });
});

describe('i18n — footer wiring (I-2)', () => {
  const src = read('components/layout/site-footer.tsx');

  it('renders link labels through tFor, not hardcoded English', () => {
    expect(src).toContain("tFor(language, link.labelKey)");
    expect(src).toContain("labelKey: 'footerLinkAiTools'");
    expect(src).toContain("labelKey: 'footerLinkPrivacyPolicy'");
    expect(src).toContain("labelKey: 'navFeatures'");
  });

  it('renders the new English footer strings', () => {
    expect(tFor('en', 'footerLinkScanProduct')).toBe('Scan a Product');
    expect(tFor('en', 'footerLinkAffiliateDisclosure')).toBe('Affiliate Disclosure');
    expect(tFor('en', 'footerLinkWarrantyPlans')).toBe('Warranty Plans');
  });
});

describe('i18n — RTL helper (I-3)', () => {
  it('dirForLanguage returns rtl only for Arabic', () => {
    expect(dirForLanguage('ar')).toBe('rtl');
    expect(dirForLanguage('en')).toBe('ltr');
    expect(dirForLanguage('ur')).toBe('ltr');
  });

  it('the stale "flips only on next load" note is gone from lib/i18n.ts', () => {
    const src = read('lib/i18n.ts');
    expect(src).not.toContain('flips dir on the next page load');
    expect(src).not.toContain('does not yet set dir');
    expect(src).toContain('dirForLanguage');
  });
});

describe('i18n — tools hub + headings keys exist for wiring (I-4, I-5)', () => {
  it('renders the tools-hub English strings', () => {
    expect(tFor('en', 'toolsHubTitle')).toBe('AI tools');
    expect(tFor('en', 'toolsHubGroupMoney')).toBe('Money-saving tools — savings you can see');
    expect(tFor('en', 'toolsHubComingNext')).toBe('What’s coming next');
    expect(tFor('en', 'toolsHubSeeRoadmap')).toBe('See the roadmap');
  });

  it('renders the page-heading English strings', () => {
    expect(tFor('en', 'pageHeadingCompare')).toBe('Product Comparison');
    expect(tFor('en', 'pageHeadingBrands')).toBe('Browse by brand');
    expect(tFor('en', 'pageHeadingEvents')).toBe('Seasonal events');
    expect(tFor('en', 'pageHeadingContact')).toBe('Contact Us');
  });

  it('the hub page IS wired — assembly (Section 14): chrome via toolsHub* keys', () => {
    const hub = read('app/tools/page.tsx');
    expect(hub).toContain('ToolsHubContent');
    expect(hub).toContain('buildToolsItemListJsonLd');
    const chrome = read('components/tools/tools-hub-content.tsx');
    expect(chrome).toContain('toolsHubTitle');
    expect(chrome).toContain('toolsHubComingNext');
  });
});

describe('loading.tsx pack (L-1)', () => {
  const routes = [
    'about',
    'api-docs',
    'bookmarklet',
    'bundles',
    'contact',
    'cookies',
    'creators',
    'docs',
    'editorial-policy',
    'faq',
    'gifts',
    'help',
    'methodology',
    'offline',
    'p2p-match',
    'platforms',
    'price-index',
    'privacy',
    'products/[slug]',
    'scan',
    'status',
    'support',
    'sustainability',
    'terms',
    'track',
    'warranty-plans',
    'widgets',
  ];

  it('exists for all 27 routes and renders an accessible skeleton', () => {
    for (const route of routes) {
      const path = root(`app/${route}/loading.tsx`);
      expect(existsSync(path)).toBe(true);
      const src = readFileSync(path, 'utf8');
      expect(src).toContain('role="status"');
      expect(src).toContain('Skeleton');
      expect(src).toContain('export default function Loading');
    }
  });

  it('gives the product page its own product-shaped skeleton', () => {
    const src = read('app/products/[slug]/loading.tsx');
    expect(src).toContain('Loading product…');
    expect(src).toContain('aspect-[4/3]');
  });
});
