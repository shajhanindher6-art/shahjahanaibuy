/**
 * Section 20 — pipeline gates + validation + schema (§12 #26, #31,
 * #32, #94, #28, #29, #39, #44, #41, #43, #42).
 *
 * Covers, with no DB and no network:
 * - lib/gtin.ts — GS1 check-digit validation + normalization
 * - lib/image-url.ts — review-time image URL validation
 * - lib/spec-templates.ts — category spec templates + validation
 * - services/price-history-quality.ts — coverage, per-source
 *   reliability, suspicious-change assessment, 42703-safe insert
 * - services/product-attributes.ts — attributed spec rows +
 *   42703-safe insert
 * - services/pipeline/validation.ts — GTIN / image wiring
 * - services/pipeline/ingestion.ts — minimum-confidence gate,
 *   price-0 rejection on create, born-pending insert + 42703 retry
 * - services/price-refresh.ts — listing currency (not hardcoded
 *   USD), suspicious-change flag on insert, no freshness stamp on
 *   a DB re-read
 * - services/catalog-intake.ts + services/ebay-intake.ts — GTIN
 *   and image validation at review; eBay drops a bad image URL
 *
 * Migrations 056/057/058 are SQL files (written, NOT applied);
 * their shape is asserted here only as far as pure code can —
 * the CREATE statements are verified by reading the files, not
 * by executing them.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateGtin, normalizeGtin, isValidGtin } from '@/lib/gtin';
import { validateImageUrl, IMAGE_URL_MAX_LENGTH } from '@/lib/image-url';
import {
  SPEC_TEMPLATES,
  specKeysForCategory,
  validateSpecEntries,
} from '@/lib/spec-templates';
import {
  computeHistoryCoverage,
  computeSourceReliability,
  assessPriceChange,
  insertPriceHistoryRow,
} from '@/services/price-history-quality';
import {
  buildProductAttributeRow,
  insertProductAttributes,
} from '@/services/product-attributes';
import { validateRawProduct } from '@/services/pipeline/validation';
import { reviewIntakeRows, type IntakeCatalogContext } from '@/services/catalog-intake';
import { mapEbayListingToIntakeRow } from '@/services/ebay-intake';
import { getAdminDataQualitySummary } from '@/services/admin-data-quality';
import type { AnySupabaseClient } from '@/lib/supabase/types';

// ---------------------------------------------------------------------------
// lib/gtin.ts
// ---------------------------------------------------------------------------

describe('validateGtin (GS1 check digit)', () => {
  it.each([
    ['96385074', 'GTIN-8'],
    ['036000291452', 'GTIN-12 (UPC-A)'],
    ['4006381333931', 'GTIN-13 (EAN-13)'],
    ['14006381333938', 'GTIN-14'],
    ['9780201379624', 'GTIN-13 (ISBN-13 form)'],
  ])('accepts a valid %s', (gtin) => {
    expect(validateGtin(gtin)).toEqual({ valid: true, normalized: gtin, reason: null });
    expect(isValidGtin(gtin)).toBe(true);
  });

  it('accepts separators and normalizes to digits only', () => {
    expect(validateGtin('978-0-2013-7962-4').normalized).toBe('9780201379624');
    expect(validateGtin(' 4006 3813 3393 1 ').normalized).toBe('4006381333931');
  });

  it('rejects a wrong check digit', () => {
    // The old Section 20 fixture GTIN: right length, wrong digit.
    const result = validateGtin('027242920918');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('check digit');
  });

  it('rejects unsupported lengths and non-digits', () => {
    expect(validateGtin('1234567').valid).toBe(false); // 7 digits
    expect(validateGtin('123456789').valid).toBe(false); // 9 digits
    expect(validateGtin('1'.repeat(50)).valid).toBe(false); // 50 chars
    expect(validateGtin('40063813339A1').valid).toBe(false);
    expect(validateGtin('').valid).toBe(false);
    expect(validateGtin(null).valid).toBe(false);
  });

  it('normalizeGtin maps absence to null', () => {
    expect(normalizeGtin(null)).toBeNull();
    expect(normalizeGtin('   ')).toBeNull();
    expect(normalizeGtin('978-0-2013-7962-4')).toBe('9780201379624');
  });
});

// ---------------------------------------------------------------------------
// lib/image-url.ts
// ---------------------------------------------------------------------------

describe('validateImageUrl', () => {
  it('accepts https (and http) URLs with a real hostname', () => {
    expect(validateImageUrl('https://i.ebayimg.com/fake-1.jpg').valid).toBe(true);
    expect(validateImageUrl('https://images.unsplash.com/photo-1?w=800').valid).toBe(true);
    expect(validateImageUrl('  https://example.com/a.jpg  ').normalized).toBe(
      'https://example.com/a.jpg'
    );
  });

  it('rejects data: / javascript: / blob: / ftp: / relative URLs', () => {
    for (const url of [
      'data:image/png;base64,iVBORw0KGgo=',
      'javascript:alert(1)',
      'blob:https://example.com/abc',
      'ftp://example.com/a.jpg',
      '/local/a.jpg',
      '//example.com/a.jpg',
      'not-a-url',
    ]) {
      expect(validateImageUrl(url).valid, url).toBe(false);
    }
  });

  it('rejects over-long URLs, credentials and bare hostnames', () => {
    expect(validateImageUrl(`https://example.com/${'a'.repeat(IMAGE_URL_MAX_LENGTH)}`).valid).toBe(
      false
    );
    expect(validateImageUrl('https://user:pass@example.com/a.jpg').valid).toBe(false);
    expect(validateImageUrl('https://localhost/a.jpg').valid).toBe(false);
    expect(validateImageUrl('https://example/a.jpg').valid).toBe(false);
    expect(validateImageUrl('').valid).toBe(false);
    expect(validateImageUrl(null).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lib/spec-templates.ts
// ---------------------------------------------------------------------------

describe('spec templates', () => {
  it('defines the audit key lists for laptop / smartphone / tablet', () => {
    expect(specKeysForCategory('laptop')).toEqual([
      'processor',
      'ram',
      'storage',
      'display',
      'graphics',
      'battery',
      'os',
    ]);
    expect(specKeysForCategory('smartphone')).toEqual([
      'processor',
      'ram',
      'storage',
      'display',
      'camera',
      'battery',
      'network',
    ]);
    expect(specKeysForCategory('tablet')).toEqual([
      'processor',
      'display',
      'storage',
      'ram',
      'battery',
      'connectivity',
    ]);
    // 'phone' is an accepted alias of smartphone.
    expect(specKeysForCategory('phone')).toEqual(specKeysForCategory('smartphone'));
    // Sections 21–25, Stage C (B10) — headphones / camera /
    // smartwatch / accessories / wearables / monitor gained
    // templates too (9 categories); headphones is no longer [].
    expect(specKeysForCategory('headphones')).toEqual([
      'driver',
      'battery',
      'noise_cancelling',
      'connectivity',
      'bluetooth',
      'weight',
    ]);
    expect(specKeysForCategory('camera')).toEqual([
      'sensor',
      'megapixels',
      'lens_mount',
      'video',
      'display',
      'battery',
      'weight',
    ]);
    expect(specKeysForCategory('smartwatch')).toEqual([
      'display',
      'battery',
      'sensors',
      'water_resistance',
      'connectivity',
      'weight',
    ]);
    expect(specKeysForCategory('accessories')).toEqual([
      'connectivity',
      'battery',
      'compatibility',
      'weight',
      'material',
    ]);
    expect(specKeysForCategory('monitor')).toEqual([
      'display',
      'resolution',
      'refresh_rate',
      'panel',
      'connectivity',
    ]);
    expect(specKeysForCategory('unknown-category-xyz')).toEqual([]);
    expect(SPEC_TEMPLATES.laptop.find((e) => e.key === 'ram')?.units).toEqual(['GB']);
  });

  it('validates key / value / unit on intake', () => {
    const ok = validateSpecEntries('laptop', [
      { key: 'ram', value: '16 GB' },
      { key: 'storage', value: '512', unit: 'GB' },
    ]);
    expect(ok.valid).toBe(true);
    expect(ok.validEntries).toHaveLength(2);

    const bad = validateSpecEntries('laptop', [
      { key: 'camera', value: '200 MP' },
      { key: 'ram', value: '' },
      { key: 'storage', value: '512', unit: 'MB' },
      { key: 'processor', value: 'M4', unit: 'GB' },
    ]);
    expect(bad.valid).toBe(false);
    expect(bad.errors).toHaveLength(4);
    expect(bad.validEntries).toHaveLength(0);
  });

  it('reports an unknown category instead of guessing', () => {
    const result = validateSpecEntries('toaster', [{ key: 'watts', value: '800' }]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('No spec template');
  });
});

// ---------------------------------------------------------------------------
// services/price-history-quality.ts
// ---------------------------------------------------------------------------

describe('computeHistoryCoverage', () => {
  it('counts points and spans days', () => {
    expect(
      computeHistoryCoverage([
        { price: 100, recordedAt: '2026-11-01T00:00:00Z' },
        { price: 95, recordedAt: '2026-11-11T00:00:00Z' },
      ])
    ).toEqual({
      points: 2,
      spanDays: 10,
      firstRecordedAt: '2026-11-01T00:00:00.000Z',
      lastRecordedAt: '2026-11-11T00:00:00.000Z',
    });
    expect(computeHistoryCoverage([])).toEqual({
      points: 0,
      spanDays: 0,
      firstRecordedAt: null,
      lastRecordedAt: null,
    });
  });
});

describe('computeSourceReliability', () => {
  it('groups by source and ratios non-suspicious points', () => {
    expect(
      computeSourceReliability([
        { price: 100, recordedAt: '2026-11-01T00:00:00Z', source: 'seed' },
        { price: 100, recordedAt: '2026-11-02T00:00:00Z', source: 'seed', suspicious: true },
        { price: 90, recordedAt: '2026-11-03T00:00:00Z', source: 'live' },
        { price: 90, recordedAt: '2026-11-04T00:00:00Z' },
      ])
    ).toEqual({
      seed: { points: 2, suspicious: 1, reliability: 0.5 },
      live: { points: 1, suspicious: 0, reliability: 1 },
      unknown: { points: 1, suspicious: 0, reliability: 1 },
    });
    expect(computeSourceReliability([])).toEqual({});
  });
});

describe('assessPriceChange', () => {
  const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}T00:00:00Z`;

  it('is clean for a small move on flat history', () => {
    const out = assessPriceChange(
      [
        { price: 100, recordedAt: day(1) },
        { price: 100, recordedAt: day(2) },
        { price: 98, recordedAt: day(3) },
      ],
      95,
      day(4)
    );
    expect(out.suspicious).toBe(false);
    expect(out.reasons).toEqual([]);
    expect(out.coverage.points).toBe(4);
  });

  it('flags a ≥25% single-step spike', () => {
    const out = assessPriceChange(
      [{ price: 100, recordedAt: day(1) }],
      200,
      day(2)
    );
    expect(out.suspicious).toBe(true);
    expect(out.spikePct).toBe(1);
    expect(out.reasons[0]).toContain('rose 100%');
  });

  it('flags the fake-sale pattern (rise, then a drop that stays above the pre-rise low)', () => {
    const out = assessPriceChange(
      [
        { price: 100, recordedAt: day(1) },
        { price: 120, recordedAt: day(2) },
      ],
      110,
      day(3)
    );
    expect(out.suspicious).toBe(true);
    expect(out.fakeSaleAlert).toBe(true);
  });

  it('does not flag a plain drop with no prior rise (the MacBook negative test)', () => {
    const out = assessPriceChange(
      [{ price: 1018.98, recordedAt: day(1) }],
      999,
      day(2)
    );
    expect(out.suspicious).toBe(false);
    expect(out.fakeSaleAlert).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// services/product-attributes.ts
// ---------------------------------------------------------------------------

describe('buildProductAttributeRow', () => {
  it('builds an attributed row for a templated spec', () => {
    const { row, errors } = buildProductAttributeRow(
      'prod-1',
      'laptop',
      { key: 'ram', value: '16 GB' },
      { source: 'manual-intake', verifiedBy: 'admin-1' }
    );
    expect(errors).toEqual([]);
    expect(row?.product_id).toBe('prod-1');
    expect(row?.key).toBe('ram');
    expect(row?.source).toBe('manual-intake');
    expect(row?.verified_by).toBe('admin-1');
    expect(row?.verified_at).toBeTruthy();
  });

  it('never stamps verified_at for unknown provenance', () => {
    const { row } = buildProductAttributeRow(
      'prod-1',
      'laptop',
      { key: 'ram', value: '16 GB' },
      { source: 'unknown', verifiedBy: 'admin-1' }
    );
    expect(row?.source).toBe('unknown');
    expect(row?.verified_at).toBeNull();
    const unattributed = buildProductAttributeRow('prod-1', 'laptop', {
      key: 'ram',
      value: '16 GB',
    });
    expect(unattributed.row?.source).toBeNull();
    expect(unattributed.row?.verified_at).toBeNull();
  });

  it('rejects a spec key the category template does not know', () => {
    const { row, errors } = buildProductAttributeRow(
      'prod-1',
      'laptop',
      { key: 'camera', value: '200 MP' },
      { source: 'manual-intake' }
    );
    expect(row).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 42703 fail-safe inserts (migration 057 / 058 unapplied)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeInsertClient(opts: {
  /** First insert into `table` fails with this code (then the retry runs). */
  failFirstWithCode?: string;
  /** Fail the first N inserts into `table` with `failFirstWithCode`. */
  failFirstN?: number;
  table?: string;
}): AnySupabaseClient & { inserts: Array<{ table: string; row: Row }> } {
  const inserts: Array<{ table: string; row: Row }> = [];
  let calls = 0;
  const client = {
    inserts,
    from(table: string) {
      return {
        insert(row: Row) {
          inserts.push({ table, row });
          calls += 1;
          const shouldFail =
            opts.table === table &&
            opts.failFirstWithCode !== undefined &&
            calls <= (opts.failFirstN ?? 1);
          return Promise.resolve({
            data: null,
            error: shouldFail
              ? { message: 'column does not exist', code: opts.failFirstWithCode }
              : null,
          });
        },
      };
    },
  };
  return client as unknown as AnySupabaseClient & {
    inserts: Array<{ table: string; row: Row }>;
  };
}

