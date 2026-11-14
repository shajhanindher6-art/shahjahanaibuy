/**
 * Master Tool Integration, Stage 6 (S6-1) — page/render tests for the
 * 10 tools (0 page tests existed before this file).
 *
 * Each tool page is rendered for real — the async server component
 * is awaited and passed through react-dom/server
 * renderToStaticMarkup (node env, `.test.ts` with no JSX), the same
 * pattern as tests/section21-ingestion-failures.test.ts and
 * tests/section18-viewport-meta-render.test.ts.
 *
 * Supabase reads are mocked at the `@/lib/supabase/server` boundary
 * (the pattern of tests/section15-digests.test.ts): a small in-memory
 * query engine (select/eq/neq/in/is/or/order/limit/range/
 * maybeSingle/single, thenable, with `count`) in the style of the
 * Stage-1 fake client in tests/tool-integration.test.ts, seeded per
 * test with two fixture catalog rows — or with an empty catalog for
 * the honest-empty-state tests. The fixture rows are test data in a
 * mocked DB, never a production claim: prices are the fixture's own
 * recorded values, GTINs/specs/images stay null exactly as the live
 * catalog has them.
 *
 * Boundaries stubbed so the render covers the page, not its shell:
 * - `next/link` → a plain <a> (tests/guided-journey.test.ts pattern);
 * - `SiteHeader` → null (it needs router + region + auth context);
 * - `@/features/auth` useAuth → signed-out ({ user: null }), so the
 *   pages render the signed-out path (account lists are not checked
 *   for a visitor — T4 asserts exactly that copy).
 *
 * The in-memory SWR cache (lib/cache) is per worker, and every tool
 * page fetches the list with the same { page: 1, pageSize: 100 }
 * options — so beforeEach invalidates the whole `smartbuy:` prefix,
 * otherwise one test's warm entry would mask the next test's seed.
 *
 * Scope, per the Stage 6 brief: rendering + links + empty states
 * only. Engine math is NOT re-tested here (each lib has its own
 * tests); where a rendered figure is asserted it is the fixture's
 * own recorded value flowing through the page, not a recomputation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { invalidateCache } from '@/lib/cache';

type Row = Record<string, unknown>;

// --- Fake Supabase client (hoisted state, section15-digests pattern) ---
const fakeDb = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  authedUserId: null as string | null,
}));

function seedTable(name: string, rows: Row[] = []): void {
  fakeDb.tables[name] = rows.map((r) => ({ ...r }));
}

function resetFakeDb(): void {
  fakeDb.tables = {};
  fakeDb.authedUserId = null;
}

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private wantSingle = false;
  private wantMaybeSingle = false;

  constructor(private readonly table: string) {}

  // The second arg ({ count: 'exact' }) is accepted and ignored —
  // the count is always the filtered row count, as in PostgREST.
  select(): this {
    return this;
  }
  eq(col: string, value: unknown): this {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  neq(col: string, value: unknown): this {
    this.filters.push((r) => r[col] !== value);
    return this;
  }
  in(col: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  is(col: string, value: unknown): this {
    this.filters.push((r) => (value === null ? r[col] == null : r[col] === value));
    return this;
  }
  // No page test uses ?search=; the OR leg is a no-op (accept all).
  or(): this {
    return this;
  }
  order(col: string, opts: { ascending: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts.ascending;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  single(): this {
    this.wantSingle = true;
    return this;
  }
  maybeSingle(): this {
    this.wantMaybeSingle = true;
    return this;
  }

  then<TResult1 = { data: unknown; error: unknown; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: unknown; count?: number }> {
    const table = fakeDb.tables[this.table];
    if (!table) {
      return { data: null, error: { code: 'PGRST205', message: `Could not find the table '${this.table}'` } };
    }
    let rows = table.filter((r) => this.filters.every((f) => f(r)));
    const count = rows.length;
    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      rows = [...rows].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (typeof av === 'number' && typeof bv === 'number') {
          return asc ? av - bv : bv - av;
        }
        const as = String(av ?? '');
        const bs = String(bv ?? '');
        return asc ? (as < bs ? -1 : as > bs ? 1 : 0) : as > bs ? -1 : as < bs ? 1 : 0;
      });
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.wantMaybeSingle) return { data: rows[0] ?? null, error: null, count };
    if (this.wantSingle) {
      return rows.length === 0
        ? { data: null, error: { code: 'PGRST116', message: '0 rows' }, count }
        : { data: rows[0], error: null, count };
    }
    return { data: rows, error: null, count };
  }
}

function makeFakeClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: fakeDb.authedUserId ? { id: fakeDb.authedUserId } : null },
        error: null,
      }),
    },
    from: (table: string) => new FakeQuery(table),
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => makeFakeClient(),
}));

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

// The header needs router + region + auth context; the tests cover
// the tool pages, not the shell.
vi.mock('@/components/layout/site-header', () => ({
  SiteHeader: () => null,
}));

// The footer needs region context (useRegion); same reasoning.
vi.mock('@/components/layout/site-footer', () => ({
  SiteFooter: () => null,
}));

// Signed-out visitor: account lists are never checked (T4 asserts
// the copy that says so). Everything else in the module stays real.
vi.mock('@/features/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/auth')>();
  return {
    ...actual,
    useAuth: () => ({ user: null, isLoading: false }),
  };
});

// Imported after the mocks so the pages use the fakes.
import React from 'react';
import UpgradeAdvisorPage from '@/app/tools/upgrade-advisor/page';
import PersonaFitPage from '@/app/tools/persona-fit/page';
import PriceMatchPage from '@/app/tools/price-match/page';
import OwnItCheckPage from '@/app/tools/own-it-check/page';
import EnergyCostPage from '@/app/tools/energy-cost/page';
import NegotiationCoachPage from '@/app/tools/negotiation-coach/page';
import RepairabilityPage from '@/app/tools/repairability/page';
import DealStackerPage from '@/app/tools/deal-stacker/page';
import RefurbishedChecklistPage from '@/app/tools/refurbished-checklist/page';
import CompatibilityCheckerPage from '@/app/tools/compatibility-checker/page';

// --- Fixture catalog -------------------------------------------------------
// Two genuinely different products: different brand AND category, so
// T10 grades them "Unknown" (never "Exact") and T2's Work persona
// matches the laptop (Laptops is a Work category) but not the
// headphones. The laptop's recorded history falls 500 → 450 over
// 13 days, so T1 can project resale and T8 has a recorded drop;
// the headphones have no history at all (honest no-data case).
// GTIN / specs / images are null — the fixture mirrors the live
// catalog's gaps instead of inventing data for them.

function productRow(overrides: Row = {}): Row {
  return {
    id: 'prod-laptop',
    name: 'Test Laptop',
    slug: 'test-laptop',
    description: 'A test product',
    brand: 'TestBrand',
    category: 'Laptops',
    image_url: null,
    gtin: null,
    model_number: null,
    confidence_score: 80,
    data_freshness: '2026-11-02T00:00:00Z',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    status: 'published',
    price_verification_status: 'unverified',
    price_verified_at: null,
    repairability_score: null,
    spare_parts_years: null,
    local_repair_risk_level: null,
    deleted_at: null,
    ...overrides,
  };
}

const LAPTOP = productRow();

const HEADPHONES = productRow({
  id: 'prod-headphones',
  name: 'Test Headphones',
  slug: 'test-headphones',
  brand: 'OtherBrand',
  category: 'Headphones',
  created_at: '2026-11-01T00:00:00Z',
});

function merchantProductRow(overrides: Row = {}): Row {
  return {
    id: 'mp-laptop',
    product_id: 'prod-laptop',
    merchant_id: 'm-1',
    merchant_sku: null,
    price: 450,
    compare_at_price: null,
    currency_id: null,
    availability: 'in_stock',
    url: 'https://example.com/test-laptop',
    shipping_cost: null,
    shipping_days: null,
    in_stock: true,
    stock_quantity: null,
    last_synced_at: '2026-11-02T00:00:00Z',
    price_verification_status: 'unverified',
    price_source: 'manual',
    price_verified_at: null,
    deleted_at: null,
    ...overrides,
  };
}

function historyRow(overrides: Row = {}): Row {
  return {
    id: 'h-laptop-2',
    product_id: 'prod-laptop',
    retailer_id: 'ret-1',
    price: 450,
    currency: 'USD',
    availability: 'in_stock',
    url: null,
    recorded_at: '2026-11-02T00:00:00Z',
    source: null,
    observed_at: null,
    suspicious_change: null,
    verified: null,
    currency_assumed: null,
    ...overrides,
  };
}

function seedCatalog(): void {
  seedTable('products', [LAPTOP, HEADPHONES]);
  seedTable('merchant_products', [
    merchantProductRow(),
    merchantProductRow({
      id: 'mp-headphones',
      product_id: 'prod-headphones',
      price: 90,
      url: 'https://example.com/test-headphones',
    }),
  ]);
  seedTable('price_history', [
    historyRow(),
    historyRow({
      id: 'h-laptop-1',
      price: 500,
      recorded_at: '2026-10-20T00:00:00Z',
    }),
  ]);
  seedTable('merchants', [
    {
      id: 'm-1',
      name: 'Test Merchant',
      slug: 'test-merchant',
      logo_url: null,
      website_url: 'https://example.com',
      country_id: null,
      currency_id: null,
      contact_email: null,
      phone: null,
      status: 'active',
      commission_rate: null,
      active: true,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
      deleted_at: null,
    },
  ]);
  seedTable('coupons', []);
  seedTable('cashback_offers', []);
  seedTable('product_attributes', []);
}

function seedEmptyCatalog(): void {
  seedTable('products', []);
  seedTable('merchant_products', []);
  seedTable('price_history', []);
  seedTable('merchants', []);
  seedTable('coupons', []);
  seedTable('cashback_offers', []);
  seedTable('product_attributes', []);
}

beforeEach(() => {
  resetFakeDb();
  // Every page lists with the same options, so one warm entry would
  // serve every later render — clear the whole SWR namespace.
  invalidateCache('smartbuy:');
});

/** The shared RelatedTools block, sliced out of the rendered HTML. */
function relatedToolsSection(html: string): string {
  const start = html.indexOf('aria-labelledby="related-tools"');
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf('</section>', start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

/** Count occurrences of a literal substring. */
function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// T1 — Upgrade Advisor
// ---------------------------------------------------------------------------

describe('T1 upgrade-advisor page', () => {
  it('renders the heading + verdict with a product present (no trade-in quote)', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await UpgradeAdvisorPage({
        searchParams: {
          current: 'test-laptop',
          successor: 'test-headphones',
          year: '2021',
          price: '1000',
        },
      })
    );
    expect(html).toContain('AI Upgrade Advisor');
    expect(html).toContain('Verdict');
    expect(html).toContain('Cost per year');
    // The successor is named in the verdict table.
    expect(html).toContain('Successor price (Test Headphones)');
    // The successor has no recorded history — the page says so.
    expect(html).toContain('No recorded price');
    // Resale is a labelled projection off the laptop's own history:
    // a 10% fall over 13 days, explicitly not a quote or guarantee.
    expect(html).toContain('Resale projection');
    expect(html).toContain(
      'Recorded price fell 10% from $500.00 to $450.00 over 13 days (2 recorded points)'
    );
    expect(html).toContain('not a resale quote or a guarantee');
  });

  it('renders the honest empty state when the catalog is empty', async () => {
    seedEmptyCatalog();
    const html = renderToStaticMarkup(
      await UpgradeAdvisorPage({ searchParams: {} })
    );
    expect(html).toContain('AI Upgrade Advisor');
    expect(html).toContain('No catalog to compare against');
    expect(html).toContain('there is no successor to compare your device with');
  });

  it('RelatedTools links carry the current product (?current= dialect)', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await UpgradeAdvisorPage({
        searchParams: { current: 'test-laptop' },
      })
    );
    const section = relatedToolsSection(html);
    expect(section).toContain('Related tools');
    expect(section).toContain('product=test-laptop');
    expect(section).not.toContain('product=&');
    expect(section).not.toContain('product=$');
  });
});

