/**
 * FINAL 100% — matching + merchant reliability (Worker W5).
 *
 * Covers F-P1-42..50, F-P1-11, F-P1-12, F-P1-21, F-P2-04..07,
 * F-P2-37..43: model normalization + model leg, review gates,
 * eBay scored matching, variant matching, manual listing match,
 * provider health, canonical reliability, slug reconciliation,
 * eBay configured gate, and the quality-score merchants relabel.
 *
 * Serial-safe: pure functions + in-memory fake Supabase clients.
 * No network, no live data.
 */

import { describe, expect, it } from 'vitest';
import { normalizeModel, modelsMatch, modelsConflict, normalizeBrand, brandsMatch } from '@/lib/model-normalization';
import {
  canonicalMerchantSlug,
  providerKeyForMerchantSlug,
  merchantSlugForProviderKey,
  reconcileMerchantRetailer,
} from '@/lib/merchant-slugs';
import {
  calibrateMatchConfidence,
  gtinMatchConfidence,
  classifyPipelineDuplicate,
  classifyBrandResolution,
  buildMatchReviewRecord,
  MATCH_AUTO_MERGE_MIN_CONFIDENCE,
} from '@/services/matching-review';
import {
  scoreEbayListingMatch,
  scoreEbayListingMatchWithModel,
  EBAY_MATCH_AUTO_THRESHOLD,
} from '@/services/ebay-matching';
import {
  isSearchUrl,
  isRealListingUrl,
  validateManualListingMatch,
  getRealListingCoverage,
  writeListingMatchConfidenceByProduct,
  readListingMatchConfidence,
} from '@/services/merchant-listing-match';
import {
  recordProviderHealthAttempt,
  getProviderLastSync,
} from '@/services/provider-health';
import {
  CANONICAL_MERCHANT_RELIABILITY_SCORER,
  writeMerchantReliabilitySnapshot,
} from '@/services/canonical-merchant-reliability';
import { findDuplicate } from '@/services/pipeline/deduplication';
import { validateRawProduct } from '@/services/pipeline/validation';
import { normalizeProduct } from '@/services/pipeline/normalization';
import { matchVariant, matchListingToVariant } from '@/services/pipeline/variants';
import { reviewIntakeRows } from '@/services/catalog-intake';
import { computeProductQualityScore } from '@/services/product-quality-score';
import { describeEbayPlatformStatus } from '@/services/platform-status';
import { ProviderRegistry } from '@/services/providers/registry';
import { MockProvider } from '@/services/providers/mock-provider';
import type { AnySupabaseClient } from '@/lib/supabase/types';

// ---------------------------------------------------------------------------
// In-memory fake Supabase client (chainable, thenable)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface FakeOptions {
  tables?: Record<string, Row[]>;
  /** Return this error for queries whose select columns include `columnNeedle`. */
  errorOnColumns?: { columnNeedle: string; code: string; message: string };
  /** Return this error when an update is awaited on `table`. */
  updateError?: { table: string; code: string; message: string };
  /** Return this error when an upsert is awaited on `table`. */
  upsertError?: { table: string; code: string; message: string };
}

