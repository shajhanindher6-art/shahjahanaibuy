import { describe, expect, it } from 'vitest';
import {
  EBAY_INTAKE_SOURCE,
  buildEbayIntakeProvenance,
  mapEbayListingToIntakeRow,
  reviewEbayIntakeRows,
  type EbayIntakeFieldOverrides,
} from '@/services/ebay-intake';
import type { IntakeCatalogContext } from '@/services/catalog-intake';
import type { EbayListing } from '@/services/ebay-browse';

// Section 15, P3-1 / P3-6 — eBay listing → intake mapping + dedupe.
// Pure tests: synthetic listings only (fake itemIds/titles), no
// network, no database, no real credentials anywhere.

function listing(overrides: Partial<EbayListing> = {}): EbayListing {
  return {
    itemId: 'v1|123456789012|0',
    title: 'Apple MacBook Air 13 inch Laptop M2 8GB 256GB',
    price: 899,
    currency: 'USD',
    condition: 'New',
    itemWebUrl: 'https://www.ebay.com/itm/123456789012',
    imageUrl: 'https://i.ebayimg.com/fake-1.jpg',
    ...overrides,
  };
}

function context(overrides: Partial<IntakeCatalogContext> = {}): IntakeCatalogContext {
  return {
    existingSlugs: new Set(),
    existingNameBrands: new Map(),
    knownMerchants: new Map([['ebay', 'merchant-ebay-id']]),
    knownCurrencies: new Map([
      ['USD', 'currency-usd-id'],
      ['EUR', 'currency-eur-id'],
      ['GBP', 'currency-gbp-id'],
    ]),
    ...overrides,
  };
}

function fields(overrides: Partial<EbayIntakeFieldOverrides> = {}): EbayIntakeFieldOverrides {
  return {
    brand: 'Apple',
    category: 'Laptops',
    slug: 'macbook-air-13-ebay',
    ...overrides,
  };
}

describe('mapEbayListingToIntakeRow', () => {
  it('maps the eBay fields per the audit table', () => {
    const row = mapEbayListingToIntakeRow(listing(), 1, fields());
    expect(row.name).toBe('Apple MacBook Air 13 inch Laptop M2 8GB 256GB');
    expect(row.slug).toBe('macbook-air-13-ebay');
    expect(row.brand).toBe('Apple');
    expect(row.category).toBe('Laptops');
    expect(row.price).toBe('899');
    expect(row.currency).toBe('USD');
    // The merchant is always eBay; the itemId is the durable key.
    expect(row.merchant).toBe('ebay');
    expect(row.sku).toBe('v1|123456789012|0');
    expect(row.imageUrl).toBe('https://i.ebayimg.com/fake-1.jpg');
  });

  it('maps a null price to an empty price (an error row, never zero)', () => {
    const row = mapEbayListingToIntakeRow(listing({ price: null }), 1, fields());
    expect(row.price).toBe('');
  });

  it('maps a missing currency to an empty currency (an error row)', () => {
    const row = mapEbayListingToIntakeRow(listing({ currency: null }), 1, fields());
    expect(row.currency).toBe('');
  });

  it('never derives the slug from the itemId', () => {
    const row = mapEbayListingToIntakeRow(listing(), 1, fields({ slug: '' }));
    expect(row.slug).toBe('');
    expect(row.slug).not.toContain('123456789012');
  });
});