describe('insertPriceHistoryRow (42703 fail-safe)', () => {
  it('writes source / observed_at / suspicious_change when the columns exist', async () => {
    const client = fakeInsertClient({});
    const { error } = await insertPriceHistoryRow(client, {
      product_id: 'p1',
      retailer_id: 'r1',
      price: 90,
      currency: 'EUR',
      availability: 'in_stock',
      source: 'live',
      suspicious_change: true,
    });
    expect(error).toBeNull();
    expect(client.inserts).toHaveLength(1);
    expect(client.inserts[0].row).toMatchObject({
      source: 'live',
      suspicious_change: true,
      currency: 'EUR',
      // Final 100%, F-P1-58 — migration 060: the recorded code
      // travels with the history row, verbatim from `currency`.
      currency_code: 'EUR',
    });
    expect(client.inserts[0].row.observed_at).toBeTruthy();
  });

  it('retries without currency_code only on 42703 (provenance kept)', async () => {
    const client = fakeInsertClient({ failFirstWithCode: '42703', table: 'price_history' });
    const { error } = await insertPriceHistoryRow(client, {
      product_id: 'p1',
      retailer_id: 'r1',
      price: 90,
      currency: 'USD',
      availability: 'in_stock',
      source: 'live',
      suspicious_change: false,
    });
    expect(error).toBeNull();
    expect(client.inserts).toHaveLength(2);
    // Tier 2 keeps the 057 provenance columns and drops only the
    // 060 currency_code — a missing 060 column must not drop the
    // source/observed_at/suspicious_change the row already had.
    expect(client.inserts[1].row).toMatchObject({ price: 90, currency: 'USD', source: 'live' });
    expect(client.inserts[1].row).not.toHaveProperty('currency_code');
  });

  it('retries with legacy columns only when both newer tiers 42703', async () => {
    const client = fakeInsertClient({
      failFirstWithCode: '42703',
      failFirstN: 2,
      table: 'price_history',
    });
    const { error } = await insertPriceHistoryRow(client, {
      product_id: 'p1',
      retailer_id: 'r1',
      price: 90,
      currency: 'USD',
      availability: 'in_stock',
      source: 'live',
      suspicious_change: false,
    });
    expect(error).toBeNull();
    expect(client.inserts).toHaveLength(3);
    expect(client.inserts[2].row).not.toHaveProperty('source');
    expect(client.inserts[2].row).not.toHaveProperty('currency_code');
    expect(client.inserts[2].row).toMatchObject({ price: 90, currency: 'USD' });
  });

  it('returns a non-42703 error instead of retrying', async () => {
    const client = fakeInsertClient({ failFirstWithCode: '23505', table: 'price_history' });
    const { error } = await insertPriceHistoryRow(client, {
      product_id: 'p1',
      retailer_id: 'r1',
      price: 90,
      currency: 'USD',
      availability: 'in_stock',
    });
    expect(error?.code).toBe('23505');
    expect(client.inserts).toHaveLength(1);
  });
});