function makeFakeClient(options: FakeOptions = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(options.tables ?? {})) {
    tables[k] = [...v];
  }
  const inserts: Array<{ table: string; row: Row }> = [];
  const updates: Array<{ table: string; patch: Row }> = [];
  const upserts: Array<{ table: string; row: Row }> = [];

  function chain(table: string) {
    let rows = [...(tables[table] ?? [])];
    let insertedRow: Row | null = null;
    let columns = '';
    let pendingUpdate: Row | null = null;
    let didUpsert = false;
    const q: Record<string, unknown> = {
      select(cols: string) {
        columns = cols;
        return q;
      },
      eq(column: string, value: unknown) {
        rows = rows.filter((r) => r[column] === value);
        return q;
      },
      neq(column: string, value: unknown) {
        rows = rows.filter((r) => r[column] !== value);
        return q;
      },
      is(column: string, value: unknown) {
        rows = rows.filter((r) => (value === null ? r[column] == null : r[column] === value));
        return q;
      },
      ilike(column: string, value: unknown) {
        const needle = String(value).replace(/%/g, '').toLowerCase();
        rows = rows.filter((r) => String(r[column] ?? '').toLowerCase().includes(needle));
        return q;
      },
      in(column: string, value: unknown) {
        rows = rows.filter((r) => (value as unknown[]).includes(r[column]));
        return q;
      },
      order() {
        return q;
      },
      limit(n: number) {
        rows = rows.slice(0, n);
        return q;
      },
      insert(row: Row) {
        inserts.push({ table, row });
        const withId = { id: `new-${table}-${inserts.length}`, ...row };
        tables[table] = [...(tables[table] ?? []), withId];
        insertedRow = withId;
        return q;
      },
      update(patch: Row) {
        // Lazy: the patch applies to the rows filtered by the
        // eq() calls that follow (the real client applies the
        // filter first, then the update).
        updates.push({ table, patch });
        pendingUpdate = patch;
        return q;
      },
      upsert(row: Row) {
        upserts.push({ table, row });
        const withId = { id: `new-${table}-${upserts.length}`, ...row };
        tables[table] = [...(tables[table] ?? []), withId];
        insertedRow = withId;
        didUpsert = true;
        return q;
      },
      async maybeSingle() {
        if (options.errorOnColumns && columns.includes(options.errorOnColumns.columnNeedle)) {
          return { data: null, error: { code: options.errorOnColumns.code, message: options.errorOnColumns.message } };
        }
        return { data: rows[0] ?? null, error: null };
      },
      async single() {
        if (didUpsert && options.upsertError && options.upsertError.table === table) {
          return { data: null, error: { code: options.upsertError.code, message: 'simulated upsert failure' } };
        }
        if (insertedRow) return { data: insertedRow, error: null };
        const row = rows[0] ?? null;
        return row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } };
      },
      then(onF: (v: { data: Row[]; error: { code?: string; message: string } | null }) => unknown) {
        if (options.errorOnColumns && columns.includes(options.errorOnColumns.columnNeedle)) {
          return Promise.resolve({
            data: [],
            error: { code: options.errorOnColumns.code, message: options.errorOnColumns.message },
          }).then(onF);
        }
        if (pendingUpdate) {
          if (options.updateError && options.updateError.table === table) {
            return Promise.resolve({
              data: [],
              error: { code: options.updateError.code, message: options.updateError.message },
            }).then(onF);
          }
          const patch = pendingUpdate;
          pendingUpdate = null;
          const patched = rows.map((r) => ({ ...r, ...patch }));
          tables[table] = (tables[table] ?? []).map((r) =>
            rows.includes(r) ? { ...r, ...patch } : r
          );
          rows = patched;
          return Promise.resolve({ data: rows, error: null }).then(onF);
        }
        if (didUpsert && options.upsertError && options.upsertError.table === table) {
          return Promise.resolve({
            data: [],
            error: { code: options.upsertError.code, message: 'simulated upsert failure' },
          }).then(onF);
        }
        return Promise.resolve({ data: rows, error: null }).then(onF);
      },
    };
    return q;
  }

  const client = { from: (table: string) => chain(table) };
  return {
    client: client as unknown as AnySupabaseClient,
    inserts,
    updates,
    upserts,
    tables,
  };
}

// ---------------------------------------------------------------------------
// F-P1-46 — model normalization
// ---------------------------------------------------------------------------