// ---------------------------------------------------------------------------
// T2 — Persona Fit Finder
// ---------------------------------------------------------------------------

describe('T2 persona-fit page', () => {
  it('renders the matched product with a recorded price + "Not recorded yet" specs', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await PersonaFitPage({ searchParams: { persona: 'home-office', budget: '500' } })
    );
    expect(html).toContain('AI Persona Fit Finder');
    expect(html).toContain('Home Office picks under $500.00');
    expect(html).toContain('Test Laptop');
    // The fixture's recorded merchant price, under the $500 budget.
    expect(html).toContain('$450.00');
    // No specs are recorded for the fixture — the page says so.
    expect(html).toContain('Not recorded yet');
    // The headphones are not a Work-category fit, so they are absent.
    expect(html).not.toContain('Test Headphones');
  });

  it('renders the honest empty state when the catalog is empty', async () => {
    seedEmptyCatalog();
    const html = renderToStaticMarkup(
      await PersonaFitPage({ searchParams: { persona: 'home-office', budget: '500' } })
    );
    expect(html).toContain('AI Persona Fit Finder');
    expect(html).toContain('No fit found');
    expect(html).toContain('No Home Office fit under $500.00');
  });

  it('RelatedTools block is present and its links are bare with no product selected', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await PersonaFitPage({ searchParams: { persona: 'work', budget: '500' } })
    );
    const section = relatedToolsSection(html);
    expect(section).toContain('Related tools');
    // No product param exists on this page, so no link invents one.
    expect(section).not.toContain('product=');
    expect(section).toContain('/tools/compatibility-checker');
  });
});

