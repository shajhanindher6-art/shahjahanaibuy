/**
 * Master Tool Integration, Stage 3 — cross-tool wiring tests.
 *
 * Covers (S3-6):
 * - cross-tool transfer: every link builder's URL parses back to
 *   the same product via parseToolParams (canonical ?product= and
 *   the T1 ?current=/T10 ?device= dialects, T2 persona/budget,
 *   T3 status, /compare UUIDs);
 * - relatedToolLinks: only existing routes, the product carried
 *   in the destination's own dialect, never an empty ?product=;
 * - cached-fetch wiring: the tool pages' fetch path (the Stage-1
 *   cached variants) hits the cache on the second call — the
 *   underlying getProducts / getPriceHistory /
 *   getMerchantProducts are counting stubs (mocked at the service
 *   level, as Stage 1's tests do with a fake client); the real
 *   cached wrappers (swrGet) stay in the path, so the count
 *   proves the second identical call is served from cache;
 *   PLUS source-level proof that the 9 product-fetching tool
 *   pages actually call those cached variants and never call the
 *   uncached getProducts / getPriceHistory / getMerchantProducts
 *   directly (T3 has no product fetch and is asserted as such);
 * - S3-1/S3-2/S3-3 mounts: RelatedTools on all 10 tool pages,
 *   SaveCalculationButton on the 8 tools with a replayable
 *   result (not T3/T7), ProductTools on the product page and
 *   /compare, and buildSavedCalculationUrl re-open URLs for the
 *   8 tools (bare route only for T3/T7).
 *
 * The in-memory SWR cache (lib/cache) is per worker, so every
 * cached-fetch test uses UNIQUE options/ids — otherwise an
 * earlier test's warm entry would mask the first call's count.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseToolParams,
  buildToolUrl,
  getCachedProducts,
  getToolPriceHistory,
  getToolMerchantProducts,
  compareLink,
  compatibilityLink,
  energyCostLink,
  upgradeAdvisorLink,
  personaFitLink,
  priceMatchLink,
  ownItLink,
  dealStackerLink,
  negotiationLink,
  repairabilityLink,
  refurbishedLink,
  relatedToolLinks,
  TOOL_ROUTES,
} from '@/services/tool-integration';
import {
  buildCalculationShareUrl,
  isSavedCalculationTool,
} from '@/lib/saved-calculations';
import { buildSavedCalculationUrl } from '@/services/saved-calculations';

// --- Service-level counting stubs.
// getCachedProducts wraps services/products#getProducts (a
// cross-module import, so vi.mock on that module counts the
// delegate). getToolPriceHistory / getToolMerchantProducts
// delegate to getCachedPriceHistory / getCachedMerchantProducts,
// whose fetchers call the uncached function INSIDE the same
// module — a vi.mock on that module cannot intercept an
// intra-module call. Those two are therefore counted with a
// minimal fake Supabase client (thenable query builder, in the
// style of Stage 1's fake client): the real cached wrappers stay
// in the path and the count proves the second identical call is
// served from the SWR cache, not the DB.
const calls = { products: 0, from: {} as Record<string, number> };

vi.mock('@/services/products', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/services/products')>();
  return {
    ...actual,
    getProducts: (async () => {
      calls.products += 1;
      return { products: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
    }) as unknown as typeof actual.getProducts,
  };
});

/** Minimal thenable query builder: select/eq/is/order/limit chain, awaitable. */
class FakeQuery {
  constructor(private readonly table: string) {}
  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  is(): this {
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  then(
    onfulfilled?: (value: { data: unknown[]; error: null }) => unknown,
    onrejected?: (reason: unknown) => unknown
  ): Promise<unknown> {
    calls.from[this.table] = (calls.from[this.table] ?? 0) + 1;
    return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
  }
}

// The stubs ignore the client entirely — a dummy object is enough
// for getCachedProducts; the fake client below serves the
// price-history / merchant-products paths.
const fakeClient = {
  from: (table: string) => new FakeQuery(table),
} as never;

function readRepo(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function toolPage(tool: string): string {
  return readRepo(`app/tools/${tool}/page.tsx`);
}

/** Query string of a built href, parsed the way a page would. */
function parsed(href: string) {
  const qs = href.includes('?') ? href.split('?')[1] : '';
  return parseToolParams(new URLSearchParams(qs));
}

const SLUG = 'macbook-air-13';
const OTHER_SLUG = 'sony-wh-1000xm5';

describe('cross-tool transfer — a built link parses back to the same product', () => {
  it.each([
    ['energy-cost', energyCostLink(SLUG)],
    ['deal-stacker', dealStackerLink(SLUG)],
    ['negotiation-coach', negotiationLink(SLUG)],
    ['repairability', repairabilityLink(SLUG)],
    ['refurbished-checklist', refurbishedLink(SLUG)],
    ['own-it-check', ownItLink(SLUG)],
  ])('%s: ?product=<slug> round-trips via parseToolParams', (_tool, href) => {
    expect(parsed(href).productSlug).toBe(SLUG);
  });

  it('T1 upgrade-advisor: ?current=&successor= round-trips', () => {
    const href = upgradeAdvisorLink(SLUG, OTHER_SLUG);
    const sel = parsed(href);
    expect(sel.currentSlug).toBe(SLUG);
    expect(sel.successorSlug).toBe(OTHER_SLUG);
    expect(sel.productSlug).toBe(SLUG);
  });

  it('T10 compatibility-checker: ?device=&accessory= round-trips', () => {
    const href = compatibilityLink(SLUG, OTHER_SLUG);
    const sel = parsed(href);
    expect(sel.deviceSlug).toBe(SLUG);
    expect(sel.accessorySlug).toBe(OTHER_SLUG);
    expect(sel.productSlug).toBe(SLUG);
  });

  it('T2 persona-fit carries persona/budget (no product param, by design)', () => {
    const sel = parsed(personaFitLink('student', '1000'));
    expect(sel.persona).toBe('student');
    expect(sel.budget).toBe('1000');
    expect(sel.productSlug).toBeNull();
  });

  it('T3 price-match carries only the status filter', () => {
    expect(parsed(priceMatchLink('yes')).status).toBe('yes');
    expect(parsed(priceMatchLink('yes')).productSlug).toBeNull();
  });

  it('T4 own-it-check carries typed name/brand/gtin alongside the product', () => {
    const sel = parsed(
      ownItLink(SLUG, { name: 'MacBook Air', brand: 'Apple', gtin: '0194253161783' })
    );
    expect(sel.productSlug).toBe(SLUG);
    expect(sel.name).toBe('MacBook Air');
    expect(sel.brand).toBe('Apple');
    expect(sel.gtin).toBe('0194253161783');
  });

  it('/compare: ?products=<uuid>,<uuid> round-trips as ids', () => {
    const ids = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
    expect(parsed(compareLink(ids)).compareProductIds).toEqual(ids);
    expect(compareLink([])).toBe('/compare');
  });

  it('buildToolUrl is the inverse of parseToolParams for every dialect', () => {
    const cases: Array<[string, Record<string, string | null>]> = [
      ['/tools/energy-cost', { productSlug: SLUG }],
      ['/tools/deal-stacker', { productSlug: SLUG }],
      ['/tools/upgrade-advisor', { currentSlug: SLUG, successorSlug: OTHER_SLUG }],
      ['/tools/compatibility-checker', { deviceSlug: SLUG, accessorySlug: OTHER_SLUG }],
      ['/tools/own-it-check', { productSlug: SLUG, name: 'MacBook Air' }],
      ['/tools/persona-fit', { persona: 'student', budget: '1000' }],
      ['/tools/price-match', { status: 'yes' }],
      ['/tools/negotiation-coach', { productSlug: SLUG, target: '899' }],
      ['/tools/energy-cost', { productSlug: SLUG, watts: '100' }],
    ];
    for (const [route, params] of cases) {
      const href = buildToolUrl(route, params);
      const sel = parsed(href);
      for (const [key, value] of Object.entries(params)) {
        expect((sel as unknown as Record<string, unknown>)[key]).toBe(value);
      }
    }
  });
});

describe('relatedToolLinks — only existing routes, product carried, never empty', () => {
  const KNOWN_ROUTES = new Set([
    ...Object.values(TOOL_ROUTES),
    '/tools/budget-finder',
    '/tools/coupons-cashback',
    '/tools/price-history',
  ]);

  it.each(Object.keys(TOOL_ROUTES).filter((t) => t !== 'compare'))(
    '%s: every link points at an existing route and carries the product in its own dialect',
    (tool) => {
      const links = relatedToolLinks(tool, SLUG);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        const path = link.href.split('?')[0];
        expect(KNOWN_ROUTES.has(path)).toBe(true);
        expect(link.href).not.toContain('product=&');
        expect(link.href).not.toMatch(/\?product=$/);
        expect(link.href).not.toContain('device=&');
        expect(link.href).not.toContain('current=&');
      }
      // At least one link carries the product (in some dialect);
      // T2/T3 destinations never take ?product=, so the check is
      // dialect-aware, not a blanket "every href has product=".
      const carries = links.some((l) =>
        l.href.includes(`product=${SLUG}`) ||
        l.href.includes(`device=${SLUG}`) ||
        l.href.includes(`current=${SLUG}`)
      );
      expect(carries).toBe(true);
    }
  );

  it('with no product every link is a bare route or a product-less dialect link', () => {
    for (const tool of Object.keys(TOOL_ROUTES).filter((t) => t !== 'compare')) {
      for (const link of relatedToolLinks(tool, null)) {
        expect(link.href).not.toContain('product=');
        expect(link.href).not.toContain('device=');
        expect(link.href).not.toContain('current=');
      }
    }
  });

  it('returns no links for an unknown tool', () => {
    expect(relatedToolLinks('not-a-tool', SLUG)).toEqual([]);
  });
});

describe('cached-fetch wiring — second call hits the cache, not the delegate', () => {
  beforeEach(() => {
    calls.products = 0;
    calls.from = {};
  });

  it('getCachedProducts: two identical list calls call getProducts once', async () => {
    const options = { page: 1, pageSize: 11 };
    await getCachedProducts(fakeClient, options);
    await getCachedProducts(fakeClient, options);
    expect(calls.products).toBe(1);
  });

  it('getCachedProducts: different options are a different cache entry', async () => {
    await getCachedProducts(fakeClient, { page: 1, pageSize: 12 });
    await getCachedProducts(fakeClient, { page: 1, pageSize: 13 });
    expect(calls.products).toBe(2);
  });

  it('getToolPriceHistory: two identical calls query price_history once', async () => {
    const id = 'wiring-price-history-product';
    await getToolPriceHistory(fakeClient, id, { limit: 500 });
    await getToolPriceHistory(fakeClient, id, { limit: 500 });
    expect(calls.from['price_history']).toBe(1);
  });

  it('getToolMerchantProducts: two identical calls query merchant_products once', async () => {
    const id = 'wiring-merchant-products-product';
    await getToolMerchantProducts(fakeClient, id);
    await getToolMerchantProducts(fakeClient, id);
    expect(calls.from['merchant_products']).toBe(1);
  });
});

describe('cached-fetch wiring — the tool pages actually call the cached variants', () => {
  const PRODUCT_TOOLS = [
    'upgrade-advisor',
    'persona-fit',
    'own-it-check',
    'energy-cost',
    'negotiation-coach',
    'repairability',
    'deal-stacker',
    'refurbished-checklist',
    'compatibility-checker',
  ] as const;

  it.each(PRODUCT_TOOLS)(
    '%s calls getCachedProducts (never uncached getProducts)',
    (tool) => {
      const page = toolPage(tool);
      expect(page).toContain("from '@/services/tool-integration'");
      expect(page).toContain('getCachedProducts');
      expect(page).not.toContain('getProducts(supabase');
      expect(page).not.toContain('await getProducts(');
    }
  );

  it('T1/T6/T8 call getToolPriceHistory (never uncached getPriceHistory)', () => {
    for (const tool of ['upgrade-advisor', 'negotiation-coach', 'deal-stacker'] as const) {
      const page = toolPage(tool);
      expect(page).toContain('getToolPriceHistory');
      expect(page).not.toContain('getPriceHistory(supabase');
    }
  });

  it('T8/T9 call getToolMerchantProducts (never uncached getMerchantProducts)', () => {
    for (const tool of ['deal-stacker', 'refurbished-checklist'] as const) {
      const page = toolPage(tool);
      expect(page).toContain('getToolMerchantProducts');
      expect(page).not.toContain('getMerchantProducts(supabase');
    }
  });

  it('T3 price-match has no product fetch at all', () => {
    const page = toolPage('price-match');
    expect(page).not.toContain('getProducts');
    expect(page).not.toContain('getCachedProducts');
  });
});

describe('S3-1 — RelatedTools block on all 10 tool pages', () => {
  const ALL_TEN = [
    'upgrade-advisor',
    'persona-fit',
    'price-match',
    'own-it-check',
    'energy-cost',
    'negotiation-coach',
    'repairability',
    'deal-stacker',
    'refurbished-checklist',
    'compatibility-checker',
  ] as const;

  it.each(ALL_TEN)('%s mounts the shared RelatedTools block', (tool) => {
    const page = toolPage(tool);
    expect(page).toContain(
      "import { RelatedTools } from '@/components/tools/related-tools'"
    );
    expect(page).toContain('<RelatedTools');
    expect(page).toContain(`tool="${tool}"`);
  });

  it('the block is one shared component, not 10 hand-rolled blocks', () => {
    const component = readRepo('components/tools/related-tools.tsx');
    expect(component).toContain('relatedToolLinks');
    expect(component).toContain('Related tools');
  });
});

describe('S3-2 — ProductTools on the product page and /compare', () => {
  it('product detail page mounts ProductTools with the product slug + id', () => {
    const page = readRepo('app/products/[slug]/page.tsx');
    expect(page).toContain(
      "import { ProductTools } from '@/components/tools/product-tools'"
    );
    expect(page).toContain('<ProductTools');
    expect(page).toContain('slug: seo.slug');
    expect(page).toContain('id: seo.id');
  });

  it('/compare mounts ProductTools with the compared products', () => {
    const page = readRepo('app/compare/page.tsx');
    expect(page).toContain(
      "import { ProductTools } from '@/components/tools/product-tools'"
    );
    expect(page).toContain('<ProductTools');
    expect(page).toContain('comparison.products.map');
    expect(page).toContain('id: p.productId');
  });

  it('ProductTools links carry the product in each destination dialect', () => {
    const component = readRepo('components/tools/product-tools.tsx');
    expect(component).toContain('upgradeAdvisorLink');
    expect(component).toContain('compatibilityLink');
    expect(component).toContain('compareLink');
    expect(component).toContain('Tools for this product');
  });
});

describe('S3-3 — re-open-my-result URLs for the 8 tools with a calculable result', () => {
  const REPLAYABLE = [
    'upgrade-advisor',
    'persona-fit',
    'own-it-check',
    'energy-cost',
    'negotiation-coach',
    'deal-stacker',
    'refurbished-checklist',
    'compatibility-checker',
  ] as const;

  it.each(REPLAYABLE)('%s is a saved-calculation tool', (tool) => {
    expect(isSavedCalculationTool(tool)).toBe(true);
  });

  it('each replayable tool builds a re-open URL carrying its inputs', () => {
    expect(
      buildSavedCalculationUrl('upgrade-advisor', {
        current: SLUG,
        successor: OTHER_SLUG,
        year: 2021,
        price: 999,
      })
    ).toContain('/tools/upgrade-advisor?');
    expect(
      buildSavedCalculationUrl('upgrade-advisor', {
        current: SLUG,
        successor: OTHER_SLUG,
        year: 2021,
        price: 999,
      })
    ).toContain(`current=${SLUG}`);
    expect(buildSavedCalculationUrl('persona-fit', { persona: 'student', budget: 1000 })).toContain(
      'persona=student'
    );
    expect(buildSavedCalculationUrl('energy-cost', { watts: 100, hours: 8, tariff: 0.15 })).toContain(
      'watts=100'
    );
    expect(
      buildSavedCalculationUrl('negotiation-coach', { product: SLUG, target: 899 })
    ).toContain(`product=${SLUG}`);
    expect(buildSavedCalculationUrl('deal-stacker', { product: SLUG })).toContain(
      `product=${SLUG}`
    );
    expect(buildSavedCalculationUrl('refurbished-checklist', { product: SLUG })).toContain(
      `product=${SLUG}`
    );
    expect(
      buildSavedCalculationUrl('compatibility-checker', { device: SLUG, accessory: OTHER_SLUG })
    ).toContain(`device=${SLUG}`);
    // The share URL replays: its query parses back to the same inputs.
    const url = buildCalculationShareUrl('energy-cost', { watts: 100, hours: 8, tariff: 0.15 });
    expect(url).not.toBeNull();
    expect(parsed(url as string).watts).toBe('100');
  });

  it('price-match and repairability have no saved state — bare route only', () => {
    // T3 is a filter-only directory; T7 is a listing + explainer
    // with no params at all. Neither is a saved-calculation tool,
    // so re-opening is just the tool route, with no params carried.
    expect(isSavedCalculationTool('price-match')).toBe(false);
    expect(isSavedCalculationTool('repairability')).toBe(false);
    expect(buildSavedCalculationUrl('price-match', { status: 'yes' })).toBe('/tools/price-match');
    expect(buildSavedCalculationUrl('repairability', {})).toBe('/tools/repairability');
  });

  it.each(REPLAYABLE)('%s mounts SaveCalculationButton with its own tool slug', (tool) => {
    const page = toolPage(tool);
    expect(page).toContain(
      "import { SaveCalculationButton } from '@/components/tools/save-calculation-button'"
    );
    expect(page).toContain('<SaveCalculationButton');
    expect(page).toContain(`tool="${tool}"`);
  });

  it('price-match and repairability mount no save button (nothing to save)', () => {
    expect(toolPage('price-match')).not.toContain('SaveCalculationButton');
    expect(toolPage('repairability')).not.toContain('SaveCalculationButton');
  });
});

describe('S3-4 — stored preferences wire into persona-fit (URL wins)', () => {
  it('persona-fit reads user_preferences and prefers the URL budget', () => {
    const page = toolPage('persona-fit');
    expect(page).toContain(
      "import { getUserPreferences } from '@/services/user-preferences'"
    );
    expect(page).toContain('storedBudgetUsd');
    expect(page).toContain('effectiveBudgetUsd');
    expect(page).toContain('hasUrlBudget');
    // Signed-out visitors see no change: prefs load only for a user.
    expect(page).toContain('supabase.auth.getUser()');
  });
});
