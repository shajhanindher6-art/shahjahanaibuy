/**
 * Section 10 polish — first-visit ease, loading states, trust facts,
 * design-system + a11y, AI-tools honesty.
 *
 * Source-level locks (no DB, no network): each assertion reads the file
 * the feature lives in, so a future regression fails loudly here instead
 * of silently shipping. Behavioural checks (live search, live pages)
 * belong to the headless/live recheck, not this file.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pressCounts from '@/lib/generated/press-counts.json';
import { formatPressCountsDate } from '../scripts/press-counts-run.mjs';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const exists = (rel: string) => existsSync(join(process.cwd(), rel));

describe('Section 10 — header search + mobile nav', () => {
  it('header search submits to the deep-linkable /search?q= URL', () => {
    const header = read('components/layout/site-header.tsx');
    expect(header).toContain('/search?q=');
    expect(header).toContain('searchPlaceholder');
  });

  it('mobile nav lists Search, Deals, Compare and Brands', () => {
    const header = read('components/layout/site-header.tsx');
    for (const href of ["href: '/search'", "href: '/deals'", "href: '/compare'", "href: '/brands'"]) {
      expect(header).toContain(href);
    }
  });
});

describe('Section 10 — shareable search (?q=)', () => {
  it('search page reads ?q= from the URL', () => {
    const page = read('app/search/page.tsx');
    expect(page).toContain('useSearchParams');
    expect(page).toContain("searchParams.get('q')");
  });

  it('autocomplete component exists with keyboard + ARIA support', () => {
    expect(exists('components/search/search-autocomplete.tsx')).toBe(true);
    const auto = read('components/search/search-autocomplete.tsx');
    expect(auto).toContain('AbortController');
    expect(auto).toContain('combobox');
  });

  it('SearchAction JSON-LD is wired now that ?q= works', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toContain('search?q={search_term_string}');
  });

  it('ai-search excludes the sample-laptop health-check row', () => {
    const aiSearch = read('services/ai-search.ts');
    expect(aiSearch).toContain(".neq('slug', 'sample-laptop')");
  });
});

describe('Section 10 — homepage deal strip', () => {
  it('homepage renders a featured-products strip under the hero', () => {
    const home = read('app/page.tsx');
    expect(home).toContain('FeaturedProductsStrip');
    expect(home).toContain('id="browse"');
  });

  it('strip is wrapped in Suspense so a slow catalog query never blocks the homepage', () => {
    const home = read('app/page.tsx');
    expect(home).toContain('<Suspense');
    expect(home).toContain('</Suspense>');
    expect(home).toContain('<FeaturedProductsStrip');
    // Fallback mirrors the section (heading + skeleton cards).
    expect(home).toContain('Loading featured products');
  });
});

describe('Section 10 — loading states', () => {
  const routes = ['app/loading.tsx', 'app/search/loading.tsx', 'app/deals/loading.tsx', 'app/compare/loading.tsx'];
  it.each(routes)('%s exists and renders an accessible loading state', (rel) => {
    expect(exists(rel)).toBe(true);
    expect(read(rel)).toContain('role="status"');
  });
});

describe('Section 10 — trust facts stay fresh', () => {
  it('press page: 10 products in the catalog (sample-laptop excluded)', () => {
    const press = read('app/press/page.tsx');
    expect(press).toContain("['Products in the catalog', '10']");
  });

  it('press page: test-count line is dated and formatted, never a bare number', () => {
    const press = read('app/press/page.tsx');
    // Section 16, item 7: the counts live in
    // lib/generated/press-counts.json and the page renders them — the
    // source holds a template, never a hardcoded literal line, so
    // assert the mechanism + the rendered line (the old regex matched
    // a literal that no longer exists in the source).
    expect(press).toContain("import pressCounts from '@/lib/generated/press-counts.json'");
    expect(press).toContain('pressCounts.tests');
    expect(press).toContain('pressCounts.files');
    expect(press).toContain('pressCounts.date');
    expect(press).not.toMatch(/\d[\d,]* passing \(\d+ test files,/);
    // Render the line exactly the way the page does and assert the
    // shape + a real calendar date, not one frozen day, or the next
    // re-lock breaks this test again.
    const line = `${pressCounts.tests.toLocaleString('en-US')} passing (${pressCounts.files} test files, full run ${formatPressCountsDate(pressCounts.date)})`;
    expect(line).toMatch(/\d{1,3}(,\d{3})* passing \(\d+ test files, full run \d{1,2} [A-Z][a-z]+ \d{4}\)/);
    expect(pressCounts.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pressCounts.date <= new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it('about + editorial policy say 20 languages; llms.txt lists 20 languages and 61 regions', () => {
    expect(read('app/about/page.tsx')).toContain('20');
    expect(read('app/editorial-policy/page.tsx')).toContain('20');
    const llms = read('public/llms.txt');
    expect(llms).toMatch(/20 languages/i);
    expect(llms).toMatch(/61 regions/i);
  });

  it('changelog count is derived, not hardcoded', () => {
    const changelog = read('app/changelog/page.tsx');
    expect(changelog).toContain('RELEASES.length + PENDING_SYNC_RELEASES.length');
    expect(changelog).not.toContain('55 releases');
  });

  it('all 12 trust pages carry metadata with a canonical URL', () => {
    const pages = [
      'app/about/page.tsx',
      'app/help/page.tsx',
      'app/support/page.tsx',
      'app/contact/page.tsx',
      'app/press/page.tsx',
      'app/methodology/page.tsx',
      'app/editorial-policy/page.tsx',
      'app/terms/page.tsx',
      'app/privacy/page.tsx',
      'app/cookies/page.tsx',
      'app/changelog/page.tsx',
      'app/docs/page.tsx',
    ];
    for (const rel of pages) {
      const src = read(rel);
      expect(src).toContain('export const metadata');
      expect(src).toContain('alternates');
      expect(src).toContain('canonical');
    }
  });

  it('terms + privacy still carry their DRAFT-for-owner-review status', () => {
    expect(read('app/terms/page.tsx')).toMatch(/DRAFT/i);
    expect(read('app/privacy/page.tsx')).toMatch(/DRAFT/i);
  });
});

describe('Section 10 — standalone FAQ route', () => {
  it('/faq exists and shares the single FAQ source with /help', () => {
    expect(exists('app/faq/page.tsx')).toBe(true);
    expect(exists('app/help/faqs.ts')).toBe(true);
    expect(read('app/faq/page.tsx')).toContain("from '../help/faqs'");
    expect(read('app/help/page.tsx')).toContain("from './faqs'");
    expect(read('app/faq/page.tsx')).toContain('FAQPage');
  });
});

describe('Section 10 — shared ProductCard on taxonomy pages', () => {
  it.each(['app/brands/[slug]/page.tsx', 'app/categories/[slug]/page.tsx'])(
    '%s renders products through the shared ProductCard',
    (rel) => {
      const src = read(rel);
      expect(src).toContain("import { ProductCard } from '@/components/products/product-card'");
      expect(src).toContain('<ProductCard');
    },
  );
});

describe('Section 10 — design system + accessibility', () => {
  it('Button default + icon sizes are 44px tall', () => {
    const button = read('components/ui/button.tsx');
    expect(button).toContain("default: 'h-11 px-4 py-2'");
    expect(button).toContain("icon: 'h-11 w-11'");
  });

  it('layout has a skip link targeting #main-content', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toContain('Skip to content');
    expect(layout).toContain('href="#main-content"');
    expect(layout).toContain('id="main-content"');
  });

  it('global :focus-visible style exists', () => {
    expect(read('app/globals.css')).toContain(':focus-visible');
  });

  it('price prediction badge is not colour-only (icon + text + status role)', () => {
    const badge = read('components/products/price-prediction-badge.tsx');
    expect(badge).toContain('role="status"');
    expect(badge).toMatch(/aria-label=\{`Price prediction:/);
  });
});

describe('Section 10 — AI-tools honesty', () => {
  const toolPages = [
    'best-time-calendar',
    'eco-coach',
    'expense-tracker',
    'future-you-planner',
    'list-optimizer',
    'monthly-planner',
    'price-drop-digest',
    'savings-dashboard',
    'smart-home-agent',
    'subscription-manager',
    'trade-in-finder',
    'warranty-claim-helper',
  ];

  it.each(toolPages)('%s discloses deterministic rules, no LLM', (tool) => {
    expect(read(`app/tools/${tool}/page.tsx`)).toContain('no LLM');
  });

  it('list-optimizer no longer claims optimizing works without saving', () => {
    const page = read('app/tools/list-optimizer/page.tsx');
    expect(page).not.toContain('works without saving');
    expect(page).not.toContain('Saving the list is optional');
  });

  it('expense-tracker + subscription-manager show a sign-in prompt on 401', () => {
    expect(read('app/tools/expense-tracker/page.tsx')).toContain('Sign in to see your expenses');
    expect(read('app/tools/subscription-manager/page.tsx')).toContain('Sign in to manage your subscriptions');
  });

  it('qa-section no longer carries the stale "NOT yet mounted" comment', () => {
    expect(read('components/products/qa-section.tsx')).not.toContain('NOT yet mounted');
  });
});