describe('insertProductAttributes (42703 fail-safe)', () => {
  it('retries without the migration-058 columns on 42703', async () => {
    const client = fakeInsertClient({
      failFirstWithCode: '42703',
      table: 'product_attributes',
    });
    const { error } = await insertProductAttributes(client, [
      {
        product_id: 'p1',
        key: 'ram',
        value: '16 GB',
        source: 'manual-intake',
        verified_at: '2026-11-13T00:00:00Z',
        verified_by: 'admin-1',
      },
    ]);
    expect(error).toBeNull();
    expect(client.inserts).toHaveLength(2);
    expect(client.inserts[1].row[0]).not.toHaveProperty('source');
    expect(client.inserts[1].row[0]).toMatchObject({ key: 'ram', value: '16 GB' });
  });
});

// ---------------------------------------------------------------------------
// Pipeline validation wiring (§12 #31 / #94)
// ---------------------------------------------------------------------------

describe('validateRawProduct GTIN + image wiring', () => {
  const base = {
    externalId: 'ext-1',
    retailerSlug: 'amazon',
    name: 'Widget',
    price: 299,
    currency: 'USD',
    availability: 'in_stock' as const,
  };

  it('accepts a check-digit-valid GTIN, rejects a bad check digit', () => {
    expect(validateRawProduct({ ...base, gtin: '4006381333931' }).success).toBe(true);
    const bad = validateRawProduct({ ...base, gtin: '027242920918' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.errors.gtin).toBeDefined();
  });

  it('rejects data: / javascript: image URLs', () => {
    const bad = validateRawProduct({
      ...base,
      images: ['data:image/png;base64,iVBORw0KGgo='],
    });
    expect(bad.success).toBe(false);
    const bad2 = validateRawProduct({ ...base, images: ['javascript:alert(1)'] });
    expect(bad2.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Catalog intake + eBay intake wiring (§12 #31 / #94)
// ---------------------------------------------------------------------------

function intakeContext(): IntakeCatalogContext {
  return {
    existingSlugs: new Set(),
    existingNameBrands: new Map(),
    knownMerchants: new Map([['amazon', 'm-amazon']]),
    knownCurrencies: new Map([['USD', 'cur-usd']]),
  };
}

describe('reviewIntakeRows GTIN + image validation', () => {
  const row = {
    rowNumber: 2,
    name: 'Widget',
    slug: 'widget',
    brand: 'Acme',
    category: 'Gadgets',
    price: '99',
    currency: 'USD',
    merchant: 'amazon',
  };

  it('flags a bad-check-digit GTIN as a row error and stores a normalized valid one', () => {
    const bad = reviewIntakeRows([{ ...row, gtin: '027242920918' }], intakeContext());
    expect(bad.rows[0].status).toBe('error');
    expect(bad.rows[0].errors.some((e) => e.field === 'gtin')).toBe(true);

    const good = reviewIntakeRows(
      [{ ...row, gtin: '978-0-2013-7962-4' }],
      intakeContext()
    );
    expect(good.rows[0].status).toBe('valid');
    expect(good.rows[0].data?.gtin).toBe('9780201379624');
  });

  it('flags a data: image URL as a row error', () => {
    const bad = reviewIntakeRows(
      [{ ...row, imageUrl: 'data:image/png;base64,AAAA' }],
      intakeContext()
    );
    expect(bad.rows[0].status).toBe('error');
    expect(bad.rows[0].errors.some((e) => e.field === 'image_url')).toBe(true);
  });
});

describe('mapEbayListingToIntakeRow image handling', () => {
  const fields = { brand: 'Sony', category: 'Headphones', slug: 'sony-x' };
  it('drops a data: image URL instead of storing it', () => {
    const row = mapEbayListingToIntakeRow(
      {
        itemId: 'v1',
        title: 'Sony X',
        price: 99,
        currency: 'USD',
        imageUrl: 'data:image/png;base64,AAAA',
        itemWebUrl: 'https://www.ebay.com/itm/1',
        condition: null,
      } as never,
      1,
      fields
    );
    expect(row.imageUrl).toBeUndefined();
  });

  it('keeps a valid https image URL', () => {
    const row = mapEbayListingToIntakeRow(
      {
        itemId: 'v1',
        title: 'Sony X',
        price: 99,
        currency: 'USD',
        imageUrl: 'https://i.ebayimg.com/fake-1.jpg',
        itemWebUrl: 'https://www.ebay.com/itm/1',
        condition: null,
      } as never,
      1,
      fields
    );
    expect(row.imageUrl).toBe('https://i.ebayimg.com/fake-1.jpg');
  });
});

// ---------------------------------------------------------------------------
// Ingestion gate (§12 #26) — module-mocked Supabase, same pattern as
// tests/section20-pipeline-units.test.ts
// ---------------------------------------------------------------------------

const ingestState = vi.hoisted(() => ({
  retailerExists: true,
  gtinMatchId: null as string | null,
  slugMatchId: null as string | null,
  productInsertError: null as { message: string; code?: string } | null,
  productInserts: [] as Row[],
  priceHistoryInserts: [] as Row[],
  productUpdates: [] as Row[],
}));

vi.mock('@supabase/supabase-js', () => {
  type IngRow = Record<string, unknown>;
  const state = ingestState;
  function chain(table: string) {
    const q: Record<string, unknown> = {
      select() {
        return q;
      },
      eq() {
        return q;
      },
      neq() {
        return q;
      },
      ilike() {
        return q;
      },
      is() {
        return q;
      },
      in() {
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      async maybeSingle() {
        if (table === 'retailers')
          return { data: state.retailerExists ? { id: 'retailer-1' } : null, error: null };
        if (table === 'products') {
          if (state.gtinMatchId) return { data: { id: state.gtinMatchId }, error: null };
          if (state.slugMatchId) return { data: { id: state.slugMatchId }, error: null };
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
      async single() {
        if (table === 'brands') return { data: { id: 'brand-1' }, error: null };
        if (table === 'categories') return { data: { id: 'cat-1' }, error: null };
        if (table === 'products') {
          if (state.productInsertError)
            return { data: null, error: state.productInsertError };
          return { data: { id: 'prod-1' }, error: null };
        }
        return { data: null, error: null };
      },
      insert(row: IngRow) {
        if (table === 'products') state.productInserts.push(row);
        if (table === 'price_history') state.priceHistoryInserts.push(row);
        return q;
      },
      update(patch: IngRow) {
        if (table === 'products') state.productUpdates.push(patch);
        return q;
      },
      upsert() {
        return q;
      },
      then(onF: (v: { data: IngRow[]; error: null }) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(onF);
      },
    };
    return q;
  }
  return {
    createClient: () => ({
      from: (table: string) => chain(table),
    }),
  };
});

const FULL_RAW = {
  externalId: 'ext-sony-1',
  retailerSlug: 'amazon',
  name: 'Sony WH-1000XM5',
  description: 'Noise cancelling headphones',
  brand: 'Sony',
  category: 'Electronics > Headphones',
  gtin: '027242920910',
  images: ['https://images.unsplash.com/photo-1505740420928-5e560c06d30e'],
  price: 299,
  currency: 'USD',
  availability: 'in_stock' as const,
  url: 'https://www.amazon.com/dp/B09XS7JWHH',
};

describe('ingestProduct gate (§12 #26)', () => {
  beforeEach(() => {
    ingestState.retailerExists = true;
    ingestState.gtinMatchId = null;
    ingestState.slugMatchId = null;
    ingestState.productInsertError = null;
    ingestState.productInserts.length = 0;
    ingestState.priceHistoryInserts.length = 0;
    ingestState.productUpdates.length = 0;
  });

  it('rejects a thin new product (name only, price 0) before any write', async () => {
    const { ingestProduct } = await import('@/services/pipeline/ingestion');
    const result = await ingestProduct(
      {
        externalId: 'ext-thin',
        retailerSlug: 'amazon',
        name: 'Widget',
        price: 0,
        currency: 'USD',
        availability: 'unknown',
      } as never,
      'test-provider'
    );
    expect(result.success).toBe(false);
    expect(result.action).toBe('rejected');
    expect(result.errors?.join(' ')).toContain('confidence score 15');
    expect(ingestState.productInserts).toHaveLength(0);
  });

  it('creates a full product as born-pending + unverified', async () => {
    const { ingestProduct } = await import('@/services/pipeline/ingestion');
    const result = await ingestProduct(FULL_RAW, 'test-provider');
    expect(result.success).toBe(true);
    expect(result.action).toBe('created');
    expect(ingestState.productInserts).toHaveLength(1);
    expect(ingestState.productInserts[0]).toMatchObject({
      status: 'pending',
      price_verification_status: 'unverified',
    });
  });

  it('records the price point with merchant-feed provenance', async () => {
    const { ingestProduct } = await import('@/services/pipeline/ingestion');
    await ingestProduct(FULL_RAW, 'test-provider');
    expect(ingestState.priceHistoryInserts).toHaveLength(1);
    expect(ingestState.priceHistoryInserts[0]).toMatchObject({
      currency: 'USD',
      source: 'merchant-feed',
      suspicious_change: false,
    });
  });

  it('retries the product insert without the 045 columns on 42703', async () => {
    ingestState.productInsertError = { message: 'column "status" does not exist', code: '42703' };
    const { ingestProduct } = await import('@/services/pipeline/ingestion');
    // The mock answers 42703 on EVERY products single() call, so
    // the retry also fails — but the retry must have happened
    // (two product inserts recorded: with-status, then legacy).
    const result = await ingestProduct(FULL_RAW, 'test-provider');
    expect(result.success).toBe(false);
    expect(ingestState.productInserts).toHaveLength(2);
    expect(ingestState.productInserts[0]).toHaveProperty('status', 'pending');
    expect(ingestState.productInserts[1]).not.toHaveProperty('status');
  });
});

// ---------------------------------------------------------------------------
// services/price-refresh.ts — currency (§12 #41), suspicious flag
// (§12 #42), no freshness stamp on a DB re-read (§12 #43)
// ---------------------------------------------------------------------------

type FRow = Record<string, unknown>;

class RefreshFakeQuery {
  private filters: Array<(row: FRow) => boolean> = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private insertRows: FRow[] = [];
  private patch: FRow = {};

  constructor(
    private readonly tables: Record<string, FRow[]>,
    private readonly table: string,
    private readonly updates: Array<{ table: string; patch: FRow }>
  ) {}

  select(): this {
    return this;
  }
  eq(col: string, value: unknown): this {
    this.filters.push((r) => r[col] === value);
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
  order(col: string, opts: { ascending: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts.ascending;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  insert(rowOrRows: FRow | FRow[]): this {
    this.op = 'insert';
    this.insertRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    return this;
  }
  update(patch: FRow): this {
    this.op = 'update';
    this.patch = patch;
    return this;
  }
  delete(): this {
    this.op = 'delete';
    return this;
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: unknown }> {
    const rows = this.tables[this.table] ?? [];
    if (this.op === 'insert') {
      rows.push(...this.insertRows.map((r) => ({ ...r })));
      return { data: this.insertRows, error: null };
    }
    if (this.op === 'update') {
      const matched = rows.filter((r) => this.filters.every((f) => f(r)));
      for (const row of matched) Object.assign(row, this.patch);
      this.updates.push({ table: this.table, patch: { ...this.patch } });
      return { data: matched, error: null };
    }
    if (this.op === 'delete') {
      const kept = rows.filter((r) => !this.filters.every((f) => f(r)));
      this.tables[this.table] = kept;
      return { data: [], error: null };
    }
    let out = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      out = [...out].sort((a, b) =>
        asc
          ? String(a[col] ?? '') < String(b[col] ?? '')
            ? -1
            : 1
          : String(a[col] ?? '') > String(b[col] ?? '')
            ? -1
            : 1
      );
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return { data: out, error: null };
  }
}

function refreshFakeClient(seed: Record<string, FRow[]>): {
  client: AnySupabaseClient;
  tables: Record<string, FRow[]>;
  updates: Array<{ table: string; patch: FRow }>;
} {
  const tables: Record<string, FRow[]> = Object.fromEntries(
    Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))])
  );
  const updates: Array<{ table: string; patch: FRow }> = [];
  const client = {
    from: (table: string) => new RefreshFakeQuery(tables, table, updates),
  };
  return { client: client as unknown as AnySupabaseClient, tables, updates };
}

describe('refreshTrackedPrices (§12 #41/#42/#43)', () => {
  it('records the listing currency (EUR), not hardcoded USD', async () => {
    const { refreshTrackedPrices } = await import('@/services/price-refresh');
    const { client, tables } = refreshFakeClient({
      alerts: [{ product_id: 'p1', active: true }],
      wishlist_items: [],
      merchant_products: [
        {
          product_id: 'p1',
          merchant_id: 'm1',
          price: 90,
          availability: 'in_stock',
          url: 'https://example.com/p1',
          in_stock: true,
          deleted_at: null,
          currency_id: 'cur-eur',
        },
      ],
      merchants: [{ id: 'm1', slug: 'amazon' }],
      retailers: [{ id: 'r1', slug: 'amazon' }],
      price_history: [
        { product_id: 'p1', retailer_id: 'r1', price: 100, availability: 'in_stock', recorded_at: '2026-11-01T00:00:00Z' },
      ],
      currencies: [{ id: 'cur-eur', code: 'EUR' }],
      products: [{ id: 'p1', refresh_status: 'idle', data_freshness: '2026-11-02T07:13:52Z' }],
      ai_summaries: [],
      ai_predictions: [],
    });
    const result = await refreshTrackedPrices(client);
    expect(result.inserted).toBe(1);
    expect(tables.price_history).toHaveLength(2);
    const inserted = tables.price_history[1];
    expect(inserted.currency).toBe('EUR');
    expect(inserted.suspicious_change).toBe(false);
    expect(inserted.source).toBeNull();
  });

  it('defaults explicitly to USD when the listing has no currency_id', async () => {
    const { refreshTrackedPrices } = await import('@/services/price-refresh');
    const { client, tables } = refreshFakeClient({
      alerts: [{ product_id: 'p1', active: true }],
      wishlist_items: [],
      merchant_products: [
        {
          product_id: 'p1',
          merchant_id: 'm1',
          price: 90,
          availability: 'in_stock',
          url: null,
          in_stock: true,
          deleted_at: null,
          currency_id: null,
        },
      ],
      merchants: [{ id: 'm1', slug: 'amazon' }],
      retailers: [{ id: 'r1', slug: 'amazon' }],
      price_history: [
        { product_id: 'p1', retailer_id: 'r1', price: 100, availability: 'in_stock', recorded_at: '2026-11-01T00:00:00Z' },
      ],
      currencies: [],
      products: [{ id: 'p1', refresh_status: 'idle' }],
      ai_summaries: [],
      ai_predictions: [],
    });
    const result = await refreshTrackedPrices(client);
    expect(result.inserted).toBe(1);
    expect(tables.price_history[1].currency).toBe('USD');
  });

  it('flags a 100% spike as suspicious instead of inserting it as normal', async () => {
    const { refreshTrackedPrices } = await import('@/services/price-refresh');
    const { client, tables } = refreshFakeClient({
      alerts: [{ product_id: 'p1', active: true }],
      wishlist_items: [],
      merchant_products: [
        {
          product_id: 'p1',
          merchant_id: 'm1',
          price: 200,
          availability: 'in_stock',
          url: null,
          in_stock: true,
          deleted_at: null,
          currency_id: null,
        },
      ],
      merchants: [{ id: 'm1', slug: 'amazon' }],
      retailers: [{ id: 'r1', slug: 'amazon' }],
      price_history: [
        { product_id: 'p1', retailer_id: 'r1', price: 100, availability: 'in_stock', recorded_at: '2026-11-01T00:00:00Z' },
      ],
      currencies: [],
      products: [{ id: 'p1', refresh_status: 'idle' }],
      ai_summaries: [],
      ai_predictions: [],
    });
    const result = await refreshTrackedPrices(client);
    expect(result.inserted).toBe(1);
    expect(tables.price_history[1].suspicious_change).toBe(true);
  });

  it('does NOT move data_freshness / next_refresh_at on an unchanged re-read', async () => {
    const { refreshTrackedPrices } = await import('@/services/price-refresh');
    const { client, tables, updates } = refreshFakeClient({
      alerts: [{ product_id: 'p1', active: true }],
      wishlist_items: [],
      merchant_products: [
        {
          product_id: 'p1',
          merchant_id: 'm1',
          price: 999,
          availability: 'in_stock',
          url: 'https://example.com/p1',
          in_stock: true,
          deleted_at: null,
          currency_id: null,
        },
      ],
      merchants: [{ id: 'm1', slug: 'amazon' }],
      retailers: [{ id: 'r1', slug: 'amazon' }],
      price_history: [
        { product_id: 'p1', retailer_id: 'r1', price: 999, availability: 'in_stock', recorded_at: '2026-11-02T07:13:52Z' },
      ],
      currencies: [],
      products: [
        {
          id: 'p1',
          refresh_status: 'idle',
          data_freshness: '2026-11-02T07:13:52Z',
          next_refresh_at: '2026-11-02T13:13:52Z',
        },
      ],
      ai_summaries: [],
      ai_predictions: [],
    });
    const result = await refreshTrackedPrices(client);
    expect(result.unchanged).toBe(1);
    expect(result.inserted).toBe(0);
    // The re-check clears status only — the freshness stamp is untouched.
    expect(tables.products[0].data_freshness).toBe('2026-11-02T07:13:52Z');
    expect(tables.products[0].next_refresh_at).toBe('2026-11-02T13:13:52Z');
    const productUpdates = updates.filter((u) => u.table === 'products');
    expect(productUpdates).toHaveLength(1);
    expect(productUpdates[0].patch).toEqual({ refresh_status: 'idle' });
  });
});

// ---------------------------------------------------------------------------
// getAdminDataQualitySummary — history coverage + per-source
// reliability wired in (§12 #44)
// ---------------------------------------------------------------------------

type DQRow = Record<string, unknown>;

class DQFakeQuery {
  private selectCols = '';

  constructor(
    private readonly tables: Record<string, DQRow[]>,
    private readonly table: string,
    private readonly failProvenance: boolean
  ) {}

  select(cols: string): this {
    this.selectCols = cols;
    return this;
  }
  is(): this {
    return this;
  }
  in(): this {
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: unknown }> {
    if (
      this.table === 'price_history' &&
      this.failProvenance &&
      this.selectCols.includes('source')
    ) {
      return { data: null, error: { code: '42703', message: 'column "source" does not exist' } };
    }
    return { data: this.tables[this.table] ?? [], error: null };
  }
}

function dqFakeClient(seed: Record<string, DQRow[]>, failProvenance = false): AnySupabaseClient {
  const tables: Record<string, DQRow[]> = Object.fromEntries(
    Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))])
  );
  return {
    from: (table: string) => new DQFakeQuery(tables, table, failProvenance),
  } as unknown as AnySupabaseClient;
}

describe('getAdminDataQualitySummary (§12 #44 wiring)', () => {
  const products = [
    {
      id: 'p1', name: 'A', slug: 'a', brand: 'Apple', category: 'Laptops',
      description: 'Good laptop.', image_url: 'https://example.com/a.jpg',
      gtin: '4006381333931', price_verification_status: 'verified',
      price_verified_at: '2026-11-12T08:00:00.000Z', data_freshness: '2026-11-12T08:00:00.000Z',
    },
    {
      id: 'p2', name: 'B', slug: 'b', brand: null, category: null,
      description: null, image_url: null,
      gtin: null, price_verification_status: 'unverified',
      price_verified_at: null, data_freshness: '2026-11-02T07:13:52.000Z',
    },
  ];

  it('computes per-product coverage and per-source reliability when 057 columns exist', async () => {
    const client = dqFakeClient({
      products,
      product_attributes: [{ product_id: 'p1' }],
      reviews: [],
      merchant_products: [{ product_id: 'p1', price: 999, in_stock: true, price_source: 'live' }],
      price_history: [
        { product_id: 'p1', price: 100, recorded_at: '2026-11-01T00:00:00Z', source: 'seed', suspicious_change: false },
        { product_id: 'p1', price: 100, recorded_at: '2026-11-11T00:00:00Z', source: 'seed', suspicious_change: true },
        { product_id: 'p1', price: 90, recorded_at: '2026-11-12T00:00:00Z', source: 'live', suspicious_change: false },
        { product_id: 'p2', price: 99, recorded_at: '2026-11-02T00:00:00Z', source: null, suspicious_change: false },
      ],
      product_images: [{ product_id: 'p1' }],
    });
    const summary = await getAdminDataQualitySummary(client);
    expect(summary.historyProvenanceMissing).toBe(false);
    expect(summary.historyCoverage.p1).toEqual({
      points: 3,
      spanDays: 11,
      firstRecordedAt: '2026-11-01T00:00:00.000Z',
      lastRecordedAt: '2026-11-12T00:00:00.000Z',
    });
    expect(summary.historyCoverage.p2).toEqual({
      points: 1,
      spanDays: 0,
      firstRecordedAt: '2026-11-02T00:00:00.000Z',
      lastRecordedAt: '2026-11-02T00:00:00.000Z',
    });
    expect(summary.sourceReliability).toEqual({
      seed: { points: 2, suspicious: 1, reliability: 0.5 },
      live: { points: 1, suspicious: 0, reliability: 1 },
      unknown: { points: 1, suspicious: 0, reliability: 1 },
    });
    expect(summary.productsWithHistory).toBe(2);
    expect(summary.priceHistoryPoints).toBe(4);
  });

  it('falls back honestly when the 057 columns are absent (42703)', async () => {
    const client = dqFakeClient(
      {
        products,
        product_attributes: [],
        reviews: [],
        merchant_products: [],
        price_history: [
          { product_id: 'p1', recorded_at: '2026-11-02T00:00:00Z' },
        ],
        product_images: [],
      },
      true
    );
    const summary = await getAdminDataQualitySummary(client);
    expect(summary.historyProvenanceMissing).toBe(true);
    expect(summary.historyCoverage).toEqual({});
    expect(summary.sourceReliability).toEqual({});
    // The legacy fallback still counts the history that exists.
    expect(summary.productsWithHistory).toBe(1);
    expect(summary.priceHistoryPoints).toBe(1);
    expect(summary.notes.some((n) => n.includes('057'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Migrations 056 / 057 / 058 — file shape (written, NOT applied)
// ---------------------------------------------------------------------------

describe('migrations 056/057/058 (DO NOT APPLY)', () => {
  function migration(name: string): string {
    return readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8');
  }

  it('056 creates a partial UNIQUE index on products.gtin + a variant gtin column', () => {
    const sql = migration('20261113090000_056_gtin_unique_partial_index.sql');
    expect(sql).toContain('DO NOT APPLY');
    expect(sql).toContain('products_gtin_unique_idx');
    expect(sql).toContain('WHERE gtin IS NOT NULL');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS gtin text');
    expect(sql).toContain('product_variants_gtin_unique_idx');
  });

  it('057 adds source / observed_at / suspicious_change + labels seed rows', () => {
    const sql = migration('20261113093000_057_price_history_source_flags.sql');
    expect(sql).toContain('DO NOT APPLY');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS source text');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS observed_at timestamptz');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS suspicious_change boolean');
    expect(sql).toContain("SET source = 'seed'");
    expect(sql).toContain('ebay-browse-api');
    expect(sql).toContain('merchant-feed');
  });

  it('058 adds source / verified_at / verified_by to product_attributes', () => {
    const sql = migration('20261113100000_058_product_attribute_attribution.sql');
    expect(sql).toContain('DO NOT APPLY');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS source text');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS verified_at timestamptz');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS verified_by text');
  });
});