// ---------------------------------------------------------------------------
// T3 — Price-Match Finder (no Supabase read at all — static directory)
// ---------------------------------------------------------------------------

describe('T3 price-match page', () => {
  it('renders the heading + verified policies + "Not recorded yet" stores', async () => {
    const html = renderToStaticMarkup(
      await PriceMatchPage({ searchParams: {} })
    );
    expect(html).toContain('AI Price-Match Finder');
    expect(html).toContain('Verified policies');
    expect(html).toContain('Best Buy');
    // The 77 unrecorded stores read "Not recorded yet" — never a
    // promised match.
    expect(html).toContain('Not recorded yet');
    expect(countOf(html, 'Not recorded yet')).toBeGreaterThan(10);
    // The disclaimer is honest about the limit, not a promise.
    expect(html).toContain('never quotes a matched price');
  });

  it('the ?status=not-recorded filter still renders the honest empty state', async () => {
    const html = renderToStaticMarkup(
      await PriceMatchPage({ searchParams: { status: 'not-recorded' } })
    );
    expect(html).toContain('AI Price-Match Finder');
    expect(html).toContain('Verified policies');
    expect(html).toContain('Not recorded yet');
  });

  it('RelatedTools block is present and its links are bare with no product selected', async () => {
    const html = renderToStaticMarkup(
      await PriceMatchPage({ searchParams: { status: 'offers' } })
    );
    const section = relatedToolsSection(html);
    expect(section).toContain('Related tools');
    expect(section).not.toContain('product=');
    expect(section).toContain('/tools/deal-stacker');
  });
});

