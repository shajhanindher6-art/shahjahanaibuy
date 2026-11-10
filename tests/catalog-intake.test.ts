import { describe, expect, it } from 'vitest';
import {
  INTAKE_SOURCE,
  parseIntakeCsv,
  reviewIntakeRows,
  planIntakeInsert,
  type IntakeCatalogContext,
  type IntakeRowInput,
} from '@/services/catalog-intake';

// Section 9 — catalog intake pipeline. Pure-function tests: no DB, no
// network, no live-price fetching anywhere in this chunk. The preview
// step (parse + review) must never produce anything insertable — only
// planIntakeInsert, called by the explicit approve action, does.

function context(overrides: Partial<IntakeCatalogContext> = {}): IntakeCatalogContext {
  return {
    existingSlugs: new Set(['macbook-air-13']),
    existingNameBrands: new Map([['macbook air 13|apple', 'macbook-air-13']]),
    knownMerchants: new Map([
      ['amazon', 'merchant-amazon'],
      ['daraz', 'merchant-daraz'],
    ]),
    knownCurrencies: new Map([
      ['USD', 'currency-usd'],
      ['PKR', 'currency-pkr'],
    ]),
    ...overrides,
  };
}

function row(overrides: Partial<IntakeRowInput> = {}): IntakeRowInput {
  return {
    rowNumber: 2,
    name: 'Test Headphones',
    slug: 'test-headphones',
    brand: 'TestBrand',
    category: 'Audio',
    price: '49.99',
    currency: 'USD',
    merchant: 'amazon',
    ...overrides,
  };
}

const VALID_CSV = [
  'name,slug,brand,category,price,currency,merchant',
  'Test Headphones,test-headphones,TestBrand,Audio,49.99,USD,amazon',
  '"Quoted, Buds",quoted-buds,TestBrand,Audio,19.99,USD,daraz',
].join('\n');

describe('parseIntakeCsv', () => {
  it('parses valid rows, including quoted fields with commas', () => {
    const { rows, headerErrors } = parseIntakeCsv(VALID_CSV);
    expect(headerErrors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      rowNumber: 2,
      name: 'Test Headphones',
      slug: 'test-headphones',
      price: '49.99',
      currency: 'USD',
      merchant: 'amazon',
    });
    expect(rows[1].name).toBe('Quoted, Buds');
    expect(rows[1].rowNumber).toBe(3);
  });

  it('reports a missing required header column instead of dropping rows', () => {
    const { rows, headerErrors } = parseIntakeCsv(
      'name,slug,brand,category,price,currency\nTest,test,Brand,Audio,10,USD',
    );
    expect(rows).toHaveLength(1);
    expect(headerErrors).toHaveLength(1);
    expect(headerErrors[0]).toMatchObject({ row: 1, field: 'merchant' });
  });

  it('keeps short rows so validation can report them per row', () => {
    const { rows } = parseIntakeCsv(
      'name,slug,brand,category,price,currency,merchant\nOnly A Name',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Only A Name');
    expect(rows[0].slug).toBe('');
  });

  it('returns no rows for an empty file', () => {
    expect(parseIntakeCsv('').rows).toEqual([]);
  });
});

describe('reviewIntakeRows — valid rows', () => {
  it('marks a complete valid row as valid with parsed price and resolved ids', () => {
    const review = reviewIntakeRows([row()], context());
    expect(review.summary).toEqual({
      total: 1,
      valid: 1,
      errors: 0,
      duplicates: 0,
      nearDuplicates: 0,
    });
    expect(review.rows[0].status).toBe('valid');
    expect(review.rows[0].data).toMatchObject({
      price: 49.99,
      currency: 'USD',
      currencyId: 'currency-usd',
      merchantId: 'merchant-amazon',
      slug: 'test-headphones',
    });
  });
});

describe('reviewIntakeRows — per-row errors for each required field', () => {
  const cases: Array<{
    label: string;
    overrides: Partial<IntakeRowInput>;
    field: string;
  }> = [
    { label: 'missing name', overrides: { name: '' }, field: 'name' },
    { label: 'missing slug', overrides: { slug: '' }, field: 'slug' },
    { label: 'missing brand', overrides: { brand: '' }, field: 'brand' },
    { label: 'missing category', overrides: { category: '' }, field: 'category' },
    { label: 'missing price', overrides: { price: '' }, field: 'price' },
    { label: 'missing currency', overrides: { currency: '' }, field: 'currency' },
    { label: 'missing merchant', overrides: { merchant: '' }, field: 'merchant' },
  ];

  for (const { label, overrides, field } of cases) {
    it(`rejects a row with ${label}`, () => {
      const review = reviewIntakeRows([row(overrides)], context());
      expect(review.rows[0].status).toBe('error');
      expect(review.rows[0].errors).toContainEqual(
        expect.objectContaining({ row: 2, field }),
      );
      expect(review.rows[0].data).toBeNull();
    });
  }

  it('rejects an invalid slug format', () => {
    const review = reviewIntakeRows(
      [row({ slug: 'Bad Slug!' })],
      context(),
    );
    expect(review.rows[0].status).toBe('error');
    expect(review.rows[0].errors).toContainEqual(
      expect.objectContaining({ field: 'slug' }),
    );
  });

  it('rejects a non-numeric price', () => {
    const review = reviewIntakeRows([row({ price: 'free' })], context());
    expect(review.rows[0].errors).toContainEqual(
      expect.objectContaining({ field: 'price' }),
    );
  });

  it('rejects a zero or negative price', () => {
    for (const price of ['0', '-5']) {
      const review = reviewIntakeRows([row({ price })], context());
      expect(review.rows[0].status).toBe('error');
      expect(review.rows[0].errors).toContainEqual(
        expect.objectContaining({ field: 'price' }),
      );
    }
  });

  it('rejects a malformed currency code', () => {
    const review = reviewIntakeRows([row({ currency: 'US' })], context());
    expect(review.rows[0].errors).toContainEqual(
      expect.objectContaining({ field: 'currency' }),
    );
  });

  it('rejects an unknown currency code — never invents one', () => {
    const review = reviewIntakeRows([row({ currency: 'XXX' })], context());
    expect(review.rows[0].errors).toContainEqual(
      expect.objectContaining({ field: 'currency' }),
    );
  });

  it('rejects an unknown merchant — never auto-creates one', () => {
    const review = reviewIntakeRows(
      [row({ merchant: 'no-such-store' })],
      context(),
    );
    expect(review.rows[0].errors).toContainEqual(
      expect.objectContaining({ field: 'merchant' }),
    );
  });

  it('reports multiple bad fields on the same row, each with row + field + reason', () => {
    const review = reviewIntakeRows(
      [row({ name: '', price: 'nope', merchant: '' })],
      context(),
    );
    expect(review.rows[0].errors).toHaveLength(3);
    for (const error of review.rows[0].errors) {
      expect(error.row).toBe(2);
      expect(error.field).toBeTruthy();
      expect(error.reason).toBeTruthy();
    }
  });
});

