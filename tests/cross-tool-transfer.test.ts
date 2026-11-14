/**
 * Master Tool Integration, Stage 6 (S6-2) — cross-tool transfer tests.
 *
 * What Stage 1 and Stage 3 already prove (NOT repeated here):
 * - Stage 1 (tests/tool-integration.test.ts): parseToolParams for
 *   every dialect, buildToolUrl ↔ parseToolParams round-trips WITHIN
 *   one dialect, cached-fetch dedup via a fake client (getToolProduct
 *   / getToolPriceHistory / getToolMerchantProducts / getCachedProducts),
 *   resolveCompareProductSlugs, every link builder's literal URL.
 * - Stage 3 (tests/tool-integration-wiring.test.ts): every link
 *   builder's URL parses back to the same product, relatedToolLinks
 *   routes exist + carry the product, getCachedProducts /
 *   getToolPriceHistory / getToolMerchantProducts dedup via a counting
 *   delegate, and the source-level wiring mounts.
 *
 * What this file ADDS (the gaps those two leave):
 * (a) TRANSFER BETWEEN dialects — a selection parsed from one
 *     tool's URL, rebuilt for a different tool, and parsed back in
 *     the destination's own dialect (T10 → all 10 tools, T1 → all
 *     10 tools, canonical → all 10 tools), plus the /compare UUID
 *     chain (UUIDs → resolved slugs → a tool URL) and a parse-back
 *     of every RelatedTools link in its destination's dialect;
 * (b) getToolProduct dedup through the SERVICE layer — attempted
 *     first as the Stage-3 counting pattern (vi.mock on the
 *     cross-module delegate), then REMOVED on purpose: the cache
 *     lives INSIDE getCachedProductBySlug, so mocking that delegate
 *     replaces the cache itself and two calls legitimately call it
 *     twice — the mock proves nothing about dedup. (That is the
 *     same intra-module caveat Stage 3 documents for
 *     price-history/commerce.) Dedup is therefore proven at the
 *     fake-client boundary — the Stage-1 pattern — for the transfer
 *     paths Stage 1/3 never counted: compareLinkForProduct twice
 *     for one slug costs one products query; /compare UUID
 *     resolution is documented as UNCACHED (each visit re-resolves
 *     via getProductById, so a renamed product can never serve a
 *     stale slug). getToolProduct / getCachedProducts /
 *     getToolPriceHistory / getToolMerchantProducts dedup itself
 *     stays Stage 1 + Stage 3's and is referenced, not repeated.
 * (c) the transfer matrix never emits an empty product param, and
 *     the product is carried to every destination that takes one —
 *     including T2 persona-fit and T3 price-match, which read
 *     `?product=` for transfer and show the selected product. Only
 *     routes with no product concept (/compare, budget-finder,
 *     coupons-cashback, price-history) stay bare.
 *
 * No fake products or prices are asserted anywhere: the slugs are
 * opaque identifiers carried through URLs, and the /compare chain
 * resolves only IDs the fake client actually holds.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  parseToolParams,
  parseAndResolveToolParams,
  buildToolUrl,
  compareLinkForProduct,
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
import { invalidateCache } from '@/lib/cache';

const SLUG = 'macbook-air-13';
const OTHER_SLUG = 'sony-wh-1000xm5';
const UUID_1 = '11111111-1111-1111-1111-111111111111';
const UUID_2 = '22222222-2222-2222-2222-222222222222';

// --- Fake client for the /compare chain + transfer-path dedup -------
// Minimal thenable query engine (Stage-1 pattern): filters accumulate
// across the chain and apply at await time; fromCalls counts the
// underlying products reads so dedup can be asserted.
type Row = Record<string, unknown>;

const fakeDb = {
  tables: {} as Record<string, Row[]>,
  fromCalls: {} as Record<string, number>,
};

function seedProducts(rows: Row[]): void {
  fakeDb.tables['products'] = rows.map((r) => ({ ...r }));
}

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];

  constructor(private readonly table: string) {}

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
  is(col: string, value: unknown): this {
    this.filters.push((r) => (value === null ? r[col] == null : r[col] === value));
    return this;
  }
  maybeSingle(): this {
    return this;
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: unknown }> {
    fakeDb.fromCalls[this.table] = (fakeDb.fromCalls[this.table] ?? 0) + 1;
    const table = fakeDb.tables[this.table];
    if (!table) {
      return { data: null, error: { code: 'PGRST205', message: `Could not find the table '${this.table}'` } };
    }
    const rows = table.filter((r) => this.filters.every((f) => f(r)));
    return { data: rows[0] ?? null, error: null };
  }
}

const fakeClient = {
  from: (table: string) => new FakeQuery(table),
} as never;

function productRow(overrides: Row = {}): Row {
  return {
    id: UUID_1,
    name: 'MacBook Air 13',
    slug: SLUG,
    description: 'A test product',
    brand: 'Apple',
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
    deleted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  fakeDb.tables = {};
  fakeDb.fromCalls = {};
  invalidateCache('smartbuy:');
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the query string of a built href the way a page would. */
function parsed(href: string) {
  const qs = href.includes('?') ? href.split('?')[1] : '';
  return parseToolParams(new URLSearchParams(qs));
}