// ---------------------------------------------------------------------------
// T4 — Already-Own-It Guard
// ---------------------------------------------------------------------------

describe('T4 own-it-check page', () => {
  it('renders the heading + the picked product + the signed-out copy', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await OwnItCheckPage({ searchParams: { product: 'test-laptop' } })
    );
    expect(html).toContain('Already-Own-It Guard');
    expect(html).toContain('Checking: Test Laptop (TestBrand)');
    // Signed-out visitors get no account-list check — the page says so.
    expect(html).toContain('You are not signed in');
    expect(html).toContain('No purchase history is recorded');
  });

  it('renders the honest empty state when the catalog is empty', async () => {
    seedEmptyCatalog();
    const html = renderToStaticMarkup(
      await OwnItCheckPage({ searchParams: {} })
    );
    expect(html).toContain('Already-Own-It Guard');
    expect(html).toContain('No catalog to pick from');
    // The typed check still works with an empty catalog.
    expect(html).toContain('Or describe a product not in the catalog');
  });

  it('RelatedTools links carry the product in the destinations’ own dialects', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await OwnItCheckPage({ searchParams: { product: 'test-laptop' } })
    );
    const section = relatedToolsSection(html);
    expect(section).toContain('Related tools');
    // T4's destinations are T1 (?current=) and T10 (?device=) — no
    // destination takes the bare ?product= dialect here.
    expect(section).toContain('current=test-laptop');
    expect(section).toContain('device=test-laptop');
    expect(section).not.toContain('current=&');
    expect(section).not.toContain('device=&');
  });
});