describe('reviewEbayIntakeRows', () => {
  it('reviews a clean listing as valid', () => {
    const result = reviewEbayIntakeRows(
      [listing()],
      new Map([['v1|123456789012|0', fields()]]),
      context(),
      new Set(),
      { query: 'macbook air 13', fetchedAt: '2026-11-12T09:00:00.000Z' }
    );
    expect(result.review.summary).toEqual({
      total: 1,
      valid: 1,
      errors: 0,
      duplicates: 0,
      nearDuplicates: 0,
    });
    expect(result.ebayDuplicates).toBe(0);
    expect(result.review.rows[0].data).toMatchObject({
      slug: 'macbook-air-13-ebay',
      price: 899,
      currency: 'USD',
      currencyId: 'currency-usd-id',
      merchantId: 'merchant-ebay-id',
      sku: 'v1|123456789012|0',
    });
    expect(result.provenance).toEqual({
      source: EBAY_INTAKE_SOURCE,
      query: 'macbook air 13',
      fetched_at: '2026-11-12T09:00:00.000Z',
      items: [
        {
          rowNumber: 1,
          ebay_item_id: 'v1|123456789012|0',
          itemWebUrl: 'https://www.ebay.com/itm/123456789012',
          condition: 'New',
        },
      ],
    });
  });

  it('flags a null price as an error row', () => {
    const result = reviewEbayIntakeRows(
      [listing({ price: null })],
      new Map([['v1|123456789012|0', fields()]]),
      context(),
      new Set(),
      { query: 'macbook air 13', fetchedAt: '2026-11-12T09:00:00.000Z' }
    );
    expect(result.review.summary.errors).toBe(1);
    expect(result.review.rows[0].status).toBe('error');
    expect(result.review.rows[0].errors[0].field).toBe('price');
    expect(result.review.rows[0].data).toBeNull();
  });

  it('flags an unknown currency as an error row', () => {
    const result = reviewEbayIntakeRows(
      [listing({ currency: 'XXX' })],
      new Map([['v1|123456789012|0', fields()]]),
      context(),
      new Set(),
      { query: 'macbook air 13', fetchedAt: '2026-11-12T09:00:00.000Z' }
    );
    expect(result.review.rows[0].status).toBe('error');
    expect(result.review.rows[0].errors[0].field).toBe('currency');
  });

  it('flags missing brand / category / slug as error rows, never guessed', () => {
    const result = reviewEbayIntakeRows(
      [listing()],
      new Map([
        ['v1|123456789012|0', { brand: '', category: '', slug: '' }],
      ]),
      context(),
      new Set(),
      { query: 'macbook air 13', fetchedAt: '2026-11-12T09:00:00.000Z' }
    );
    expect(result.review.rows[0].status).toBe('error');
    const fields = result.review.rows[0].errors.map((e) => e.field);
    expect(fields).toContain('brand');
    expect(fields).toContain('category');
    expect(fields).toContain('slug');
  });

  it('flags an invalid slug as an error row', () => {
    const result = reviewEbayIntakeRows(
      [listing()],
      new Map([['v1|123456789012|0', fields({ slug: 'Bad Slug!' })]]),
      context(),
      new Set(),
      { query: 'macbook air 13', fetchedAt: '2026-11-12T09:00:00.000Z' }
    );
    expect(result.review.rows[0].status).toBe('error');
    expect(result.review.rows[0].errors[0].field).toBe('slug');
  });

  it('flags an unknown merchant (no eBay merchants row) as an error row', () => {
    const result = reviewEbayIntakeRows(
      [listing()],
      new Map([['v1|123456789012|0', fields()]]),
      context({ knownMerchants: new Map([['amazon', 'merchant-amazon-id']]) }),
      new Set(),
      { query: 'macbook air 13', fetchedAt: '2026-11-12T09:00:00.000Z' }
    );
    expect(result.review.rows[0].status).toBe('error');
    expect(result.review.rows[0].errors[0].field).toBe('merchant');
  });

  it('marks an already-ingested itemId as a duplicate (rule 3)', () => {
    const result = reviewEbayIntakeRows(
      [listing()],
      new Map([['v1|123456789012|0', fields()]]),
      context(),
      new Set(['v1|123456789012|0']),
      { query: 'macbook air 13', fetchedAt: '2026-11-12T09:00:00.000Z' }
    );
    expect(result.review.summary).toMatchObject({ valid: 0, duplicates: 1 });
    expect(result.ebayDuplicates).toBe(1);
    expect(result.review.rows[0].status).toBe('duplicate');
    expect(result.review.rows[0].duplicateOf).toContain('v1|123456789012|0');
    expect(result.review.rows[0].data).toBeNull();
  });

  it('marks the second occurrence of an itemId in one batch as a duplicate', () => {
    const first = listing({ itemId: 'v1|dup|0', title: 'Apple MacBook Air 13' });
    const second = listing({ itemId: 'v1|dup|0', title: 'Apple MacBook Air 13 again' });
    const result = reviewEbayIntakeRows(
      [first, second],
      new Map([
        ['v1|dup|0', fields({ slug: 'macbook-air-13-ebay' })],
      ]),
      context(),
      new Set(),
      { query: 'macbook air 13', fetchedAt: '2026-11-12T09:00:00.000Z' }
    );
    // The shared review cannot hold two rows with the same slug:
    // the second row is a slug duplicate AND an itemId duplicate.
    // Either way it must not be valid.
    expect(result.review.rows[1].status).toBe('duplicate');
    expect(result.review.rows[1].data).toBeNull();
  });

  it('marks a repeated itemId with a different slug as a duplicate too', () => {
    // Two occurrences of one itemId always share one fields entry
    // (keyed by itemId), so the shared slug rule catches the
    // repeat as well. The itemId rule is the backstop for the
    // already-in-catalog case above — the case the slug rule
    // cannot see, because a re-listed item gets a fresh slug.
    const first = listing({ itemId: 'v1|dup2|0', title: 'Sony WH-1000XM5' });
    const second = listing({ itemId: 'v1|dup2|0', title: 'Sony WH-1000XM5 black' });
    const result = reviewEbayIntakeRows(
      [first, second],
      new Map([['v1|dup2|0', fields({ slug: 'sony-wh-1000xm5-ebay' })]]),
      context(),
      new Set(),
      { query: 'sony headphones', fetchedAt: '2026-11-12T09:00:00.000Z' }
    );
    expect(result.review.rows[1].status).toBe('duplicate');
    expect(result.review.rows[1].data).toBeNull();
  });

  it('marks an existing slug as a duplicate and a same name+brand as a near-duplicate', () => {
    const existingSlug = context({
      existingSlugs: new Set(['macbook-air-13-ebay']),
    });
    const slugResult = reviewEbayIntakeRows(
      [listing()],
      new Map([['v1|123456789012|0', fields()]]),
      existingSlug,
      new Set(),
      { query: 'macbook air 13', fetchedAt: '2026-11-12T09:00:00.000Z' }
    );
    expect(slugResult.review.rows[0].status).toBe('duplicate');

    const nameBrand = context({
      existingNameBrands: new Map([
        ['apple macbook air 13 inch laptop m2 8gb 256gb|apple', 'macbook-air-13'],
      ]),
    });
    const nbResult = reviewEbayIntakeRows(
      [listing()],
      new Map([['v1|123456789012|0', fields()]]),
      nameBrand,
      new Set(),
      { query: 'macbook air 13', fetchedAt: '2026-11-12T09:00:00.000Z' }
    );
    expect(nbResult.review.rows[0].status).toBe('near-duplicate');
  });

  it('skips listings the admin never annotated', () => {
    const result = reviewEbayIntakeRows(
      [listing(), listing({ itemId: 'v1|999|0', title: 'Other item' })],
      new Map([['v1|123456789012|0', fields()]]),
      context(),
      new Set(),
      { query: 'macbook air 13', fetchedAt: '2026-11-12T09:00:00.000Z' }
    );
    expect(result.review.summary.total).toBe(1);
    expect(result.skippedItems).toEqual(['v1|999|0']);
  });

  it('passes a non-USD currency through to the review', () => {
    const result = reviewEbayIntakeRows(
      [listing({ currency: 'EUR', price: 299 })],
      new Map([['v1|123456789012|0', fields()]]),
      context(),
      new Set(),
      { query: 'sony headphones', fetchedAt: '2026-11-12T09:00:00.000Z' }
    );
    expect(result.review.rows[0].status).toBe('valid');
    expect(result.review.rows[0].data).toMatchObject({
      currency: 'EUR',
      currencyId: 'currency-eur-id',
    });
  });
});

describe('buildEbayIntakeProvenance', () => {
  it('records source, query, fetched_at and per-row eBay ids', () => {
    const rows = [mapEbayListingToIntakeRow(listing(), 1, fields())];
    const provenance = buildEbayIntakeProvenance(
      'macbook air 13',
      '2026-11-12T09:00:00.000Z',
      [listing()],
      rows
    );
    expect(provenance.source).toBe('ebay-browse-api');
    expect(provenance.query).toBe('macbook air 13');
    expect(provenance.items).toHaveLength(1);
    expect(provenance.items[0].ebay_item_id).toBe('v1|123456789012|0');
  });
});