/** The product a destination tool reads from a URL, in its own dialect. */
function destinationProduct(route: string, href: string): string | null {
  const sel = parsed(href);
  if (route === TOOL_ROUTES['upgrade-advisor']) return sel.currentSlug;
  if (route === TOOL_ROUTES['compatibility-checker']) return sel.deviceSlug;
  if (route === TOOL_ROUTES.compare) return null;
  return sel.productSlug;
}

// ---------------------------------------------------------------------------
// (a) Transfer between dialects — one selection, every destination
// ---------------------------------------------------------------------------

describe('cross-dialect transfer — one selection survives to every tool', () => {
  // Every destination that takes a product, keyed by the params its
  // dialect needs, built from a parsed selection.
  function buildForDestination(
    route: string,
    sel: ReturnType<typeof parseToolParams>
  ): string {
    switch (route) {
      case TOOL_ROUTES['upgrade-advisor']:
        return buildToolUrl(route, {
          currentSlug: sel.productSlug ?? sel.currentSlug ?? sel.deviceSlug,
          successorSlug: sel.successorSlug ?? sel.accessorySlug ?? null,
        });
      case TOOL_ROUTES['compatibility-checker']:
        return buildToolUrl(route, {
          deviceSlug: sel.productSlug ?? sel.deviceSlug ?? sel.currentSlug,
          accessorySlug: sel.accessorySlug ?? sel.successorSlug ?? null,
        });
      case TOOL_ROUTES['persona-fit']:
        // T2 carries the product via ?product= (its own dialect is
        // persona/budget; the builders add the product through `extra`).
        return personaFitLink(
          sel.persona,
          sel.budget,
          sel.productSlug ?? sel.currentSlug ?? sel.deviceSlug
        );
      case TOOL_ROUTES['price-match']:
        // T3 likewise carries the product via ?product=.
        return priceMatchLink(
          sel.status,
          sel.productSlug ?? sel.currentSlug ?? sel.deviceSlug
        );
      default:
        return buildToolUrl(route, { productSlug: sel.productSlug });
    }
  }

  const DESTINATIONS = Object.values(TOOL_ROUTES).filter(
    (r) => r !== TOOL_ROUTES.compare
  );

  it.each([
    ['canonical ?product=', energyCostLink(SLUG)],
    ['T1 ?current=&successor=', upgradeAdvisorLink(SLUG, OTHER_SLUG)],
    ['T10 ?device=&accessory=', compatibilityLink(SLUG, OTHER_SLUG)],
    ['T4 ?product= + typed fields', ownItLink(SLUG, { name: 'MacBook Air', brand: 'Apple' })],
  ])(
    'from %s: every destination reads the same product back',
    (_label, sourceHref) => {
      const source = parsed(sourceHref);
      for (const route of DESTINATIONS) {
        const href = buildForDestination(route, source);
        const back = parsed(href);
        if (route === TOOL_ROUTES['persona-fit']) {
          // T2 reads ?product= for transfer and shows the selected
          // product, so the product travels here too.
          expect(back.productSlug).toBe(SLUG);
          expect(href).toBe(`/tools/persona-fit?product=${SLUG}`);
        } else if (route === TOOL_ROUTES['price-match']) {
          // T3 likewise carries the product.
          expect(back.productSlug).toBe(SLUG);
          expect(href).toBe(`/tools/price-match?product=${SLUG}`);
        } else {
          expect(destinationProduct(route, href)).toBe(SLUG);
        }
        // No transfer ever emits an empty product param.
        expect(href).not.toContain('product=&');
        expect(href).not.toContain('product=$');
        expect(href).not.toContain('device=&');
        expect(href).not.toContain('current=&');
      }
    }
  );

  it('T1 current/successor transfers to T10 device/accessory as a pair', () => {
    const source = parsed(upgradeAdvisorLink(SLUG, OTHER_SLUG));
    const href = buildToolUrl(TOOL_ROUTES['compatibility-checker'], {
      deviceSlug: source.currentSlug,
      accessorySlug: source.successorSlug,
    });
    expect(href).toBe(
      `/tools/compatibility-checker?device=${SLUG}&accessory=${OTHER_SLUG}`
    );
    const back = parsed(href);
    expect(back.deviceSlug).toBe(SLUG);
    expect(back.accessorySlug).toBe(OTHER_SLUG);
    expect(back.productSlug).toBe(SLUG);
  });

  it('T10 device/accessory transfers to T1 current/successor as a pair', () => {
    const source = parsed(compatibilityLink(SLUG, OTHER_SLUG));
    const href = buildToolUrl(TOOL_ROUTES['upgrade-advisor'], {
      currentSlug: source.deviceSlug,
      successorSlug: source.accessorySlug,
    });
    expect(href).toBe(
      `/tools/upgrade-advisor?current=${SLUG}&successor=${OTHER_SLUG}`
    );
    const back = parsed(href);
    expect(back.currentSlug).toBe(SLUG);
    expect(back.successorSlug).toBe(OTHER_SLUG);
    expect(back.productSlug).toBe(SLUG);
  });

  it('T2 persona/budget survive a transfer to T2; buildToolUrl ignores the legacy productSlug field there', () => {
    const href = personaFitLink('student', '1000');
    const back = parsed(href);
    expect(back.persona).toBe('student');
    expect(back.budget).toBe('1000');
    expect(back.productSlug).toBeNull();
    // buildToolUrl's T2 branch ignores the legacy `productSlug`
    // field — the product travels to T2 through the builders'
    // `extra` path instead (personaFitLink(..., product), asserted
    // in tool-integration.test.ts), never through a param T2
    // does not understand.
    const rebuilt = buildToolUrl(TOOL_ROUTES['persona-fit'], {
      productSlug: SLUG,
      persona: 'student',
      budget: '1000',
    });
    expect(rebuilt).toBe('/tools/persona-fit?persona=student&budget=1000');
  });

  it('T3 status survives a transfer to T3; buildToolUrl ignores the legacy productSlug field there', () => {
    const back = parsed(priceMatchLink('offers'));
    expect(back.status).toBe('offers');
    expect(back.productSlug).toBeNull();
    const rebuilt = buildToolUrl(TOOL_ROUTES['price-match'], {
      productSlug: SLUG,
      status: 'offers',
    });
    expect(rebuilt).toBe('/tools/price-match?status=offers');
  });

  it('T6 target/reason and T5 watts/hours/tariff survive alongside the product', () => {
    const negotiation = parsed(
      buildToolUrl(TOOL_ROUTES['negotiation-coach'], {
        productSlug: SLUG,
        target: '899',
        reason: 'too expensive',
      })
    );
    expect(negotiation.productSlug).toBe(SLUG);
    expect(negotiation.target).toBe('899');
    expect(negotiation.reason).toBe('too expensive');

    const energy = parsed(
      buildToolUrl(TOOL_ROUTES['energy-cost'], {
        productSlug: SLUG,
        watts: '65',
        hours: '8',
        tariff: '0.2',
      })
    );
    expect(energy.productSlug).toBe(SLUG);
    expect(energy.watts).toBe('65');
    expect(energy.hours).toBe('8');
    expect(energy.tariff).toBe('0.2');
  });
});