// ---------------------------------------------------------------------------
// T5 — Energy Cost Calculator
// ---------------------------------------------------------------------------

describe('T5 energy-cost page', () => {
  it('renders the heading + labelled running-cost result with a product present', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await EnergyCostPage({
        searchParams: {
          product: 'test-laptop',
          watts: '65',
          hours: '8',
          tariff: '0.2',
        },
      })
    );
    expect(html).toContain('AI Energy Cost Calculator');
    expect(html).toContain('Running cost — Test Laptop');
    expect(html).toContain('kWh per year');
    // Watts are always user-entered — the catalog has no wattage.
    expect(html).toContain('The catalog has no wattage data');
  });

  it('renders the honest empty state but still calculates from entered numbers', async () => {
    seedEmptyCatalog();
    const html = renderToStaticMarkup(
      await EnergyCostPage({
        searchParams: { watts: '65', hours: '8', tariff: '0.2' },
      })
    );
    expect(html).toContain('AI Energy Cost Calculator');
    expect(html).toContain('No catalog products to label with');
    expect(html).toContain('Running cost');
    expect(html).toContain('kWh per year');
  });

  it('RelatedTools links carry the product in the destinations’ own dialect', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await EnergyCostPage({
        searchParams: { product: 'test-laptop', watts: '65' },
      })
    );
    const section = relatedToolsSection(html);
    expect(section).toContain('Related tools');
    // T5's product-carrying destination is T1 (?current=).
    expect(section).toContain('current=test-laptop');
    expect(section).not.toContain('current=&');
  });
});

// ---------------------------------------------------------------------------
// T6 — Negotiation Coach
// ---------------------------------------------------------------------------

describe('T6 negotiation-coach page', () => {
  it('renders the heading + gap table vs the recorded prices with a product present', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await NegotiationCoachPage({
        searchParams: { product: 'test-laptop', target: '400' },
      })
    );
    expect(html).toContain('Negotiation Coach');
    expect(html).toContain('Test Laptop — target $400.00');
    expect(html).toContain('Cheapest today');
    // Cheapest recorded listing + lowest recorded point, both the
    // fixture's own $450.
    expect(html).toContain('$450.00');
    expect(html).toContain('Based on 2 recorded price points');
    expect(html).toContain('Recorded prices only');
  });

  it('renders the honest empty state when the catalog is empty', async () => {
    seedEmptyCatalog();
    const html = renderToStaticMarkup(
      await NegotiationCoachPage({ searchParams: {} })
    );
    expect(html).toContain('Negotiation Coach');
    expect(html).toContain('No products to coach on');
  });

  it('RelatedTools links carry ?product=', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await NegotiationCoachPage({
        searchParams: { product: 'test-laptop', target: '400' },
      })
    );
    const section = relatedToolsSection(html);
    expect(section).toContain('Related tools');
    expect(section).toContain('product=test-laptop');
    expect(section).not.toContain('product=&');
  });
});

// ---------------------------------------------------------------------------
// T7 — Repairability Explorer
// ---------------------------------------------------------------------------