describe('normalizeModel (F-P1-46)', () => {
  it('normalizes SM-S928B variants to the same key', () => {
    expect(normalizeModel('SM-S928B')).toBe('SMS928B');
    expect(normalizeModel('sm s928b')).toBe('SMS928B');
    expect(normalizeModel('SM_S928B')).toBe('SMS928B');
    expect(normalizeModel('SMS928B')).toBe('SMS928B');
  });

  it('returns null for blank / missing models', () => {
    expect(normalizeModel(null)).toBeNull();
    expect(normalizeModel(undefined)).toBeNull();
    expect(normalizeModel('   ')).toBeNull();
  });

  it('modelsMatch compares normalized values', () => {
    expect(modelsMatch('SM-S928B', 'sm s928b')).toBe(true);
    expect(modelsMatch('SM-S928B', 'SM-S928C')).toBe(false);
    expect(modelsMatch(null, 'SM-S928B')).toBe(false);
  });

  it('modelsConflict is true only when both sides have a model and they differ', () => {
    expect(modelsConflict('SM-S928B', 'SM-S928C')).toBe(true);
    expect(modelsConflict('SM-S928B', 'sm s928b')).toBe(false);
    expect(modelsConflict(null, 'SM-S928B')).toBe(false);
    expect(modelsConflict('SM-S928B', null)).toBe(false);
    expect(modelsConflict(null, null)).toBe(false);
  });

  it('normalizeBrand folds aliases', () => {
    expect(normalizeBrand('Apple Inc')).toBe('apple');
    expect(normalizeBrand('Hewlett Packard')).toBe('hp');
    expect(brandsMatch('Apple Inc', 'apple')).toBe(true);
    expect(brandsMatch('Samsung', 'Apple')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F-P1-11 / F-P2-06 — slug reconciliation
// ---------------------------------------------------------------------------

describe('merchant slug reconciliation (F-P1-11, F-P2-06)', () => {
  it('canonicalizes bestbuy spellings to best-buy', () => {
    expect(canonicalMerchantSlug('bestbuy')).toBe('best-buy');
    expect(canonicalMerchantSlug('best_buy')).toBe('best-buy');
    expect(canonicalMerchantSlug('Best-Buy')).toBe('best-buy');
    expect(canonicalMerchantSlug('best-buy')).toBe('best-buy');
    expect(canonicalMerchantSlug('amazon')).toBe('amazon');
    expect(canonicalMerchantSlug('ebay')).toBe('ebay');
  });

  it('maps best-buy to the provider key bestbuy and back', () => {
    expect(providerKeyForMerchantSlug('best-buy')).toBe('bestbuy');
    expect(providerKeyForMerchantSlug('bestbuy')).toBe('bestbuy');
    expect(merchantSlugForProviderKey('bestbuy')).toBe('best-buy');
    expect(merchantSlugForProviderKey('amazon')).toBe('amazon');
  });

  it('reconcileMerchantRetailer resolves best-buy vs bestbuy and flags ebay merchants-missing', () => {
    const bestBuy = reconcileMerchantRetailer('bestbuy', 'bestbuy');
    expect(bestBuy?.reconciliation.merchantSlug).toBe('best-buy');
    expect(bestBuy?.reconciliation.providerKey).toBe('bestbuy');
    // The retailer spelling 'bestbuy' matches the canonical
    // merchant 'best-buy' — the mismatch is resolved here.
    expect(bestBuy?.matches).toBe(true);
    expect(bestBuy?.mismatchReason).toBeNull();
    const ebay = reconcileMerchantRetailer('ebay');
    expect(ebay?.reconciliation.merchantSlug).toBe('ebay');
    expect(ebay?.reconciliation.seededInMerchants).toBe(false);
    expect(ebay?.reconciliation.seededInRetailers).toBe(true);
    expect(reconcileMerchantRetailer('unknown-merchant-xyz')).toBeNull();
  });

  it('registry getForRetailer agrees under both spellings', () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider());
    registry.setRetailerOverride('bestbuy', 'mock');
    expect(registry.getForRetailer('best-buy')?.key).toBe('mock');
    expect(registry.getForRetailer('bestbuy')?.key).toBe('mock');
  });
});

// ---------------------------------------------------------------------------
// F-P2-37/38 — confidence calibration
// ---------------------------------------------------------------------------

describe('match confidence calibration (F-P2-37, F-P2-38)', () => {
  it('exact slug / name-brand is 1.0', () => {
    expect(calibrateMatchConfidence({ slugMatch: true })).toBe(1);
    expect(calibrateMatchConfidence({ exactNameBrandMatch: true })).toBe(1);
  });

  it('GTIN alone is capped at 0.9, corroborated GTIN is 1.0', () => {
    expect(calibrateMatchConfidence({ gtinMatch: true })).toBe(0.9);
    expect(calibrateMatchConfidence({ gtinMatch: true, corroborated: true })).toBe(1);
    expect(gtinMatchConfidence(false)).toBe(0.9);
    expect(gtinMatchConfidence(true)).toBe(1);
  });

  it('fuzzy below 0.75 is no match; fuzzy is capped below 1.0', () => {
    expect(calibrateMatchConfidence({ fuzzySimilarity: 0.74 })).toBeNull();
    expect(calibrateMatchConfidence({ fuzzySimilarity: 0.8 })).toBeCloseTo(0.8, 5);
    expect(calibrateMatchConfidence({ fuzzySimilarity: 1 })).toBeCloseTo(0.99, 5);
  });

  it('auto-merge bar is 0.90', () => {
    expect(MATCH_AUTO_MERGE_MIN_CONFIDENCE).toBe(0.9);
  });
});

// ---------------------------------------------------------------------------
// F-P1-42 / F-P1-44 — review gates
// ---------------------------------------------------------------------------

describe('pipeline duplicate gate (F-P1-42)', () => {
  it('exact GTIN auto-merges when models do not conflict', () => {
    const d = classifyPipelineDuplicate({
      isDuplicate: true,
      matchedBy: 'gtin',
      confidence: 0.9,
      incomingModel: 'SM-S928B',
      existingModel: 'sm s928b',
    });
    expect(d.action).toBe('auto-merge');
    expect(d.reviewRequired).toBe(false);
  });

  it('fuzzy match is held for review, never auto-merged', () => {
    const d = classifyPipelineDuplicate({
      isDuplicate: true,
      matchedBy: 'name-brand-fuzzy',
      confidence: 0.75,
    });
    expect(d.action).toBe('hold-for-review');
    expect(d.reviewRequired).toBe(true);
    expect(d.reasons.length).toBeGreaterThan(0);
  });

  it('a model conflict vetoes even an exact leg', () => {
    const d = classifyPipelineDuplicate({
      isDuplicate: true,
      matchedBy: 'gtin',
      confidence: 0.9,
      incomingModel: 'SM-S928B',
      existingModel: 'SM-S928C',
    });
    expect(d.action).toBe('hold-for-review');
    expect(d.reviewRequired).toBe(true);
    expect(d.reasons[0]).toContain('Model conflict');
  });

  it('a dedupe read error rejects the ingest (fail closed)', () => {
    const d = classifyPipelineDuplicate({
      isDuplicate: false,
      matchedBy: null,
      dedupeError: 'name/brand lookup failed: boom',
    });
    expect(d.action).toBe('reject');
    expect(d.reviewRequired).toBe(true);
  });

  it('no duplicate is no-match', () => {
    const d = classifyPipelineDuplicate({ isDuplicate: false, matchedBy: null });
    expect(d.action).toBe('no-match');
    expect(d.reviewRequired).toBe(false);
  });
});

describe('brand resolution gate (F-P1-44)', () => {
  it('fuzzy brand match is held for review', () => {
    const d = classifyBrandResolution({ matchedBy: 'fuzzy', similarity: 0.8 });
    expect(d.action).toBe('hold-for-review');
    expect(d.reviewRequired).toBe(true);
  });

  it('exact brand match auto-resolves; new brand creation is not a merge', () => {
    expect(classifyBrandResolution({ matchedBy: 'exact' }).action).toBe('auto-merge');
    const created = classifyBrandResolution({ matchedBy: null, created: true });
    expect(created.action).toBe('auto-merge');
    expect(created.reviewRequired).toBe(false);
  });

  it('buildMatchReviewRecord is the durable hold record', () => {
    const rec = buildMatchReviewRecord('pipeline-duplicate', {
      productName: 'Sony WH-1000XM5',
      existingProductId: 'prod-1',
      matchedBy: 'name-brand-fuzzy',
      confidence: 0.75,
      reasons: ['Fuzzy name+brand match — held for review.'],
    });
    expect(rec.kind).toBe('pipeline-duplicate');
    expect(rec.heldAction).toBe('rejected-ingest-held-for-review');
    expect(rec.createdAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// F-P1-43 — eBay scored matching
// ---------------------------------------------------------------------------

describe('eBay scored matching (F-P1-43)', () => {
  it('auto-matches a genuine listing', () => {
    const r = scoreEbayListingMatch({
      productName: 'Samsung Galaxy S24 Ultra',
      productBrand: 'Samsung',
      listingTitle: 'Samsung Galaxy S24 Ultra 256GB Unlocked — Brand New',
    });
    expect(r.decision).toBe('auto');
    expect(r.score).not.toBeNull();
    expect((r.score ?? 0) >= EBAY_MATCH_AUTO_THRESHOLD).toBe(true);
  });

  it('vetoes a different model year', () => {
    const r = scoreEbayListingMatch({
      productName: 'MacBook Air 13 2024',
      productBrand: 'Apple',
      listingTitle: 'Apple MacBook Air 13 2023 M2 Laptop',
    });
    expect(r.decision).toBe('reject');
    expect(r.score).toBeNull();
  });

  it('vetoes a GTIN mismatch (both sides GS1-valid, different)', () => {
    const r = scoreEbayListingMatch({
      productName: 'Sony WH-1000XM5',
      productBrand: 'Sony',
      productGtin: '027242920910',
      listingTitle: 'Sony WH-1000XM5 Noise Cancelling Headphones',
      listingGtin: '027242920927',
    });
    expect(r.decision).toBe('reject');
  });

  it('vetoes an accessory listing', () => {
    const r = scoreEbayListingMatch({
      productName: 'Samsung Galaxy S24 Ultra',
      productBrand: 'Samsung',
      listingTitle: 'Samsung Galaxy S24 Ultra Case Cover — Protective',
    });
    expect(r.decision).toBe('reject');
  });

  it('below-threshold coverage goes to review, not auto', () => {
    // 4/5 name tokens = 0.80 coverage, no brand leg: score 0.80
    // is below the 0.85 auto threshold, so the listing is held
    // for review instead of auto-recorded.
    const r = scoreEbayListingMatch({
      productName: 'Samsung Galaxy S24 Ultra 512GB',
      productBrand: null,
      listingTitle: 'Samsung Galaxy S24 Ultra',
    });
    expect(r.decision).toBe('review');
    expect(r.confidence).toBeCloseTo(0.8, 5);
  });

  it('scoreEbayListingMatchWithModel matches on normalized model and vetoes a model mismatch', () => {
    const match = scoreEbayListingMatchWithModel({
      productName: 'Samsung Galaxy S24 Ultra',
      productBrand: 'Samsung',
      productModel: 'SM-S928B',
      listingTitle: 'Samsung Galaxy S24 Ultra 256GB',
      listingModel: 'sm s928b',
    });
    expect(match.decision).toBe('auto');
    expect(match.matchedBy).toBe('model');

    const veto = scoreEbayListingMatchWithModel({
      productName: 'Samsung Galaxy S24 Ultra',
      productBrand: 'Samsung',
      productModel: 'SM-S928B',
      listingTitle: 'Samsung Galaxy S24 Ultra 256GB',
      listingModel: 'SM-S928C',
    });
    expect(veto.decision).toBe('reject');
  });
});

// ---------------------------------------------------------------------------
// F-P1-47 — variant matching
// ---------------------------------------------------------------------------

describe('variant matching (F-P1-47)', () => {
  const stored = [
    { id: 'v-1', sku: 'SKU-1', gtin: null, attributes: { color: 'black' } },
    { id: 'v-2', sku: null, gtin: null, modelNumber: 'SM-S928B', attributes: { color: 'violet' } },
  ];

  it('matchVariant matches by normalized model after SKU/GTIN miss', () => {
    const hit = matchVariant(
      { name: 'Galaxy S24 Ultra Violet', sku: null, gtin: null, modelNumber: 'sm s928b', attributes: {} },
      stored
    );
    expect(hit.variant?.id).toBe('v-2');
    expect(hit.matchedBy).toBe('model');
  });

  it('matchListingToVariant is honest-empty when the product has no variants', () => {
    const r = matchListingToVariant({ sku: 'SKU-9', gtin: null, modelNumber: null }, []);
    expect(r.variant).toBeNull();
    expect(r.confidence).toBeNull();
    expect(r.reason).toContain('no-variants');
  });

  it('matchListingToVariant matches by model with 0.85 confidence', () => {
    const r = matchListingToVariant({ sku: null, gtin: null, modelNumber: 'SM_S928B' }, stored);
    expect(r.variant?.id).toBe('v-2');
    expect(r.matchedBy).toBe('model');
    expect(r.confidence).toBe(0.85);
  });
});

// ---------------------------------------------------------------------------
// F-P1-21 / F-P1-12 — manual listing match + confidence persistence
// ---------------------------------------------------------------------------

describe('manual listing match (F-P1-21)', () => {
  it('rejects search URLs', () => {
    expect(isSearchUrl('https://www.ebay.com/sch/i.html?_nkw=iphone')).toBe(true);
    expect(isSearchUrl('https://www.amazon.com/s?k=iphone')).toBe(true);
    const v = validateManualListingMatch({
      productId: 'prod-1',
      merchantSlug: 'ebay',
      listingUrl: 'https://www.ebay.com/sch/i.html?_nkw=iphone',
      merchantSku: '123',
    });
    expect(v.valid).toBe(false);
    expect(v.errors.join(' ')).toContain('search URL');
  });

  it('accepts a real listing URL + SKU', () => {
    expect(isRealListingUrl('https://www.ebay.com/itm/123456789', 'ebay')).toBe(true);
    expect(isRealListingUrl('https://www.amazon.com/dp/B09XS7JWHH', 'amazon')).toBe(true);
    const v = validateManualListingMatch({
      productId: 'prod-1',
      merchantSlug: 'ebay',
      listingUrl: 'https://www.ebay.com/itm/123456789',
      merchantSku: '123456789',
    });
    expect(v.valid).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.canonicalMerchantSlug).toBe('ebay');
  });

  it('getRealListingCoverage reports 0/20 honestly for search-URL rows', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      url: `https://www.ebay.com/sch/i.html?_nkw=product-${i}`,
      merchant_sku: null,
      merchant_id: 'm-ebay',
    }));
    const { client } = makeFakeClient({ tables: { merchant_products: rows } });
    const coverage = await getRealListingCoverage(client);
    expect(coverage.totalRows).toBe(20);
    expect(coverage.realListings).toBe(0);
    expect(coverage.searchUrlOnly).toBe(20);
    expect(coverage.realShare).toBe(0);
    expect(coverage.tableMissing).toBe(false);
  });
});

describe('match-confidence persistence (F-P1-12)', () => {
  it('write + read round-trips when the columns exist', async () => {
    const { client } = makeFakeClient({
      tables: {
        merchant_products: [
          { id: 'mp-1', product_id: 'p-1', merchant_id: 'm-1', match_confidence: null, matched_by: null },
        ],
      },
    });
    const written = await writeListingMatchConfidenceByProduct(client, 'p-1', 'm-1', 0.92, 'name-brand');
    expect(written.written).toBe(true);
    const read = await readListingMatchConfidence(client, 'mp-1');
    expect(read.matchConfidence).toBe(0.92);
    expect(read.matchedBy).toBe('name-brand');
  });

  it('write degrades honestly on a 42703 (columns not yet migrated)', async () => {
    const { client } = makeFakeClient({
      tables: { merchant_products: [{ id: 'mp-1', product_id: 'p-1', merchant_id: 'm-1' }] },
      updateError: { table: 'merchant_products', code: '42703', message: 'column "match_confidence" does not exist' },
    });
    const written = await writeListingMatchConfidenceByProduct(client, 'p-1', 'm-1', 0.92, 'name-brand');
    expect(written.written).toBe(false);
    expect(written.columnsMissing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-P2-04 — provider health
// ---------------------------------------------------------------------------

describe('provider health (F-P2-04)', () => {
  it('getProviderLastSync is honest never-synced when no writer ever ran', async () => {
    const { client } = makeFakeClient({ tables: { providers: [] } });
    const sync = await getProviderLastSync(client, 'ebay');
    expect(sync.neverSynced).toBe(true);
    expect(sync.lastSyncAt).toBeNull();
    expect(sync.tableMissing).toBe(false);
  });

  it('recordProviderHealthAttempt writes both trails and never throws', async () => {
    const { client, tables } = makeFakeClient({ tables: { providers: [], data_sources: [], provider_health: [] } });
    const result = await recordProviderHealthAttempt(client, {
      providerKey: 'ebay',
      outcome: 'success',
      recordsChecked: 3,
    });
    expect(result.dataSources).toBe('updated');
    expect(result.providerHealth).toBe('reported');
    expect(tables.data_sources.length).toBe(1);
    expect(tables.providers.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F-P1-50 / F-P1-48 — canonical reliability scorer + 061 writer
// ---------------------------------------------------------------------------

describe('canonical merchant reliability (F-P1-50, F-P1-48)', () => {
  it('the canonical scorer is the policy scorer', () => {
    expect(CANONICAL_MERCHANT_RELIABILITY_SCORER).toBe('policy');
  });

  it('writeMerchantReliabilitySnapshot reports 061-not-applied honestly instead of throwing', async () => {
    const { client } = makeFakeClient({
      tables: { merchants: [], merchant_products: [], price_refresh_runs: [] },
      upsertError: { table: 'merchant_reliability', code: 'PGRST205', message: 'table missing' },
    });
    const snap = await writeMerchantReliabilitySnapshot(client, {
      id: 'm-1',
      name: 'Test Merchant',
      websiteUrl: null,
      active: true,
    });
    expect(snap.written).toBe(false);
    expect(snap.reason).toContain('061');
    expect(snap.score).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F-P1-45 / F-P2-42 — findDuplicate model leg + fail-closed
// ---------------------------------------------------------------------------

function normalizedFixture(overrides: Record<string, unknown> = {}) {
  const raw = {
    externalId: 'ext-1',
    retailerSlug: 'amazon',
    name: 'Samsung Galaxy S24 Ultra',
    description: 'Flagship phone',
    brand: 'Samsung',
    category: 'Electronics > Phones',
    gtin: undefined,
    images: [],
    price: 999,
    currency: 'USD',
    availability: 'in_stock' as const,
    url: 'https://example.com/p',
    ...overrides,
  };
  const result = validateRawProduct(raw);
  if (!result.success) throw new Error(`fixture failed validation: ${JSON.stringify(result.errors)}`);
  return normalizeProduct(result.data);
}

describe('findDuplicate model leg + fail-closed (F-P1-45, F-P2-42)', () => {
  it('matches by normalized model + brand (held for review)', async () => {
    const { client } = makeFakeClient({
      tables: {
        products: [
          { id: 'p-model', name: 'Galaxy S24 Ultra', brand: 'Samsung', model_number: 'SM-S928B', slug: 'other-slug' },
        ],
      },
    });
    const out = await findDuplicate(client, normalizedFixture({ modelNumber: 'sm s928b' }));
    expect(out.isDuplicate).toBe(true);
    expect(out.matchedBy).toBe('model');
    expect(out.requiresReview).toBe(true);
    expect(out.confidence).toBe(0.9);
  });

  it('a GTIN match with a conflicting model is held for review', async () => {
    const { client } = makeFakeClient({
      tables: {
        products: [{ id: 'p-gtin', gtin: '027242920910', model_number: 'SM-S928B', slug: 'x' }],
      },
    });
    const out = await findDuplicate(
      client,
      normalizedFixture({ gtin: '027242920910', modelNumber: 'SM-S928C' })
    );
    expect(out.isDuplicate).toBe(true);
    expect(out.matchedBy).toBe('gtin');
    expect(out.requiresReview).toBe(true);
    expect(out.reviewReason).toContain('Model conflict');
  });

  it('a name/brand lookup failure fails closed with dedupeError', async () => {
    const { client } = makeFakeClient({
      tables: { products: [{ id: 'p-1', name: 'Samsung Galaxy S24 Ultra', brand: 'Samsung', slug: 's' }] },
      errorOnColumns: { columnNeedle: 'brand', code: 'PGRST301', message: 'simulated query failure' },
    });
    const out = await findDuplicate(client, normalizedFixture());
    expect(out.dedupeError).toContain('name/brand lookup failed');
    expect(out.isDuplicate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F-P1-45 — intake review model leg + fuzzy veto
// ---------------------------------------------------------------------------

describe('reviewIntakeRows model leg (F-P1-45)', () => {
  const context = {
    existingSlugs: new Set<string>(),
    // Fuzzy-similar name+brand: 'galaxy s24 ultra 256gb|samsung'
    // is a 0.75 token-similar near-miss of 'galaxy s24 ultra'.
    existingNameBrands: new Map<string, string>([['galaxy s24 ultra 256gb|samsung', 'galaxy-s24-ultra']]),
    existingGtins: new Map<string, string>(),
    existingModels: new Map<string, string>([['SMS928B|samsung', 'galaxy-s24-ultra']]),
    existingModelsBySlug: new Map<string, string | null>([['galaxy-s24-ultra', 'SMS928B']]),
    knownMerchants: new Map<string, string>([['amazon', 'm-amazon']]),
    knownCurrencies: new Map<string, string>([['USD', 'c-usd']]),
  };

  const row = (overrides: Record<string, unknown> = {}) => ({
    rowNumber: 2,
    name: 'Galaxy S24 Ultra 256GB',
    slug: 'galaxy-s24-ultra-256gb',
    brand: 'Samsung',
    category: 'Electronics',
    price: '999',
    currency: 'USD',
    merchant: 'amazon',
    modelNumber: 'sm s928b',
    ...overrides,
  });

  it('holds a row whose normalized model + brand already exists', () => {
    const review = reviewIntakeRows([row()], context);
    expect(review.rows[0].status).toBe('near-duplicate');
    expect(review.rows[0].nearDuplicateOf).toBe('galaxy-s24-ultra');
  });

  it('does not hold a row whose model differs from the similar-named existing product', () => {
    // Same name+brand fuzzy-similar to 'galaxy-s24-ultra', but
    // the model conflicts (SM-S928C vs SMS928B): a different
    // model is a different product, so the fuzzy hold is vetoed.
    const review = reviewIntakeRows(
      [row({ name: 'Galaxy S24 Ultra', slug: 'galaxy-s24-ultra-plus', price: '1099', modelNumber: 'SM-S928C' })],
      context
    );
    expect(review.rows[0].status).toBe('valid');
  });

  it('holds the fuzzy near-miss when no model is recorded on either side', () => {
    const review = reviewIntakeRows(
      [row({ name: 'Galaxy S24 Ultra', slug: 'galaxy-s24-ultra-plus', price: '1099', modelNumber: undefined })],
      { ...context, existingModels: new Map(), existingModelsBySlug: new Map() }
    );
    expect(review.rows[0].status).toBe('near-duplicate');
    expect(review.rows[0].nearDuplicateOf).toBe('galaxy-s24-ultra');
  });
});

// ---------------------------------------------------------------------------
// F-P1-49 — quality-score merchants dimension relabel
// ---------------------------------------------------------------------------

describe('quality-score merchants dimension (F-P1-49)', () => {
  const product = {
    name: 'Sony WH-1000XM5',
    slug: 'sony-wh-1000xm5',
    brand: 'Sony',
    category: 'Electronics',
    description: 'Noise cancelling headphones',
    imageUrl: 'https://example.com/img.jpg',
    gtin: '027242920910',
    priceVerificationStatus: 'unverified' as const,
    priceVerifiedAt: null,
    dataFreshness: null,
    updatedAt: null,
  };

  it('labels the count proxy honestly when no reliability was measured', () => {
    const score = computeProductQualityScore(product, {
      specCount: 0,
      imageCount: 1,
      merchantCount: 2,
      inStockMerchantCount: 1,
      priceSource: null,
      lastPriceRecordedAt: null,
    });
    const dim = score.dimensions.find((d) => d.key === 'merchants');
    expect(dim).toBeDefined();
    expect(dim?.label).toBe('Merchant listings (count only — not measured reliability)');
  });

  it('uses the measured canonical reliability score when provided', () => {
    const score = computeProductQualityScore(product, {
      specCount: 0,
      imageCount: 1,
      merchantCount: 2,
      inStockMerchantCount: 1,
      priceSource: null,
      lastPriceRecordedAt: null,
      merchantReliabilityScore: 35,
    });
    const dim = score.dimensions.find((d) => d.key === 'merchants');
    expect(dim?.label).toBe('Merchant reliability (measured)');
    expect(dim?.score).toBe(35);
  });
});

// ---------------------------------------------------------------------------
// F-P2-07 — eBay configured gate
// ---------------------------------------------------------------------------

describe('eBay configured gate (F-P2-07)', () => {
  it('keys alone are NOT configured — the missing gates are named', () => {
    const s = describeEbayPlatformStatus({
      keysConfigured: true,
      merchantRowExists: null,
      approvalConfirmed: false,
    });
    expect(s.status).toBe('not-configured');
    expect(s.whatYouGet).toContain('merchants row');
    expect(s.whatYouGet).toContain('approval');
  });

  it('all three gates present is configured', () => {
    const s = describeEbayPlatformStatus({
      keysConfigured: true,
      merchantRowExists: true,
      approvalConfirmed: true,
    });
    expect(s.status).toBe('configured');
    expect(s.coverage).toContain('Live active listings');
  });

  it('missing keys are not configured', () => {
    const s = describeEbayPlatformStatus({
      keysConfigured: false,
      merchantRowExists: false,
      approvalConfirmed: false,
    });
    expect(s.status).toBe('not-configured');
  });
});