// ---------------------------------------------------------------------------
// (a) /compare UUID chain — UUIDs resolve to slugs, then a tool URL
// ---------------------------------------------------------------------------

describe('/compare UUID chain — resolved slugs transfer into tools', () => {
  beforeEach(() => {
    seedProducts([
      productRow(),
      productRow({ id: UUID_2, slug: OTHER_SLUG, name: 'Sony WH-1000XM5', brand: 'Sony', category: 'Headphones' }),
    ]);
  });

  it('resolves both UUIDs, then the first slug transfers to a tool URL', async () => {
    const sel = await parseAndResolveToolParams(
      fakeClient,
      new URLSearchParams(`products=${UUID_1},${UUID_2}`)
    );
    expect(sel.compareProductIds).toEqual([UUID_1, UUID_2]);
    expect(sel.compareProductSlugs).toEqual([SLUG, OTHER_SLUG]);
    expect(sel.unresolvedCompareIds).toEqual([]);

    const href = buildToolUrl(TOOL_ROUTES['energy-cost'], {
      productSlug: sel.compareProductSlugs[0] ?? null,
    });
    expect(href).toBe(`/tools/energy-cost?product=${SLUG}`);
    expect(parsed(href).productSlug).toBe(SLUG);
  });

  it('an unresolvable UUID stays unresolved and never becomes a tool product', async () => {
    const sel = await parseAndResolveToolParams(
      fakeClient,
      new URLSearchParams(`products=${UUID_1},00000000-0000-0000-0000-000000000000`)
    );
    expect(sel.compareProductSlugs).toEqual([SLUG]);
    expect(sel.unresolvedCompareIds).toEqual([
      '00000000-0000-0000-0000-000000000000',
    ]);
    // Only resolved slugs transfer — the unknown UUID has no slug
    // to carry, so no tool URL is built from it.
    expect(sel.compareProductSlugs).not.toContain(
      '00000000-0000-0000-0000-000000000000'
    );
    expect(compareLink(sel.compareProductIds)).toBe(
      `/compare?products=${UUID_1},00000000-0000-0000-0000-000000000000`
    );
  });
});

