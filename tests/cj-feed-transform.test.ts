/**
 * Unit tests for the CJ feed transform (lib/offers/cj-feed-transform).
 * Pure functions — no database, no network, no file access except
 * the checked-in sample fixture.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import {
  explicitCurrencyCode,
  normalizeAvailability,
  normalizeFeedHeader,
  normalizeFeedHeaders,
  normalizeGtinValue,
  isValidImageUrl,
  parseAmountText,
  parseFeedPrice,
  transformFeedRow,
  type FeedRecord,
  type TransformContext,
} from '@/lib/offers/cj-feed-transform';

const CTX: TransformContext = {
  network: 'cj',
  advertiserId: '3992613',
  advertiserName: 'DHGate',
  onlyWithGtin: false,
  psaApproved: false,
  syncedAt: '2026-11-21T00:00:00.000Z',
};

function record(overrides: FeedRecord = {}): FeedRecord {
  return {
    id: 'DH-1',
    title: 'Test Widget',
    description: 'A test widget.',
    link: 'https://example.com/buy/DH-1',
    image_link: 'https://images.example.com/DH-1.jpg',
    availability: 'in stock',
    price: '29.99 USD',
    sale_price: '',
    gtin: '012345678905',
    mpn: 'W-100',
    brand: 'TestBrand',
    google_product_category: 'Electronics',
    product_type: 'Widgets',
    condition: 'new',
    ...overrides,
  };
}

describe('normalizeFeedHeader', () => {
  it('maps UPPERCASE Google Shopping headers to lowercase canonical names', () => {
    expect(normalizeFeedHeader('GOOGLE_PRODUCT_CATEGORY')).toBe('google_product_category');
    expect(normalizeFeedHeader('IMAGE_LINK')).toBe('image_link');
    expect(normalizeFeedHeader('ID')).toBe('id');
    expect(normalizeFeedHeader('SALE_PRICE')).toBe('sale_price');
  });

  it('leaves lowercase headers unchanged', () => {
    expect(normalizeFeedHeader('gtin')).toBe('gtin');
    expect(normalizeFeedHeader('price')).toBe('price');
  });

  it('collapses spaces and hyphens', () => {
    expect(normalizeFeedHeader('Sale Price')).toBe('sale_price');
    expect(normalizeFeedHeader('image-link')).toBe('image_link');
  });
});

describe('normalizeFeedHeaders', () => {
  it('maps the sample fixture header row to canonical fields', () => {
    const map = normalizeFeedHeaders([
      'ID', 'TITLE', 'LINK', 'IMAGE_LINK', 'AVAILABILITY', 'PRICE',
      'GOOGLE_PRODUCT_CATEGORY', 'GTIN', 'MPN', 'CONDITION', 'PROGRAM_NAME',
    ]);
    expect(map.ID).toBe('id');
    expect(map.GOOGLE_PRODUCT_CATEGORY).toBe('google_product_category');
    expect(map.CONDITION).toBe('condition');
    // Unknown headers are dropped, never guessed.
    expect(map.PROGRAM_NAME).toBeUndefined();
  });
});

describe('parseAmountText', () => {
  it('disambiguates comma decimals from thousand separators', () => {
    expect(parseAmountText('29,99')).toBe(29.99);
    expect(parseAmountText('1,5')).toBe(1.5);
    expect(parseAmountText('1,299')).toBe(1299);
    expect(parseAmountText('12,345,678')).toBe(12345678);
    expect(parseAmountText('1,299.00')).toBe(1299);
    expect(parseAmountText('1.299,00')).toBe(1299);
    expect(parseAmountText('29.99')).toBe(29.99);
  });

  it('rejects malformed figures instead of guessing', () => {
    expect(parseAmountText('29.99.99')).toBeNull();
    expect(parseAmountText('1,2,3')).toBeNull();
    expect(parseAmountText('')).toBeNull();
    expect(parseAmountText('abc')).toBeNull();
  });
});

describe('explicitCurrencyCode', () => {
  it('finds an explicit code and returns null for a bare figure', () => {
    expect(explicitCurrencyCode('19.99 EUR')).toBe('EUR');
    expect(explicitCurrencyCode('EUR 19.99')).toBe('EUR');
    expect(explicitCurrencyCode('19.99')).toBeNull();
    expect(explicitCurrencyCode('')).toBeNull();
    expect(explicitCurrencyCode(null)).toBeNull();
  });
});

describe('parseFeedPrice', () => {
  it('splits "29.99 USD" into amount + currency', () => {
    expect(parseFeedPrice('29.99 USD')).toEqual({ amount: 29.99, currency: 'USD' });
  });

  it('handles thousands separators and bare amounts', () => {
    expect(parseFeedPrice('1,299.00 USD')).toEqual({ amount: 1299, currency: 'USD' });
    expect(parseFeedPrice('29.99')).toEqual({ amount: 29.99, currency: 'USD' });
    expect(parseFeedPrice('$29.99')).toEqual({ amount: 29.99, currency: 'USD' });
    expect(parseFeedPrice('USD 29.99')).toEqual({ amount: 29.99, currency: 'USD' });
  });

  it('treats a comma as the decimal mark in European figures', () => {
    expect(parseFeedPrice('29,99 EUR')).toEqual({ amount: 29.99, currency: 'EUR' });
    expect(parseFeedPrice('EUR 29,99')).toEqual({ amount: 29.99, currency: 'EUR' });
    expect(parseFeedPrice('1.299,00 EUR')).toEqual({ amount: 1299, currency: 'EUR' });
  });

  it('returns null for blank or unparseable values', () => {
    expect(parseFeedPrice('')).toBeNull();
    expect(parseFeedPrice('   ')).toBeNull();
    expect(parseFeedPrice(null)).toBeNull();
    expect(parseFeedPrice('free')).toBeNull();
  });
});

describe('normalizeAvailability', () => {
  it('maps Google Shopping values to the DB enum', () => {
    expect(normalizeAvailability('in stock')).toBe('in_stock');
    expect(normalizeAvailability('in_stock')).toBe('in_stock');
    expect(normalizeAvailability('out of stock')).toBe('out_of_stock');
    expect(normalizeAvailability('preorder')).toBe('preorder');
    expect(normalizeAvailability('backorder')).toBe('backorder');
  });

  it('returns null for unknown or blank values', () => {
    expect(normalizeAvailability('available soon')).toBeNull();
    expect(normalizeAvailability('')).toBeNull();
    expect(normalizeAvailability(null)).toBeNull();
  });
});

describe('normalizeGtinValue', () => {
  it('accepts GS1-valid GTINs and strips separators', () => {
    expect(normalizeGtinValue('012345678905')).toBe('012345678905');
    expect(normalizeGtinValue('978-0-2013-7962-4')).toBe('9780201379624');
  });

  it('returns null for invalid, empty or missing GTINs — never a guess', () => {
    expect(normalizeGtinValue('1234567890123')).toBeNull(); // bad check digit
    expect(normalizeGtinValue('ABC')).toBeNull();
    expect(normalizeGtinValue('')).toBeNull();
    expect(normalizeGtinValue(null)).toBeNull();
  });
});

describe('isValidImageUrl', () => {
  it('accepts http(s) URLs with a host', () => {
    expect(isValidImageUrl('https://images.example.com/a.jpg')).toBe(true);
    expect(isValidImageUrl('http://images.example.com/a.png')).toBe(true);
  });

  it('rejects blank, relative and non-http values', () => {
    expect(isValidImageUrl('')).toBe(false);
    expect(isValidImageUrl('/images/a.jpg')).toBe(false);
    expect(isValidImageUrl('ftp://example.com/a.jpg')).toBe(false);
    expect(isValidImageUrl('not a url')).toBe(false);
    expect(isValidImageUrl(null)).toBe(false);
  });
});

describe('transformFeedRow', () => {
  it('transforms a valid row and keeps is_public_live false by default', () => {
    const result = transformFeedRow(record(), CTX);
    expect(result.skipReason).toBeNull();
    expect(result.row).toMatchObject({
      network: 'cj',
      advertiser_id: '3992613',
      advertiser_name: 'DHGate',
      external_product_id: 'DH-1',
      gtin: '012345678905',
      mpn: 'W-100',
      brand: 'TestBrand',
      title: 'Test Widget',
      image_url: 'https://images.example.com/DH-1.jpg',
      affiliate_url: 'https://example.com/buy/DH-1',
      price: 29.99,
      sale_price: null,
      currency: 'USD',
      availability: 'in_stock',
      category: 'Electronics',
      is_public_live: false,
    });
    expect(result.hasIdentifier).toBe(true);
  });

  it('sets is_public_live true only when PSA is approved', () => {
    const result = transformFeedRow(record(), { ...CTX, psaApproved: true });
    expect(result.row?.is_public_live).toBe(true);
  });

  it('parses sale_price when present and valid', () => {
    const result = transformFeedRow(record({ sale_price: '19.99 USD' }), CTX);
    expect(result.row?.sale_price).toBe(19.99);
  });

  it('drops an unparseable sale_price instead of failing the row', () => {
    const result = transformFeedRow(record({ sale_price: 'free' }), CTX);
    expect(result.skipReason).toBeNull();
    expect(result.row?.sale_price).toBeNull();
    expect(result.row?.price).toBe(29.99);
  });

  it('drops a sale_price whose explicit currency differs from the list price', () => {
    const eur = transformFeedRow(
      record({ price: '29.99 EUR', sale_price: '19.99 USD' }),
      CTX,
    );
    expect(eur.skipReason).toBeNull();
    expect(eur.row?.sale_price).toBeNull();
    expect(eur.row?.price).toBe(29.99);
    expect(eur.row?.currency).toBe('EUR');
    const usd = transformFeedRow(
      record({ price: '29.99', sale_price: '19.99 EUR' }),
      CTX,
    );
    expect(usd.row?.sale_price).toBeNull();
  });

  it('keeps a sale_price in the same currency, or a bare figure that inherits it', () => {
    const same = transformFeedRow(
      record({ price: '29.99 EUR', sale_price: '19.99 EUR' }),
      CTX,
    );
    expect(same.row?.sale_price).toBe(19.99);
    const bare = transformFeedRow(
      record({ price: '29.99 EUR', sale_price: '19.99' }),
      CTX,
    );
    expect(bare.row?.sale_price).toBe(19.99);
    expect(bare.row?.currency).toBe('EUR');
  });

  it('skips rows that are not in stock', () => {
    expect(transformFeedRow(record({ availability: 'out of stock' }), CTX).skipReason).toBe(
      'not-in-stock',
    );
    expect(transformFeedRow(record({ availability: 'preorder' }), CTX).skipReason).toBe(
      'not-in-stock',
    );
  });

  it('skips rows with missing or zero price', () => {
    expect(transformFeedRow(record({ price: '' }), CTX).skipReason).toBe('invalid-price');
    expect(transformFeedRow(record({ price: '0.00 USD' }), CTX).skipReason).toBe('invalid-price');
    expect(transformFeedRow(record({ price: 'free' }), CTX).skipReason).toBe('invalid-price');
  });

  it('skips rows with a missing or invalid image', () => {
    expect(transformFeedRow(record({ image_link: '' }), CTX).skipReason).toBe('invalid-image');
    expect(transformFeedRow(record({ image_link: 'not a url' }), CTX).skipReason).toBe(
      'invalid-image',
    );
  });

  it('skips rows with a missing id', () => {
    expect(transformFeedRow(record({ id: '' }), CTX).skipReason).toBe('missing-id');
  });

  it('skips rows with a missing title', () => {
    expect(transformFeedRow(record({ title: '' }), CTX).skipReason).toBe('missing-title');
    expect(transformFeedRow(record({ title: '   ' }), CTX).skipReason).toBe(
      'missing-title',
    );
  });

  it('skips rows with a missing or invalid affiliate link', () => {
    expect(transformFeedRow(record({ link: '' }), CTX).skipReason).toBe(
      'invalid-affiliate-url',
    );
    expect(transformFeedRow(record({ link: 'not a url' }), CTX).skipReason).toBe(
      'invalid-affiliate-url',
    );
    expect(transformFeedRow(record({ link: 'ftp://example.com/buy' }), CTX).skipReason).toBe(
      'invalid-affiliate-url',
    );
  });

  it('drops an invalid GTIN but keeps the row on its MPN', () => {
    const result = transformFeedRow(record({ gtin: '1234567890123' }), CTX);
    expect(result.skipReason).toBeNull();
    expect(result.row?.gtin).toBeNull();
    expect(result.row?.mpn).toBe('W-100');
    expect(result.hasIdentifier).toBe(true);
  });

  it('with --only-with-gtin, skips rows without a valid GTIN', () => {
    const ctx = { ...CTX, onlyWithGtin: true };
    expect(transformFeedRow(record({ gtin: '' }), ctx).skipReason).toBe('no-gtin');
    expect(transformFeedRow(record({ gtin: '1234567890123' }), ctx).skipReason).toBe('no-gtin');
    expect(transformFeedRow(record(), ctx).skipReason).toBeNull();
  });

  it('reads UPPERCASE headers through the case-insensitive fallback', () => {
    const upper: FeedRecord = {
      ID: 'DH-2',
      TITLE: 'Upper Widget',
      LINK: 'https://example.com/buy/DH-2',
      IMAGE_LINK: 'https://images.example.com/DH-2.jpg',
      AVAILABILITY: 'in stock',
      PRICE: '10.00 USD',
      GTIN: '012345678905',
    };
    const result = transformFeedRow(upper, CTX);
    expect(result.skipReason).toBeNull();
    expect(result.row?.external_product_id).toBe('DH-2');
    expect(result.row?.price).toBe(10);
  });
});

describe('CJ sample fixture (tests/fixtures/cj-sample-shopping.csv)', () => {
  function loadFixture(): FeedRecord[] {
    const file = path.resolve(__dirname, 'fixtures/cj-sample-shopping.csv');
    const text = fs.readFileSync(file, 'utf8');
    return parse(text, {
      columns: (header: string[]) => header.map(normalizeFeedHeader),
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }) as FeedRecord[];
  }

  it('has 7 data rows with UPPERCASE headers including CONDITION', () => {
    const rows = loadFixture();
    expect(rows).toHaveLength(7);
    expect(Object.keys(rows[0])).toContain('condition');
    expect(rows[0].id).toBe('TV_123456');
  });

  it('accepts 6 rows and skips 1 out-of-stock row', () => {
    const rows = loadFixture();
    const results = rows.map((row) => transformFeedRow(row, CTX));
    const accepted = results.filter((r) => r.row !== null);
    const skipped = results.filter((r) => r.row === null);
    expect(accepted).toHaveLength(6);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].skipReason).toBe('not-in-stock');
  });

  it('accepts 4 rows with --only-with-gtin (the 4 GS1-valid GTINs)', () => {
    const rows = loadFixture();
    const results = rows.map((row) => transformFeedRow(row, { ...CTX, onlyWithGtin: true }));
    expect(results.filter((r) => r.row !== null)).toHaveLength(4);
    expect(results.filter((r) => r.skipReason === 'no-gtin')).toHaveLength(2);
    expect(results.filter((r) => r.skipReason === 'not-in-stock')).toHaveLength(1);
  });

  it('parses the fixture sale prices exactly', () => {
    const rows = loadFixture();
    const byId = new Map(
      rows.map((row) => [row.id, transformFeedRow(row, CTX).row]),
    );
    expect(byId.get('CLO-1029384')?.sale_price).toBe(25.49);
    expect(byId.get('146925')?.sale_price).toBe(225);
    expect(byId.get('TV_123456')?.sale_price).toBeNull();
    expect(byId.get('TV_123456')?.price).toBe(159);
  });
});