describe('T7 repairability page', () => {
  it('renders every product with the "Not recorded yet" empty state (no repairability data)', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(await RepairabilityPage({ searchParams: {} }));
    expect(html).toContain('AI Repairability Explorer');
    expect(html).toContain('Test Laptop');
    expect(html).toContain('Test Headphones');
    // No repairability values are recorded for either fixture row.
    expect(html).toContain('No repairability scores recorded yet');
    expect(countOf(html, 'Not recorded yet')).toBeGreaterThanOrEqual(2);
    // No index is ever shown for a product without data.
    expect(html).not.toContain('/ 100');
  });

  it('renders the honest empty state when the catalog is empty', async () => {
    seedEmptyCatalog();
    const html = renderToStaticMarkup(await RepairabilityPage({ searchParams: {} }));
    expect(html).toContain('AI Repairability Explorer');
    expect(html).toContain('The catalog is empty right now, so there is nothing to show.');
    expect(html).toContain('No repairability scores recorded yet');
  });

  it('RelatedTools block is present and its links are bare with no product selected', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(await RepairabilityPage({ searchParams: {} }));
    const section = relatedToolsSection(html);
    expect(section).toContain('Related tools');
    expect(section).not.toContain('product=');
    expect(section).toContain('/tools/upgrade-advisor');
  });
});

// ---------------------------------------------------------------------------
// T8 — Deal Stacker
// ---------------------------------------------------------------------------

describe('T8 deal-stacker page', () => {
  it('renders the heading + the recorded-drop stack with a product present', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await DealStackerPage({ searchParams: { product: 'test-laptop' } })
    );
    expect(html).toContain('AI Deal Stacker');
    expect(html).toContain('Test Laptop');
    expect(html).toContain('Lowest in-stock recorded listing: Test Merchant');
    // The laptop's 500 → 450 recorded fall is the stack's one part
    // (no coupons/cashback seeded — nothing invented).
    expect(html).toContain('Recorded price drop');
    expect(html).toContain('1 of 2 products have a stack available right now');
  });

  it('renders the honest empty state when the catalog is empty', async () => {
    seedEmptyCatalog();
    const html = renderToStaticMarkup(
      await DealStackerPage({ searchParams: {} })
    );
    expect(html).toContain('AI Deal Stacker');
    expect(html).toContain('No products to stack for');
  });

  it('RelatedTools links carry ?product=', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await DealStackerPage({ searchParams: { product: 'test-laptop' } })
    );
    const section = relatedToolsSection(html);
    expect(section).toContain('Related tools');
    expect(section).toContain('product=test-laptop');
    expect(section).not.toContain('product=&');
  });
});

// ---------------------------------------------------------------------------
// T9 — Refurbished Buying Checklist
// ---------------------------------------------------------------------------

describe('T9 refurbished-checklist page', () => {
  it('renders the heading + the recorded-new-price benchmark (never a refurbished offer)', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await RefurbishedChecklistPage({ searchParams: { product: 'test-laptop' } })
    );
    expect(html).toContain('AI Refurbished Buying Checklist');
    expect(html).toContain('Test Laptop');
    expect(html).toContain('$450.00');
    expect(html).toContain('lowest recorded new price');
    // No refurbished price is recorded anywhere — the page says so.
    expect(html).toContain('SmartBuy records no refurbished price');
  });

  it('renders the honest empty state when the catalog is empty', async () => {
    seedEmptyCatalog();
    const html = renderToStaticMarkup(
      await RefurbishedChecklistPage({ searchParams: {} })
    );
    expect(html).toContain('AI Refurbished Buying Checklist');
    expect(html).toContain('No products to benchmark');
  });

  it('RelatedTools links carry ?product=', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await RefurbishedChecklistPage({ searchParams: { product: 'test-laptop' } })
    );
    const section = relatedToolsSection(html);
    expect(section).toContain('Related tools');
    expect(section).toContain('product=test-laptop');
    expect(section).not.toContain('product=&');
  });
});

// ---------------------------------------------------------------------------
// T10 — Accessory Compatibility Checker
// ---------------------------------------------------------------------------