// ---------------------------------------------------------------------------
// (a) RelatedTools links — parse every link back in its destination dialect
// ---------------------------------------------------------------------------

describe('relatedToolLinks — every link parses back to the same product', () => {
  const PRODUCT_DESTINATIONS = new Set([
    TOOL_ROUTES['own-it-check'],
    TOOL_ROUTES['energy-cost'],
    TOOL_ROUTES['negotiation-coach'],
    TOOL_ROUTES.repairability,
    TOOL_ROUTES['deal-stacker'],
    TOOL_ROUTES['refurbished-checklist'],
  ]);

  it.each(Object.keys(TOOL_ROUTES).filter((t) => t !== 'compare'))(
    '%s: each link parses back to the product in the destination dialect',
    (tool) => {
      const links = relatedToolLinks(tool, SLUG);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        const route = link.href.split('?')[0];
        const sel = parsed(link.href);
        if (PRODUCT_DESTINATIONS.has(route)) {
          expect(sel.productSlug).toBe(SLUG);
        } else if (route === TOOL_ROUTES['upgrade-advisor']) {
          expect(sel.currentSlug).toBe(SLUG);
          expect(sel.productSlug).toBe(SLUG);
        } else if (route === TOOL_ROUTES['compatibility-checker']) {
          expect(sel.deviceSlug).toBe(SLUG);
          expect(sel.productSlug).toBe(SLUG);
        } else if (route === TOOL_ROUTES['persona-fit']) {
          // T2 reads ?product= for transfer and shows the selected
          // product, so the link carries it.
          expect(sel.productSlug).toBe(SLUG);
        } else if (route === TOOL_ROUTES['price-match']) {
          // T3 likewise carries the product.
          expect(sel.productSlug).toBe(SLUG);
        } else {
          // /compare, budget-finder, coupons-cashback, price-history:
          // no product param by design — the link must be bare,
          // never half-carried.
          expect(sel.productSlug).toBeNull();
          expect(sel.deviceSlug).toBeNull();
          expect(sel.currentSlug).toBeNull();
          expect(link.href).not.toContain('product=');
          expect(link.href).not.toContain('device=');
          expect(link.href).not.toContain('current=');
        }
      }
    }
  );

  it('with no product every RelatedTools link is bare in every dialect', () => {
    for (const tool of Object.keys(TOOL_ROUTES).filter((t) => t !== 'compare')) {
      for (const link of relatedToolLinks(tool, null)) {
        expect(link.href).not.toContain('product=');
        expect(link.href).not.toContain('device=');
        expect(link.href).not.toContain('current=');
        expect(link.href).not.toContain('accessory=');
        expect(link.href).not.toContain('successor=');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (b) Transfer-path dedup — counted at the fake-client boundary
// ---------------------------------------------------------------------------

describe('transfer-path dedup — one underlying read for a repeated transfer', () => {
  beforeEach(() => {
    seedProducts([productRow()]);
  });

  it('compareLinkForProduct twice for one slug queries products once', async () => {
    const first = await compareLinkForProduct(fakeClient, SLUG);
    const second = await compareLinkForProduct(fakeClient, SLUG);
    expect(first).toBe(`/compare?products=${UUID_1}`);
    expect(second).toBe(first);
    // The slug → id lookup goes through getToolProduct's cache, so
    // the second link build costs no second read.
    expect(fakeDb.fromCalls['products']).toBe(1);
  });

  it('compareLinkForProduct for an unknown slug is bare /compare and costs one read', async () => {
    expect(await compareLinkForProduct(fakeClient, 'no-such-slug')).toBe('/compare');
    expect(fakeDb.fromCalls['products']).toBe(1);
  });

  it('/compare UUID resolution is NOT cached — each visit re-resolves (documented)', async () => {
    const params = new URLSearchParams(`products=${UUID_1}`);
    const first = await parseAndResolveToolParams(fakeClient, params);
    const second = await parseAndResolveToolParams(fakeClient, params);
    expect(first.compareProductSlugs).toEqual([SLUG]);
    expect(second.compareProductSlugs).toEqual([SLUG]);
    // resolveCompareProductSlugs → getProductById has no cache layer,
    // so the second resolution re-queries. That is the honest
    // behaviour today: a renamed product can never serve a stale
    // slug from this path. (If this is ever cached, this test is the
    // one to update — deliberately, not silently.)
    expect(fakeDb.fromCalls['products']).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (c) Builders used by the transfer — all ten, one table
// ---------------------------------------------------------------------------

describe('link builders — the transfer sources, all ten tools', () => {
  it('every builder carries the product in the destination dialect (or honestly drops it)', () => {
    expect(energyCostLink(SLUG)).toBe(`/tools/energy-cost?product=${SLUG}`);
    expect(dealStackerLink(SLUG)).toBe(`/tools/deal-stacker?product=${SLUG}`);
    expect(negotiationLink(SLUG)).toBe(`/tools/negotiation-coach?product=${SLUG}`);
    expect(repairabilityLink(SLUG)).toBe(`/tools/repairability?product=${SLUG}`);
    expect(refurbishedLink(SLUG)).toBe(
      `/tools/refurbished-checklist?product=${SLUG}`
    );
    expect(ownItLink(SLUG)).toBe(`/tools/own-it-check?product=${SLUG}`);
    expect(upgradeAdvisorLink(SLUG, OTHER_SLUG)).toBe(
      `/tools/upgrade-advisor?current=${SLUG}&successor=${OTHER_SLUG}`
    );
    expect(compatibilityLink(SLUG, OTHER_SLUG)).toBe(
      `/tools/compatibility-checker?device=${SLUG}&accessory=${OTHER_SLUG}`
    );
    // T2/T3 take no product — their builders carry their own dialect.
    expect(personaFitLink('student', '1000')).toBe(
      '/tools/persona-fit?persona=student&budget=1000'
    );
    expect(priceMatchLink('offers')).toBe('/tools/price-match?status=offers');
  });

  it('every builder with no product returns the bare route', () => {
    expect(energyCostLink(null)).toBe(TOOL_ROUTES['energy-cost']);
    expect(dealStackerLink(null)).toBe(TOOL_ROUTES['deal-stacker']);
    expect(negotiationLink(null)).toBe(TOOL_ROUTES['negotiation-coach']);
    expect(repairabilityLink(null)).toBe(TOOL_ROUTES.repairability);
    expect(refurbishedLink(null)).toBe(TOOL_ROUTES['refurbished-checklist']);
    expect(ownItLink(null)).toBe(TOOL_ROUTES['own-it-check']);
    expect(compatibilityLink(null)).toBe(TOOL_ROUTES['compatibility-checker']);
    expect(upgradeAdvisorLink(null)).toBe(TOOL_ROUTES['upgrade-advisor']);
    expect(personaFitLink()).toBe(TOOL_ROUTES['persona-fit']);
    expect(priceMatchLink()).toBe(TOOL_ROUTES['price-match']);
  });
});