describe('reviewIntakeRows — dedup', () => {
  it('flags a row whose slug already exists as a duplicate', () => {
    const review = reviewIntakeRows([row({ slug: 'macbook-air-13' })], context());
    expect(review.rows[0].status).toBe('duplicate');
    expect(review.rows[0].duplicateOf).toBe('macbook-air-13');
  });

  it('flags the second row repeating a slug within the same file', () => {
    const review = reviewIntakeRows(
      [row({ rowNumber: 2 }), row({ rowNumber: 3 })],
      context(),
    );
    expect(review.rows[0].status).toBe('valid');
    expect(review.rows[1].status).toBe('duplicate');
  });

  it('flags a row with the same name + brand as an existing product as near-duplicate', () => {
    const review = reviewIntakeRows(
      [row({ name: 'MacBook Air 13', brand: 'Apple', slug: 'macbook-air-13-m2' })],
      context(),
    );
    expect(review.rows[0].status).toBe('near-duplicate');
    expect(review.rows[0].nearDuplicateOf).toBe('macbook-air-13');
  });

  it('matches near-duplicates case- and punctuation-insensitively', () => {
    const review = reviewIntakeRows(
      [row({ name: '  MACBOOK  Air--13 ', brand: 'APPLE', slug: 'other-slug' })],
      context(),
    );
    expect(review.rows[0].status).toBe('near-duplicate');
  });

  it('flags the second row repeating name + brand within the same file', () => {
    const review = reviewIntakeRows(
      [row({ rowNumber: 2 }), row({ rowNumber: 3, slug: 'test-headphones-2' })],
      context(),
    );
    expect(review.rows[0].status).toBe('valid');
    expect(review.rows[1].status).toBe('near-duplicate');
  });

  it('does not flag a different product from the same brand', () => {
    const review = reviewIntakeRows(
      [row({ name: 'Other Earbuds', brand: 'TestBrand', slug: 'other-earbuds' })],
      context(),
    );
    expect(review.rows[0].status).toBe('valid');
  });
});

describe('planIntakeInsert — nothing is inserted before approve', () => {
  it('review alone produces no insert plans', () => {
    const review = reviewIntakeRows([row()], context());
    // The review payload carries no insert payloads by construction.
    expect(review.rows[0]).not.toHaveProperty('product');
    expect(review.rows[0]).not.toHaveProperty('merchantProduct');
    expect(INTAKE_SOURCE).toBe('manual-intake');
  });

  it('plans an insert only for valid rows', () => {
    const review = reviewIntakeRows(
      [
        row({ rowNumber: 2 }),
        row({ rowNumber: 3, slug: 'macbook-air-13' }),
        row({ rowNumber: 4, name: '' }),
      ],
      context(),
    );
    const plans = planIntakeInsert(review.rows);
    expect(plans).toHaveLength(1);
    expect(plans[0].product.slug).toBe('test-headphones');
    expect(plans[0].merchantProduct.price).toBe(49.99);
    expect(plans[0].rowNumber).toBe(2);
  });

  it('excludes near-duplicates unless the admin explicitly includes the row', () => {
    const review = reviewIntakeRows(
      [row({ name: 'MacBook Air 13', brand: 'Apple', slug: 'macbook-air-13-m2' })],
      context(),
    );
    expect(review.rows[0].status).toBe('near-duplicate');
    expect(planIntakeInsert(review.rows)).toHaveLength(0);

    const included = planIntakeInsert(
      review.rows.map((r) => ({ ...r, include: true })),
    );
    expect(included).toHaveLength(1);
    expect(included[0].product.slug).toBe('macbook-air-13-m2');
  });

  it('never inserts duplicates or error rows even when include is set', () => {
    const review = reviewIntakeRows(
      [
        row({ rowNumber: 2, slug: 'macbook-air-13' }),
        row({ rowNumber: 3, name: '' }),
      ],
      context(),
    );
    const forced = planIntakeInsert(
      review.rows.map((r) => ({ ...r, include: true })),
    );
    expect(forced).toHaveLength(0);
  });
});