describe('T10 compatibility-checker page', () => {
  it('renders the heading + an "Unknown" verdict (never "Exact") for a cross-brand pair', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await CompatibilityCheckerPage({
        searchParams: { device: 'test-laptop', accessory: 'test-headphones' },
      })
    );
    expect(html).toContain('AI Accessory Compatibility Checker');
    expect(html).toContain('Test Laptop + Test Headphones');
    expect(html).toContain('Unknown');
    expect(html).toContain('Compatibility unknown');
    expect(html).toContain('Verify before buying');
    // No compatibility data source exists — "Exact" is never assigned.
    expect(html).not.toContain('Exact');
  });

  it('rejects the same product twice instead of grading it', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await CompatibilityCheckerPage({
        searchParams: { device: 'test-laptop', accessory: 'test-laptop' },
      })
    );
    expect(html).toContain('Pick two different products');
    expect(html).not.toContain('Verdict');
  });

  it('renders the honest empty state when the catalog is empty', async () => {
    seedEmptyCatalog();
    const html = renderToStaticMarkup(
      await CompatibilityCheckerPage({ searchParams: {} })
    );
    expect(html).toContain('AI Accessory Compatibility Checker');
    expect(html).toContain('No products to check');
  });

  it('RelatedTools links carry the device (?device= dialect)', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await CompatibilityCheckerPage({
        searchParams: { device: 'test-laptop', accessory: 'test-headphones' },
      })
    );
    const section = relatedToolsSection(html);
    expect(section).toContain('Related tools');
    expect(section).toContain('current=test-laptop');
    expect(section).not.toContain('device=&');
  });
});

// ---------------------------------------------------------------------------
// Unknown slugs — the defect-fix tests (FIX 1 + FIX 2)
// ---------------------------------------------------------------------------
// An unknown ?product= / ?device= / ?current= slug must be treated as
// NO product: it appears in no RelatedTools link, and the page says
// so with an honest "not in the catalog" notice. A valid slug keeps
// its old behaviour (carried onward, picker reflects it).
// ---------------------------------------------------------------------------

