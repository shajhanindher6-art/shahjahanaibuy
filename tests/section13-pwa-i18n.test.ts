/**
 * Section 13, chunk H — PWA, i18n Phase 1, a11y, perf, loading
 * pack, extension readiness.
 *
 * Static assertions in the repo's existing style (read the source,
 * assert on it — same as tests/press-status.test.ts). Nothing here
 * renders a page or calls a live service.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DICTIONARIES, tFor } from '@/lib/i18n';
import { SUPPORTED_LANGUAGES } from '@/lib/region';

const root = (...parts: string[]) => join(process.cwd(), ...parts);
const read = (rel: string) => readFileSync(root(rel), 'utf8');

// The 15 Phase 1 keys added by this chunk (lib/i18n.ts).
const PHASE_1_KEYS = [
  'footerProduct',
  'footerCompany',
  'footerResources',
  'footerTransparency',
  'footerLegal',
  'footerTagline',
  'newsletterHeading',
  'homeFeaturedHeading',
  'homeFeaturesHeading',
  'homeToolsHeading',
  'homeToolsMoreHeading',
  'homeHowItWorksHeading',
  'homeTestimonialsHeading',
  'homeCtaHeading',
  'homeCtaSubheading',
] as const;

describe('PWA — service worker (public/sw.js)', () => {
  const sw = read('public/sw.js');

  it('is versioned smartbuy-v3', () => {
    expect(sw).toContain("CACHE_VERSION = 'smartbuy-v3'");
  });

  it('precaches per-asset with a catch, not all-or-nothing addAll', () => {
    expect(sw).not.toContain('cache.addAll');
    expect(sw).toContain('cache.add(url).catch');
  });

  it('precaches the new routes /tools, /pricing, /faq, /help', () => {
    for (const route of ['/tools', '/pricing', '/faq', '/help']) {
      expect(sw).toContain(`'${route}'`);
    }
  });

  it('caps the image and runtime caches', () => {
    expect(sw).toContain('MAX_IMAGE_ENTRIES');
    expect(sw).toContain('MAX_RUNTIME_ENTRIES');
    expect(sw).toContain('trimCache(IMAGE_CACHE');
    expect(sw).toContain('trimCache(RUNTIME_CACHE');
  });
});

describe('PWA — manifest (public/manifest.json)', () => {
  const manifest = JSON.parse(read('public/manifest.json')) as {
    orientation?: string;
    shortcuts?: Array<{ name: string; url: string }>;
  };

  it('has Search / Deals / Tools shortcuts', () => {
    const urls = (manifest.shortcuts ?? []).map((s) => s.url);
    expect(urls).toEqual(expect.arrayContaining(['/search', '/deals', '/tools']));
    expect(manifest.shortcuts).toHaveLength(3);
  });

  it('drops orientation: portrait-primary (odd for a desktop shopping site)', () => {
    expect(manifest.orientation).toBeUndefined();
  });
});

describe('PWA — update notice (service-worker-register.tsx)', () => {
  const src = read('components/pwa/service-worker-register.tsx');

  it('shows an update-available notice and activates the waiting worker', () => {
    expect(src).toContain('A new version of SmartBuy is available');
    expect(src).toContain('SKIP_WAITING');
    expect(src).toContain('controllerchange');
    expect(src).toContain('updatefound');
  });
});

describe('i18n Phase 1 — 48-key parity', () => {
  it('every language defines all 48 keys, no more and no fewer', () => {
    expect(Object.keys(DICTIONARIES).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    for (const lang of SUPPORTED_LANGUAGES) {
      const keys = Object.keys(DICTIONARIES[lang]).sort();
      expect(keys).toHaveLength(48);
      for (const key of PHASE_1_KEYS) {
        expect(typeof DICTIONARIES[lang][key]).toBe('string');
        expect(DICTIONARIES[lang][key].length).toBeGreaterThan(0);
      }
    }
  });

  it('renders the Phase 1 English strings', () => {
    expect(tFor('en', 'footerProduct')).toBe('Product');
    expect(tFor('en', 'footerTagline')).toBe(
      'AI-powered shopping intelligence for smarter decisions.'
    );
    expect(tFor('en', 'newsletterHeading')).toBe('Get deal alerts by email');
    expect(tFor('en', 'homeFeaturedHeading')).toBe('Featured products');
    expect(tFor('en', 'homeToolsHeading')).toBe('AI tools — see what they do first');
    expect(tFor('en', 'homeCtaHeading')).toBe('Ready to shop smarter?');
  });

  it('gives the new keys real translations, not English, in the machine-translated languages', () => {
    for (const lang of ['ar', 'zh', 'ja', 'ko', 'hi', 'bn', 'nl', 'sv', 'pl', 'ru', 'id', 'vi'] as const) {
      expect(tFor(lang, 'homeFeaturedHeading')).not.toBe(tFor('en', 'homeFeaturedHeading'));
      expect(tFor(lang, 'footerTagline')).not.toBe(tFor('en', 'footerTagline'));
    }
  });
});

describe('i18n — heroSubtitle drops the real-time claim (item 31)', () => {
  it('no language promises real-time prices anymore', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(DICTIONARIES[lang].heroSubtitle).not.toMatch(/real-?time/i);
    }
  });

  it('the English subtitle promises price-drop alerts instead', () => {
    expect(tFor('en', 'heroSubtitle')).toContain('price-drop alerts');
  });
});

describe('perf doc — dated baseline (docs/performance-budgets.md)', () => {
  const doc = read('docs/performance-budgets.md');

  it('says the baseline is unverified live, with a date', () => {
    expect(doc).toMatch(/unverified live/i);
    expect(doc).toContain('11 Nov 2026');
  });

  it('never quotes 281 kB as the current baseline', () => {
    expect(doc).not.toContain('Baseline 281 kB');
    expect(doc).not.toMatch(/baseline is 281/i);
    // The stale number may only appear labelled as stale.
    expect(doc).toMatch(/281 kB.{0,80}stale|stale.{0,80}281 kB/i);
  });
});

describe('dead wrapper — components/ui/chart.tsx', () => {
  it('is deleted', () => {
    expect(existsSync(root('components/ui/chart.tsx'))).toBe(false);
  });
});

describe('loading.tsx pack', () => {
  const routes = [
    'pricing',
    'coming-soon',
    'brands',
    'categories',
    'tools',
    'mobile-app',
    'extension',
    'live',
    'events',
    'market-reports',
    'blog',
  ];

  it('exists for all 11 routes and renders an accessible skeleton', () => {
    for (const route of routes) {
      const path = root(`app/${route}/loading.tsx`);
      expect(existsSync(path)).toBe(true);
      const src = readFileSync(path, 'utf8');
      expect(src).toContain('role="status"');
      expect(src).toContain('Skeleton');
      expect(src).toContain('export default function Loading');
    }
  });
});

describe('extension publish-readiness (code only)', () => {
  it('manifest declares icons + homepage_url', () => {
    const manifest = JSON.parse(read('extension/manifest.json')) as {
      icons?: Record<string, string>;
      homepage_url?: string;
    };
    expect(manifest.icons).toEqual({
      '16': 'icons/icon-16.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    });
    expect(manifest.homepage_url).toBe('https://shahjahanaibuy-b1zp.vercel.app/extension');
  });

  it('the icon files exist at the declared sizes', () => {
    for (const size of [16, 48, 128]) {
      const buf = readFileSync(root(`extension/icons/icon-${size}.png`));
      // PNG IHDR: width at bytes 16-19, height at 20-23 (big-endian).
      expect(buf.readUInt32BE(16)).toBe(size);
      expect(buf.readUInt32BE(20)).toBe(size);
    }
  });

  it('the extension page does not claim to be published', () => {
    const page = read('app/extension/page.tsx');
    expect(page).not.toMatch(/available on the Chrome Web Store|get it on the Chrome Web Store/i);
    expect(page).toContain('not on the Chrome Web Store yet');
  });
});