describe('unknown-slug handling — no product carried, honest notice shown', () => {
  it('T1: unknown ?product= shows the notice and carries nothing', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await UpgradeAdvisorPage({ searchParams: { product: 'unknown-slug-xyz' } })
    );
    expect(html).toContain('That product is not in the catalog');
    const section = relatedToolsSection(html);
    expect(section).not.toContain('unknown-slug-xyz');
    expect(section).not.toContain('product=');
    expect(section).not.toContain('current=unknown');
  });

  it('T1: valid canonical ?product= is carried and selects the picker', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await UpgradeAdvisorPage({ searchParams: { product: 'test-laptop' } })
    );
    const section = relatedToolsSection(html);
    expect(section).toContain('product=test-laptop');
    // Minor (b): the canonical param now reflects in the picker.
    expect(html).toContain('value="test-laptop" selected');
    expect(html).not.toContain('That product is not in the catalog');
  });

  it('T2: unknown ?product= shows the notice and carries nothing', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await PersonaFitPage({
        searchParams: { persona: 'home-office', budget: '500', product: 'unknown-slug-xyz' },
      })
    );
    expect(html).toContain('That product is not in the catalog');
    const section = relatedToolsSection(html);
    expect(section).not.toContain('unknown-slug-xyz');
    expect(section).not.toContain('product=');
  });

  it('T2: valid ?product= names the selected product and is carried onward', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await PersonaFitPage({
        searchParams: { persona: 'home-office', budget: '500', product: 'test-laptop' },
      })
    );
    expect(html).toContain('Selected product:');
    expect(html).toContain('Test Laptop');
    const section = relatedToolsSection(html);
    // Persona-fit links out in the other tools' dialects: the
    // upgrade-advisor link carries ?current=, the compatibility
    // link carries ?device=. (No ?product= link exists in this
    // page's delegation map — that is the map, not a leak.)
    expect(section).toContain('current=test-laptop');
    expect(section).toContain('device=test-laptop');
  });

  it('T3: unknown ?product= shows the notice and carries nothing', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await PriceMatchPage({ searchParams: { product: 'unknown-slug-xyz' } })
    );
    expect(html).toContain('That product is not in the catalog');
    const section = relatedToolsSection(html);
    expect(section).not.toContain('unknown-slug-xyz');
    expect(section).not.toContain('product=');
  });

  it('T3: valid ?product= names the selected product and is carried onward', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await PriceMatchPage({ searchParams: { product: 'test-laptop' } })
    );
    expect(html).toContain('Selected product:');
    expect(html).toContain('Test Laptop');
    const section = relatedToolsSection(html);
    expect(section).toContain('product=test-laptop');
  });

  it('T4: unknown ?product= shows the notice and carries nothing', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await OwnItCheckPage({ searchParams: { product: 'unknown-slug-xyz' } })
    );
    expect(html).toContain('That product is not in the catalog');
    const section = relatedToolsSection(html);
    expect(section).not.toContain('unknown-slug-xyz');
    expect(section).not.toContain('product=');
  });

  it('T5: unknown ?product= shows the notice and carries nothing', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await EnergyCostPage({ searchParams: { product: 'unknown-slug-xyz' } })
    );
    expect(html).toContain('That product is not in the catalog');
    const section = relatedToolsSection(html);
    expect(section).not.toContain('unknown-slug-xyz');
    expect(section).not.toContain('product=');
  });

  it('T6: unknown ?product= shows the notice and carries nothing', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await NegotiationCoachPage({ searchParams: { product: 'unknown-slug-xyz' } })
    );
    expect(html).toContain('That product is not in the catalog');
    const section = relatedToolsSection(html);
    expect(section).not.toContain('unknown-slug-xyz');
    expect(section).not.toContain('product=');
  });

  it('T7: valid ?product= is carried onward (FIX 2 — no longer hardcoded null)', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await RepairabilityPage({ searchParams: { product: 'test-laptop' } })
    );
    const section = relatedToolsSection(html);
    // Refurbished-checklist link carries ?product=; upgrade-advisor
    // link carries the same product in its own ?current= dialect.
    expect(section).toContain('product=test-laptop');
    expect(section).toContain('current=test-laptop');
  });

  it('T7: unknown ?product= shows the notice and carries nothing', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await RepairabilityPage({ searchParams: { product: 'unknown-slug-xyz' } })
    );
    expect(html).toContain('That product is not in the catalog');
    const section = relatedToolsSection(html);
    expect(section).not.toContain('unknown-slug-xyz');
    expect(section).not.toContain('product=');
  });

  it('T8: unknown ?product= shows the notice, carries nothing, and selects no stack', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await DealStackerPage({ searchParams: { product: 'unknown-slug-xyz' } })
    );
    expect(html).toContain('That product is not in the catalog');
    const section = relatedToolsSection(html);
    expect(section).not.toContain('unknown-slug-xyz');
    expect(section).not.toContain('product=');
    // No stack is silently substituted for the unknown product.
    expect(html).not.toContain('Best stack for');
  });

  it('T9: unknown ?product= shows the notice and carries nothing', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await RefurbishedChecklistPage({ searchParams: { product: 'unknown-slug-xyz' } })
    );
    expect(html).toContain('That product is not in the catalog');
    const section = relatedToolsSection(html);
    expect(section).not.toContain('unknown-slug-xyz');
    expect(section).not.toContain('product=');
  });

  it('T10: unknown ?device= shows the not-found state and carries nothing', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await CompatibilityCheckerPage({ searchParams: { device: 'unknown-slug-xyz' } })
    );
    expect(html).toContain('One of the picked products is not in the catalog');
    const section = relatedToolsSection(html);
    expect(section).not.toContain('unknown-slug-xyz');
    expect(section).not.toContain('current=unknown');
  });

  it('T10: valid canonical ?product= is carried and selects the picker', async () => {
    seedCatalog();
    const html = renderToStaticMarkup(
      await CompatibilityCheckerPage({ searchParams: { product: 'test-laptop' } })
    );
    const section = relatedToolsSection(html);
    expect(section).toContain('current=test-laptop');
    // Minor (b): the canonical param now reflects in the device picker.
    expect(html).toContain('value="test-laptop" selected');
    expect(html).not.toContain('One of the picked products is not in the catalog');
  });
});
