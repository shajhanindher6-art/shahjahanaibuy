/**
 * FINAL 100% Product & Real Data Completion — W1 verification spine.
 *
 * Pins the code built for F-P0-02, F-P0-03, F-P1-06, F-P1-29, F-P1-28,
 * F-P1-01, F-P1-15, F-P1-30 and F-P1-34. Serial vitest only.
 *
 * Fakes are in-memory; nothing here touches a real DB, a real
 * provider, or the live site.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  derivePriceState,
  priceStateFromDataQualityState,
  PRICE_STATE_TO_DATA_QUALITY_STATE,
  PRICE_STATE_LABELS,
} from '@/lib/verification/price-state';
import { isFullyVerified } from '@/lib/verification/fully-verified';
import {
  markProductVerified,
  shouldFlipVerifiedToStale,
  flipStaleVerificationStatuses,
} from '@/services/price-verification';
import { validateAdminProductPatch } from '@/services/admin-products';
import { validateBody, adminProductPatchSchema } from '@/lib/api/validation';
import {
  insertPriceHistoryRow,
} from '@/services/price-history-quality';
import { getPriceHistory } from '@/services/price-history';
import { computeProductQualityScore } from '@/services/product-quality-score';
import { refreshTrackedPrices } from '@/services/price-refresh';
import { resolveRefreshRunStatus } from '@/services/refresh-run';
import { refreshEbayPrices } from '@/services/ebay-refresh';
import type { EbayListing } from '@/services/ebay-browse';
import { getEbayBudgetDateKey } from '@/services/ebay-budget';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

function repoFile(...parts: string[]): string {
  return fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...parts),
    'utf8'
  );
}

const NOW = new Date('2026-11-13T12:00:00.000Z');

// A GS1-valid EAN-13 (classic GS1 example, check digit 1).
const VALID_GTIN = '4006381333931';

/** Every criterion of isFullyVerified passing at once. */
function completeVerifiedInput() {
  return {
    name: 'MacBook Air 13',
    brand: 'Apple',
    category: 'Laptops',
    description: 'A thin laptop.',
    modelNumber: 'MLY13',
    gtin: VALID_GTIN,
    imageUrl: 'https://cdn.example.com/macbook-air-13.jpg',
    priceVerificationStatus: 'verified' as const,
    priceVerifiedAt: '2026-11-13T10:00:00.000Z',
    specCount: 3,
    imageCount: 1,
    merchantCount: 2,
    hasRealMerchantListing: true as const,
    hasPriceSource: true as const,
    now: NOW,
  };
}

// ---------------------------------------------------------------------------
// F-P1-29 — the 5-state price machine.
// ---------------------------------------------------------------------------

describe('F-P1-29 derivePriceState — the brief’s 5 states', () => {
  it('LIVE_VERIFIED: verified + a check 2 days old', () => {
    const r = derivePriceState({
      priceVerificationStatus: 'verified',
      priceVerifiedAt: '2026-11-11T12:00:00.000Z',
      hasRecordedPrice: true,
      now: NOW,
    });
    expect(r.state).toBe('LIVE_VERIFIED');
    expect(r.label).toBe(PRICE_STATE_LABELS.LIVE_VERIFIED);
    expect(r.reason).toMatch(/2 days/);
  });

  it('HISTORICAL_VERIFIED: verified + a check 11 days old', () => {
    const r = derivePriceState({
      priceVerificationStatus: 'verified',
      priceVerifiedAt: '2026-11-02T07:13:52.000Z',
      hasRecordedPrice: true,
      now: NOW,
    });
    expect(r.state).toBe('HISTORICAL_VERIFIED');
    expect(r.reason).toMatch(/expired/);
  });

  it('HISTORICAL_VERIFIED: verified stamp with NO check date lapses (F-P1-01)', () => {
    const r = derivePriceState({
      priceVerificationStatus: 'verified',
      priceVerifiedAt: null,
      hasRecordedPrice: true,
      now: NOW,
    });
    expect(r.state).toBe('HISTORICAL_VERIFIED');
    expect(r.reason).toMatch(/no check date/);
  });

  it('UNVERIFIED: unverified + a fresh recorded price', () => {
    const r = derivePriceState({
      priceVerificationStatus: 'unverified',
      priceAgeDays: 1,
      hasRecordedPrice: true,
      now: NOW,
    });
    expect(r.state).toBe('UNVERIFIED');
  });

  it('UNVERIFIED: unknown age is never read as fresh', () => {
    const r = derivePriceState({
      priceVerificationStatus: 'unverified',
      priceAgeDays: null,
      hasRecordedPrice: true,
      now: NOW,
    });
    expect(r.state).toBe('UNVERIFIED');
    expect(r.reason).toMatch(/must not be read as fresh/);
  });

  it('STALE: unverified + an 11-day-old recorded price', () => {
    const r = derivePriceState({
      priceVerificationStatus: 'unverified',
      priceAgeDays: 11,
      hasRecordedPrice: true,
      now: NOW,
    });
    expect(r.state).toBe('STALE');
  });

  it('SOURCE_UNAVAILABLE: no recorded price at all', () => {
    const r = derivePriceState({
      priceVerificationStatus: 'unverified',
      priceAgeDays: null,
      hasRecordedPrice: false,
      hasLiveSource: false,
      now: NOW,
    });
    expect(r.state).toBe('SOURCE_UNAVAILABLE');
    expect(r.reason).toMatch(/No price is recorded/);
  });

  it('a recorded price is never SOURCE_UNAVAILABLE even with no live source', () => {
    const r = derivePriceState({
      priceVerificationStatus: 'unverified',
      priceAgeDays: 11,
      hasRecordedPrice: true,
      hasLiveSource: false,
      now: NOW,
    });
    expect(r.state).toBe('STALE');
    expect(r.reason).toMatch(/cannot be re-checked|No live source/);
  });

  it('precedence: verified + fresh beats everything else', () => {
    const r = derivePriceState({
      priceVerificationStatus: 'verified',
      priceAgeDays: 0,
      hasRecordedPrice: true,
      hasLiveSource: false,
      now: NOW,
    });
    expect(r.state).toBe('LIVE_VERIFIED');
  });

  it('reconciliation: PriceState -> DataQualityState is the stated lossy map', () => {
    expect(PRICE_STATE_TO_DATA_QUALITY_STATE).toEqual({
      LIVE_VERIFIED: 'verified',
      HISTORICAL_VERIFIED: 'stale',
      UNVERIFIED: 'unverified',
      STALE: 'stale',
      SOURCE_UNAVAILABLE: 'missing',
    });
  });

  it('reconciliation: DataQualityState -> PriceState disambiguates via stored status + age', () => {
    // 'stale' with a verified stamp = was-verified-then-expired.
    expect(
      priceStateFromDataQualityState('stale', {
        priceVerificationStatus: 'verified',
        priceAgeDays: 11,
        now: NOW,
      }).state
    ).toBe('HISTORICAL_VERIFIED');
    // 'stale' never verified = old recorded price.
    expect(
      priceStateFromDataQualityState('stale', {
        priceVerificationStatus: 'unverified',
        priceAgeDays: 11,
        now: NOW,
      }).state
    ).toBe('STALE');
    // 'partial' folds into UNVERIFIED — the price itself was never verified.
    expect(
      priceStateFromDataQualityState('partial', {
        priceVerificationStatus: 'unverified',
        priceAgeDays: 1,
        now: NOW,
      }).state
    ).toBe('UNVERIFIED');
    // 'verified' + fresh = LIVE_VERIFIED; 'missing' = SOURCE_UNAVAILABLE.
    expect(
      priceStateFromDataQualityState('verified', {
        priceVerificationStatus: 'verified',
        priceAgeDays: 0,
        now: NOW,
      }).state
    ).toBe('LIVE_VERIFIED');
    expect(
      priceStateFromDataQualityState('missing', {
        priceVerificationStatus: 'unverified',
        priceAgeDays: null,
        now: NOW,
      }).state
    ).toBe('SOURCE_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// F-P1-06 — the whole-record fully-verified definition.
// ---------------------------------------------------------------------------

describe('F-P1-06 isFullyVerified — the whole-record gate', () => {
  it('true only when every criterion passes', () => {
    const r = isFullyVerified(completeVerifiedInput());
    expect(r.fullyVerified).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.reasons).toEqual([]);
    expect(r.checks).toHaveLength(9);
    expect(r.checks.every((c) => c.passed)).toBe(true);
  });

  it('fails closed: unknown counts are missing, never present', () => {
    const r = isFullyVerified({
      name: 'MacBook Air 13',
      brand: 'Apple',
      category: 'Laptops',
      description: 'A thin laptop.',
      modelNumber: 'MLY13',
      gtin: VALID_GTIN,
      imageUrl: 'https://cdn.example.com/macbook-air-13.jpg',
      priceVerificationStatus: 'verified',
      priceVerifiedAt: '2026-11-13T10:00:00.000Z',
      // specCount / imageCount / merchantCount / flags all unknown.
      now: NOW,
    });
    expect(r.fullyVerified).toBe(false);
    expect(r.missing).toContain('Specifications');
    expect(r.missing).toContain('Merchant listing');
    expect(r.missing).toContain('Source attribution');
  });

  it('names each missing criterion — the live-catalog shape fails on everything', () => {
    const r = isFullyVerified({
      name: 'MacBook Air 13',
      brand: 'Apple',
      category: null,
      description: null,
      modelNumber: null,
      gtin: null,
      imageUrl: null,
      priceVerificationStatus: 'unverified',
      priceVerifiedAt: null,
      specCount: 0,
      imageCount: 0,
      merchantCount: 1,
      hasRealMerchantListing: null,
      hasPriceSource: false,
      now: NOW,
    });
    expect(r.fullyVerified).toBe(false);
    expect(r.missing).toEqual([
      'Identity',
      'Model number',
      'GTIN',
      'Specifications',
      'Image',
      'Merchant listing',
      'Source attribution',
      'Fresh verified price',
      'Verification timestamp',
    ]);
  });

  it('merchant rows with no recorded SKU are NOT a real listing', () => {
    const r = isFullyVerified({
      ...completeVerifiedInput(),
      hasRealMerchantListing: null,
    });
    expect(r.fullyVerified).toBe(false);
    expect(r.missing).toContain('Merchant listing');
    expect(r.reasons.join(' ')).toMatch(/no merchant SKU recorded/);
  });

  it('a verified stamp with no check date fails both freshPrice and verifiedAt', () => {
    const r = isFullyVerified({
      ...completeVerifiedInput(),
      priceVerifiedAt: null,
    });
    expect(r.fullyVerified).toBe(false);
    expect(r.missing).toContain('Fresh verified price');
    expect(r.missing).toContain('Verification timestamp');
  });

  it('an expired verified check fails freshPrice but passes verifiedAt', () => {
    const r = isFullyVerified({
      ...completeVerifiedInput(),
      priceVerifiedAt: '2026-11-02T07:13:52.000Z',
    });
    expect(r.fullyVerified).toBe(false);
    expect(r.missing).toContain('Fresh verified price');
    expect(r.missing).not.toContain('Verification timestamp');
  });

  it('an invalid GTIN fails the GTIN criterion', () => {
    const r = isFullyVerified({ ...completeVerifiedInput(), gtin: '1234567890123' });
    expect(r.fullyVerified).toBe(false);
    expect(r.missing).toContain('GTIN');
    expect(r.reasons.join(' ')).toMatch(/GS1/);
  });

  it('modelNumberApplicable: false passes the model criterion', () => {
    const r = isFullyVerified({
      ...completeVerifiedInput(),
      modelNumber: null,
      modelNumberApplicable: false,
    });
    expect(r.fullyVerified).toBe(true);
  });

  it('an image gallery row passes the image criterion without a URL', () => {
    const r = isFullyVerified({
      ...completeVerifiedInput(),
      imageUrl: null,
      imageCount: 2,
    });
    expect(r.fullyVerified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F-P0-02 / F-P0-03 / F-P1-01 — the products-row verification stamp.
// ---------------------------------------------------------------------------

type FakeRow = Record<string, unknown>;

function verificationFakeClient(opts: {
  updateError?: { code?: string; message?: string } | null;
  rowsByTable?: Record<string, FakeRow[]>;
} = {}) {
  const updates: Array<{ table: string; patch: FakeRow; filters: Array<{ op: string; column: string; value: unknown }> }> = [];
  const client = {
    updates,
    from(table: string) {
      const chain: Record<string, unknown> = {};
      let patch: FakeRow = {};
      const filters: Array<{ op: string; column: string; value: unknown }> = [];
      chain.update = (p: FakeRow) => {
        patch = p;
        return chain;
      };
      chain.eq = (column: string, value: unknown) => {
        filters.push({ op: 'eq', column, value });
        return chain;
      };
      chain.is = (column: string, value: unknown) => {
        filters.push({ op: 'is', column, value });
        return chain;
      };
      chain.lt = (column: string, value: unknown) => {
        filters.push({ op: 'lt', column, value });
        return chain;
      };
      chain.select = () => chain;
      chain.then = (
        onFulfilled: (v: { data: FakeRow[] | null; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => {
        updates.push({ table, patch, filters });
        const err = opts.updateError ?? null;
        const data = err
          ? null
          : ((opts.rowsByTable?.[table] ?? [{ id: 'p-1' }]) as FakeRow[]).filter((row) => {
              for (const f of filters) {
                const v = row[f.column];
                if (f.op === 'eq' && v !== f.value) return false;
                if (f.op === 'is' && v !== f.value) return false;
                if (f.op === 'lt' && !(typeof v === 'string' && v < String(f.value)))
                  return false;
              }
              return true;
            });
        return Promise.resolve({ data, error: err }).then(onFulfilled as never, onRejected as never);
      };
      return chain;
    },
  };
  return client;
}

describe('F-P0-02/F-P0-03 markProductVerified — the products-row stamp', () => {
  const evidence = {
    source: 'ebay-browse-api' as const,
    verifiedAt: '2026-11-13T12:00:00.000Z',
  };

  it('writes the verified stamp onto the products row', async () => {
    const client = verificationFakeClient();
    const r = await markProductVerified(client as never, 'p-1', evidence);
    expect(r.updated).toBe(true);
    expect(client.updates).toHaveLength(1);
    expect(client.updates[0]).toMatchObject({
      table: 'products',
      patch: {
        price_verification_status: 'verified',
        price_verified_at: '2026-11-13T12:00:00.000Z',
      },
    });
    expect(client.updates[0].filters).toContainEqual({
      op: 'eq',
      column: 'id',
      value: 'p-1',
    });
  });

  it('never stamps verified without a real provider response: manual-intake is refused', async () => {
    const client = verificationFakeClient();
    const r = await markProductVerified(client as never, 'p-1', {
      source: 'manual-intake',
      verifiedAt: '2026-11-13T12:00:00.000Z',
    });
    expect(r.updated).toBe(false);
    expect(r.error).toMatch(/manual-intake/);
    expect(client.updates).toHaveLength(0);
  });

  it('refuses an unparseable verifiedAt instead of stamping a bad date', async () => {
    const client = verificationFakeClient();
    const r = await markProductVerified(client as never, 'p-1', {
      source: 'ebay-browse-api',
      verifiedAt: 'not-a-date',
    });
    expect(r.updated).toBe(false);
    expect(r.error).toMatch(/check time/);
    expect(client.updates).toHaveLength(0);
  });

  it('42703 (migration 045 unapplied) reports columnsMissing instead of throwing', async () => {
    const client = verificationFakeClient({
      updateError: { code: '42703', message: 'column does not exist' },
    });
    const r = await markProductVerified(client as never, 'p-1', evidence);
    expect(r.updated).toBe(false);
    expect(r.columnsMissing).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('a non-42703 error is reported, never thrown', async () => {
    const client = verificationFakeClient({
      updateError: { code: '23505', message: 'conflict' },
    });
    const r = await markProductVerified(client as never, 'p-1', evidence);
    expect(r.updated).toBe(false);
    expect(r.columnsMissing).toBe(false);
    expect(r.error).toMatch(/conflict/);
  });
});

describe('F-P1-01 shouldFlipVerifiedToStale + flipStaleVerificationStatuses', () => {
  it('verified + no check date must lapse (a dateless stamp is not verified forever)', () => {
    expect(shouldFlipVerifiedToStale('verified', null, NOW)).toBe(true);
  });

  it('verified + fresh check stays verified', () => {
    expect(shouldFlipVerifiedToStale('verified', '2026-11-11T12:00:00.000Z', NOW)).toBe(false);
  });

  it('verified + old check lapses', () => {
    expect(shouldFlipVerifiedToStale('verified', '2026-11-02T07:13:52.000Z', NOW)).toBe(true);
  });

  it('unverified / stale / missing never flip', () => {
    expect(shouldFlipVerifiedToStale('unverified', '2026-10-14T12:00:00.000Z', NOW)).toBe(false);
    expect(shouldFlipVerifiedToStale('stale', '2026-10-14T12:00:00.000Z', NOW)).toBe(false);
    expect(shouldFlipVerifiedToStale(null, null, NOW)).toBe(false);
  });

  it('flips verified rows with a NULL price_verified_at on products AND merchant_products', async () => {
    const rowsByTable: Record<string, FakeRow[]> = {
      products: [
        { id: 'p-old', price_verification_status: 'verified', price_verified_at: '2026-11-02T07:13:52.000Z' },
        { id: 'p-dateless', price_verification_status: 'verified', price_verified_at: null },
        { id: 'p-fresh', price_verification_status: 'verified', price_verified_at: '2026-11-12T12:00:00.000Z' },
      ],
      merchant_products: [
        { id: 'm-old', price_verification_status: 'verified', price_verified_at: '2026-11-02T07:13:52.000Z', deleted_at: null },
        { id: 'm-dateless', price_verification_status: 'verified', price_verified_at: null, deleted_at: null },
        { id: 'm-fresh', price_verification_status: 'verified', price_verified_at: '2026-11-12T12:00:00.000Z', deleted_at: null },
      ],
    };
    const client = verificationFakeClient({ rowsByTable });
    const r = await flipStaleVerificationStatuses(client as never, NOW);
    // Old + dateless flip on each table; the fresh row stays verified.
    expect(r.flippedProducts).toBe(2);
    expect(r.flippedMerchantRows).toBe(2);
    const nullDateFlip = client.updates.find((u) =>
      u.filters.some((f) => f.op === 'is' && f.column === 'price_verified_at' && f.value === null)
    );
    expect(nullDateFlip).toBeDefined();
    expect(nullDateFlip?.patch).toMatchObject({ price_verification_status: 'stale' });
  });

  it('42703 reports columnsMissing and flips nothing', async () => {
    const client = verificationFakeClient({
      updateError: { code: '42703', message: 'column does not exist' },
    });
    const r = await flipStaleVerificationStatuses(client as never, NOW);
    expect(r.columnsMissing).toBe(true);
    expect(r.flippedProducts).toBe(0);
    expect(r.flippedMerchantRows).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F-P0-03 — the admin verification action (both columns patchable).
// ---------------------------------------------------------------------------

describe('F-P0-03 validateAdminProductPatch — the admin verification action', () => {
  it('accepts both verification columns together', () => {
    const r = validateAdminProductPatch({
      price_verification_status: 'verified',
      // A past check date: the validator refuses future dates.
      price_verified_at: '2026-11-12T10:00:00.000Z',
    });
    expect(r.error).toBeUndefined();
    expect(r.patch).toMatchObject({
      price_verification_status: 'verified',
      price_verified_at: '2026-11-12T10:00:00.000Z',
    });
  });

  it('refuses a verified stamp with no check date in the same edit', () => {
    const r = validateAdminProductPatch({ price_verification_status: 'verified' });
    expect(r.patch).toBeNull();
    expect(r.error).toMatch(/requires "price_verified_at"/);
  });

  it('refuses a verified stamp with the date explicitly cleared', () => {
    const r = validateAdminProductPatch({
      price_verification_status: 'verified',
      price_verified_at: null,
    });
    expect(r.patch).toBeNull();
    expect(r.error).toMatch(/requires "price_verified_at"/);
  });

  it('refuses a check date in the future', () => {
    const r = validateAdminProductPatch({
      price_verification_status: 'verified',
      price_verified_at: '2099-01-01T00:00:00.000Z',
    });
    expect(r.patch).toBeNull();
    expect(r.error).toMatch(/must not be in the future/);
  });

  it('refuses an unparseable check date', () => {
    const r = validateAdminProductPatch({ price_verified_at: 'not-a-date' });
    expect(r.patch).toBeNull();
    expect(r.error).toMatch(/valid ISO date/);
  });

  it('refuses a status outside the migration-045 enum', () => {
    const r = validateAdminProductPatch({ price_verification_status: 'confirmed' });
    expect(r.patch).toBeNull();
    expect(r.error).toMatch(/one of: unverified, verified, stale/);
  });

  it('allows correcting the date alone on an already-verified row', () => {
    const r = validateAdminProductPatch({ price_verified_at: '2026-11-12T10:00:00.000Z' });
    expect(r.error).toBeUndefined();
    expect(r.patch).toMatchObject({ price_verified_at: '2026-11-12T10:00:00.000Z' });
  });

  it('the Zod shape gate accepts the new fields', () => {
    const r = validateBody(adminProductPatchSchema, {
      price_verification_status: 'verified',
      price_verified_at: '2026-11-13T10:00:00.000Z',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toMatchObject({ price_verification_status: 'verified' });
    }
  });
});

// ---------------------------------------------------------------------------
// F-P1-15 / F-P1-30 — per-row verification flag + assumed-USD flag.
// ---------------------------------------------------------------------------

function historyInsertFake(missingColumns: string[]) {
  const attempts: Array<Record<string, unknown>> = [];
  const stored: Array<Record<string, unknown>> = [];
  const client = {
    attempts,
    stored,
    from(table: string) {
      if (table !== 'price_history') throw new Error(`unexpected table ${table}`);
      return {
        insert: async (row: Record<string, unknown>) => {
          attempts.push(row);
          const missing = Object.keys(row).find((k) => missingColumns.includes(k));
          if (missing) {
            return { error: { code: '42703', message: `column "${missing}" does not exist` } };
          }
          stored.push(row);
          return { error: null };
        },
      };
    },
  };
  return client;
}

const HISTORY_POINT = {
  product_id: 'p-1',
  retailer_id: 'r-amazon',
  price: 899,
  currency: 'USD',
  availability: 'in_stock',
  source: 'ebay-browse-api' as const,
  recorded_at: '2026-11-13T12:00:00.000Z',
};

describe('F-P1-15/F-P1-30 insertPriceHistoryRow — flags ride the tiered retry', () => {
  it('persists both flags when the columns exist (tier 1, one attempt)', async () => {
    const client = historyInsertFake([]);
    const r = await insertPriceHistoryRow(client as never, {
      ...HISTORY_POINT,
      verified: true,
      currencyAssumed: true,
    });
    expect(r.error).toBeNull();
    expect(r.verifiedPersisted).toBe(true);
    expect(r.currencyAssumedPersisted).toBe(true);
    expect(client.attempts).toHaveLength(1);
    expect(client.stored[0]).toMatchObject({ verified: true, currency_assumed: true });
  });

  it('drops the flags and reports them when their columns do not exist yet', async () => {
    const client = historyInsertFake(['verified', 'currency_assumed']);
    const r = await insertPriceHistoryRow(client as never, {
      ...HISTORY_POINT,
      verified: true,
      currencyAssumed: true,
    });
    expect(r.error).toBeNull();
    expect(r.verifiedPersisted).toBe(false);
    expect(r.currencyAssumedPersisted).toBe(false);
    // Tier 1 (flags) 42703 → tier 2 (no flags) lands: the row is
    // still recorded, just without the flags — never silently kept.
    expect(client.attempts).toHaveLength(2);
    expect(client.stored).toHaveLength(1);
    expect(client.stored[0]).not.toHaveProperty('verified');
    expect(client.stored[0]).not.toHaveProperty('currency_assumed');
    expect(client.stored[0]).toMatchObject({ currency_code: 'USD', source: 'ebay-browse-api' });
  });

  it('a no-flag caller is byte-identical to before (one attempt when columns exist)', async () => {
    const client = historyInsertFake([]);
    const r = await insertPriceHistoryRow(client as never, { ...HISTORY_POINT });
    expect(r.error).toBeNull();
    expect(r.verifiedPersisted).toBe(false);
    expect(r.currencyAssumedPersisted).toBe(false);
    expect(client.attempts).toHaveLength(1);
    expect(client.attempts[0]).not.toHaveProperty('verified');
    expect(client.attempts[0]).not.toHaveProperty('currency_assumed');
  });

  it('a non-42703 error is returned, not retried into silence', async () => {
    const client = {
      from: () => ({
        insert: async () => ({ error: { code: '23505', message: 'duplicate key' } }),
      }),
    };
    const r = await insertPriceHistoryRow(client as never, { ...HISTORY_POINT, verified: true });
    expect(r.error).toMatchObject({ code: '23505' });
    expect(r.verifiedPersisted).toBe(false);
  });
});

function historyReaderFake(opts: { missingColumns: string[]; rows: FakeRow[] }) {
  const selects: string[] = [];
  const client = {
    selects,
    from(table: string) {
      if (table !== 'price_history') throw new Error(`unexpected table ${table}`);
      const chain: Record<string, unknown> = {};
      chain.select = (columns: string) => {
        selects.push(columns);
        return chain;
      };
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.then = (
        onFulfilled: (v: { data: FakeRow[] | null; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => {
        const lastSelect = selects[selects.length - 1];
        const missing = opts.missingColumns.find((c) => lastSelect.includes(c));
        if (missing) {
          return Promise.resolve({
            data: null,
            error: { code: '42703', message: `column "${missing}" does not exist` },
          }).then(onFulfilled as never, onRejected as never);
        }
        return Promise.resolve({ data: opts.rows, error: null }).then(
          onFulfilled as never,
          onRejected as never
        );
      };
      return chain;
    },
  };
  return client;
}

const HISTORY_ROW = {
  product_id: 'p-1',
  retailer_id: 'r-amazon',
  price: 899,
  currency: 'USD',
  availability: 'in_stock',
  url: null,
  recorded_at: '2026-11-13T12:00:00.000Z',
  source: 'ebay-browse-api',
  observed_at: '2026-11-13T12:00:00.000Z',
  suspicious_change: false,
  verified: true,
  currency_assumed: false,
};

describe('F-P1-15 getPriceHistory — the reader maps the flags', () => {
  it('maps verified / currencyAssumed / source / observedAt on the row', async () => {
    const client = historyReaderFake({ missingColumns: [], rows: [HISTORY_ROW] });
    const r = await getPriceHistory(client as never, 'p-1');
    expect(r.history).toHaveLength(1);
    expect(r.history[0]).toMatchObject({
      price: 899,
      source: 'ebay-browse-api',
      verified: true,
      currencyAssumed: false,
      suspicious: false,
    });
    expect(r.currentPrice).toBe(899);
  });

  it('falls back on 42703 and reports the flags as null, never guessed', async () => {
    const client = historyReaderFake({
      missingColumns: ['verified', 'currency_assumed'],
      rows: [{ ...HISTORY_ROW, verified: undefined, currency_assumed: undefined }],
    });
    const r = await getPriceHistory(client as never, 'p-1');
    expect(r.history).toHaveLength(1);
    expect(r.history[0].verified).toBeNull();
    expect(r.history[0].currencyAssumed).toBeNull();
    // Provenance survived the fallback — the retry kept the 057 columns.
    expect(r.history[0].source).toBe('ebay-browse-api');
    expect(client.selects.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// F-P1-06 / F-P1-29 — the scorer now surfaces priceState + fullyVerified.
// ---------------------------------------------------------------------------

describe('computeProductQualityScore — priceState + fullyVerified surfaces', () => {
  it('a complete, freshly-verified record is LIVE_VERIFIED and fully verified', () => {
    const r = computeProductQualityScore(
      {
        name: 'MacBook Air 13',
        brand: 'Apple',
        category: 'Laptops',
        description: 'A thin laptop.',
        imageUrl: 'https://cdn.example.com/macbook-air-13.jpg',
        gtin: VALID_GTIN,
        modelNumber: 'MLY13',
        priceVerificationStatus: 'verified',
        priceVerifiedAt: '2026-11-13T10:00:00.000Z',
      },
      {
        specCount: 3,
        imageCount: 1,
        merchantCount: 2,
        priceSource: 'ebay-browse-api',
        hasRealMerchantListing: true,
        lastPriceRecordedAt: '2026-11-13T10:00:00.000Z',
      },
      NOW
    );
    expect(r.priceState.state).toBe('LIVE_VERIFIED');
    expect(r.fullyVerified.fullyVerified).toBe(true);
  });

  it('the live-catalog shape is STALE and not fully verified', () => {
    const r = computeProductQualityScore(
      {
        name: 'MacBook Air 13',
        brand: 'Apple',
        category: null,
        description: null,
        imageUrl: null,
        gtin: null,
        modelNumber: null,
        priceVerificationStatus: 'unverified',
        priceVerifiedAt: null,
        dataFreshness: '2026-11-02T07:13:52.000Z',
      },
      {
        specCount: 0,
        imageCount: 0,
        merchantCount: 1,
        priceSource: null,
        hasRealMerchantListing: null,
        lastPriceRecordedAt: '2026-11-02T07:13:52.000Z',
      },
      NOW
    );
    expect(r.priceState.state).toBe('STALE');
    expect(r.fullyVerified.fullyVerified).toBe(false);
    expect(r.fullyVerified.missing.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// F-P1-34 / F-P1-30 — per-merchant history + assumed-USD persisted.
// ---------------------------------------------------------------------------

function refreshTrackedFakeClient() {
  const historyInserts: Array<Record<string, unknown>> = [];
  const updates: Array<{ table: string; patch: FakeRow }> = [];
  const client = {
    historyInserts,
    updates,
    from(table: string) {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.is = () => chain;
      chain.lt = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.delete = () => chain;
      chain.update = (patch: FakeRow) => {
        updates.push({ table, patch });
        return chain;
      };
      chain.insert = async (row: Record<string, unknown>) => {
        if (table === 'price_history') {
          historyInserts.push(row);
          return { error: null };
        }
        return { error: null };
      };
      chain.then = (
        onFulfilled: (v: { data: FakeRow[] | null; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => {
        let data: FakeRow[] = [];
        if (table === 'merchants') {
          data = [
            { id: 'm-amazon', slug: 'amazon' },
            { id: 'm-bestbuy', slug: 'best-buy' },
          ];
        } else if (table === 'retailers') {
          data = [
            { id: 'r-amazon', slug: 'amazon' },
            { id: 'r-bestbuy', slug: 'best-buy' },
          ];
        } else if (table === 'currencies') {
          data = [{ id: 'cur-usd', code: 'USD' }];
        }
        return Promise.resolve({ data, error: null }).then(
          onFulfilled as never,
          onRejected as never
        );
      };
      return chain;
    },
  };
  return client;
}

function refreshShared(opts: {
  merchantRows: Array<Record<string, unknown>>;
  historyRows?: Array<Record<string, unknown>>;
}) {
  return {
    refreshIds: ['p-1'],
    stockIds: ['p-1'],
    guestProductIds: [],
    merchantRows: opts.merchantRows as never,
    historyRows: (opts.historyRows ?? []) as never,
  };
}

const AMAZON_ROW = {
  product_id: 'p-1',
  merchant_id: 'm-amazon',
  price: 899,
  availability: 'in_stock',
  url: 'https://www.amazon.com/dp/B0EXAMPLE',
  in_stock: true,
  currency_id: null,
  updated_at: '2026-11-13T10:00:00.000Z',
};
const BESTBUY_ROW = {
  product_id: 'p-1',
  merchant_id: 'm-bestbuy',
  price: 949,
  availability: 'in_stock',
  url: 'https://www.bestbuy.com/site/example',
  in_stock: true,
  currency_id: null,
  updated_at: '2026-11-13T10:00:00.000Z',
};

describe('F-P1-34 refreshTrackedPrices — history per merchant, not just the lowest', () => {
  it('records a history row for EVERY in-stock merchant (Best Buy included)', async () => {
    const client = refreshTrackedFakeClient();
    const r = await refreshTrackedPrices(
      client as never,
      refreshShared({ merchantRows: [AMAZON_ROW, BESTBUY_ROW] })
    );
    expect(r.tracked).toBe(1);
    expect(r.inserted).toBe(2);
    expect(r.unchanged).toBe(0);
    const retailerIds = client.historyInserts.map((i) => i.retailer_id).sort();
    expect(retailerIds).toEqual(['r-amazon', 'r-bestbuy']);
    const prices = client.historyInserts.map((i) => i.price).sort();
    expect(prices).toEqual([899, 949]);
  });

  it('lowest unchanged + other changed records exactly one row', async () => {
    const client = refreshTrackedFakeClient();
    const r = await refreshTrackedPrices(
      client as never,
      refreshShared({
        merchantRows: [AMAZON_ROW, BESTBUY_ROW],
        historyRows: [
          {
            product_id: 'p-1',
            retailer_id: 'r-amazon',
            price: 899,
            availability: 'in_stock',
            recorded_at: '2026-11-13T10:00:00.000Z',
          },
        ],
      })
    );
    expect(r.inserted).toBe(1);
    expect(r.unchanged).toBe(1);
    expect(client.historyInserts).toHaveLength(1);
    expect(client.historyInserts[0].retailer_id).toBe('r-bestbuy');
  });

  it('F-P1-30: assumed USD is persisted on the history row (flag + count)', async () => {
    const client = refreshTrackedFakeClient();
    const r = await refreshTrackedPrices(
      client as never,
      refreshShared({ merchantRows: [AMAZON_ROW, BESTBUY_ROW] })
    );
    // Both rows carry currency_id NULL, so both are assumed USD.
    expect(r.currencyAssumedUsd).toBe(2);
    expect(r.currencyAssumedPersisted).toBe(2);
    expect(client.historyInserts.every((i) => i.currency_assumed === true)).toBe(true);
    // A re-read row is never a validated provider response:
    // no `verified` flag may ride on it.
    expect(client.historyInserts.every((i) => !('verified' in i))).toBe(true);
  });

  it('F-P1-30: a genuinely observed currency carries no assumed flag', async () => {
    const client = refreshTrackedFakeClient();
    const r = await refreshTrackedPrices(
      client as never,
      refreshShared({
        merchantRows: [
          { ...AMAZON_ROW, currency_id: 'cur-usd' },
          { ...BESTBUY_ROW, currency_id: 'cur-usd' },
        ],
      })
    );
    expect(r.currencyAssumedUsd).toBe(0);
    expect(r.currencyAssumedPersisted).toBe(0);
    expect(client.historyInserts.every((i) => !('currency_assumed' in i))).toBe(true);
  });

  it('the re-check is recorded once per product, not once per merchant', async () => {
    const client = refreshTrackedFakeClient();
    await refreshTrackedPrices(
      client as never,
      refreshShared({ merchantRows: [AMAZON_ROW, BESTBUY_ROW] })
    );
    const rechecks = client.updates.filter(
      (u) => u.table === 'products' && u.patch.refresh_status === 'idle'
    );
    expect(rechecks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// F-P1-28 — a no-provider run is never recorded as 'completed'.
// ---------------------------------------------------------------------------

describe('F-P1-28 resolveRefreshRunStatus — the K10b fix', () => {
  it('zero live prices + zero failures = completed_no_live_source', () => {
    expect(
      resolveRefreshRunStatus({ failedSteps: 0, totalSteps: 5, livePricesFetched: 0 })
    ).toBe('completed_no_live_source');
  });

  it('one live price + zero failures = completed', () => {
    expect(
      resolveRefreshRunStatus({ failedSteps: 0, totalSteps: 5, livePricesFetched: 1 })
    ).toBe('completed');
  });

  it('some failures = completed_with_failures, even with live prices', () => {
    expect(
      resolveRefreshRunStatus({ failedSteps: 2, totalSteps: 5, livePricesFetched: 3 })
    ).toBe('completed_with_failures');
  });

  it('all steps failed = failed', () => {
    expect(
      resolveRefreshRunStatus({ failedSteps: 5, totalSteps: 5, livePricesFetched: 0 })
    ).toBe('failed');
  });

  it('the refresh route uses the resolver and returns its status + live count', () => {
    const src = repoFile('app', 'api', 'v1', 'prices', 'refresh', 'route.ts');
    expect(src).toContain('resolveRefreshRunStatus');
    expect(src).toContain('completed_no_live_source');
    expect(src).toContain('status: overallStatus');
    expect(src).toContain('livePricesFetched');
    expect(src).not.toContain("? 'completed'");
  });

  it('the /status page renders the no-live-source state honestly', () => {
    const src = repoFile('app', 'status', 'page.tsx');
    expect(src).toContain('completed_no_live_source');
    expect(src).toContain('fetched no live price');
  });

  it('migration 040 (unapplied) accepts the new status value', () => {
    const sql = repoFile(
      'supabase',
      'migrations',
      '20261112093000_040_price_refresh_runs.sql'
    );
    expect(sql).toContain('completed_no_live_source');
  });
});

// ---------------------------------------------------------------------------
// F-P1-06 — the publishing gate reports the verdict at approve time.
// ---------------------------------------------------------------------------

describe('F-P1-06 intake approve — the publishing gate verdict', () => {
  it('the approve route reports a per-product fully-verified verdict', () => {
    const src = repoFile('app', 'api', 'v1', 'admin', 'intake', 'route.ts');
    expect(src).toContain('isFullyVerified');
    expect(src).toContain('verification,');
    expect(src).toContain('fullyVerifiedCount');
  });
});

// ---------------------------------------------------------------------------
// F-P0-02 — the eBay leg stamps the PRODUCTS row, not just the listing.
// ---------------------------------------------------------------------------

// The in-memory fake from tests/ebay-refresh.test.ts, adapted: the
// Builder records every products update, and can fail the
// verification-column update with 42703 (migration 045 unapplied)
// while letting the other updates through.
type Row = Record<string, unknown>;

class EbayBuilder {
  private filters: Array<(row: Row) => boolean> = [];
  private orders: Array<{ field: string; asc: boolean }> = [];
  private limitN: number | null = null;
  private patch: Row | null = null;
  private insertRow: Row | null = null;
  private mode: 'select' | 'insert' | 'update' = 'select';

  constructor(
    private table: Row[],
    private tableName: string,
    private failVerificationUpdate: boolean
  ) {}

  select(): this {
    return this;
  }
  eq(field: string, value: unknown): this {
    this.filters.push((r) => r[field] === value);
    return this;
  }
  in(field: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(r[field]));
    return this;
  }
  is(field: string, value: unknown): this {
    this.filters.push((r) => r[field] === value);
    return this;
  }
  lte(field: string, value: unknown): this {
    this.filters.push(
      (r) => typeof r[field] === 'string' && (r[field] as string) <= (value as string)
    );
    return this;
  }
  order(field: string, opts: { ascending: boolean }): this {
    this.orders.push({ field, asc: opts.ascending });
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  insert(row: Row): this {
    this.mode = 'insert';
    this.insertRow = row;
    return this;
  }
  update(patch: Row): this {
    this.mode = 'update';
    this.patch = patch;
    return this;
  }
  not(field: string, op: string, value: unknown): this {
    if (op === 'is') this.filters.push((r) => r[field] !== value);
    return this;
  }

  private run(): Row[] {
    if (this.mode === 'insert' && this.insertRow) {
      const row = { id: `fake-${this.table.length + 1}`, ...this.insertRow };
      this.table.push(row);
      return [row];
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === 'update' && this.patch) {
      for (const row of rows) Object.assign(row, this.patch);
    }
    for (const { field, asc } of this.orders) {
      rows = [...rows].sort((a, b) => {
        const av = String(a[field] ?? '');
        const bv = String(b[field] ?? '');
        return asc ? (av < bv ? -1 : av > bv ? 1 : 0) : av > bv ? -1 : av < bv ? 1 : 0;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  private isVerificationUpdate(): boolean {
    return (
      this.mode === 'update' &&
      this.tableName === 'products' &&
      this.patch !== null &&
      'price_verification_status' in this.patch
    );
  }

  async maybeSingle(): Promise<{ data: Row | null; error: { code: string; message: string } | null }> {
    if (this.isVerificationUpdate() && this.failVerificationUpdate) {
      return { data: null, error: { code: '42703', message: 'column does not exist' } };
    }
    const rows = this.run();
    return { data: rows[0] ?? null, error: null };
  }
  async single(): Promise<{ data: Row | null; error: null }> {
    const rows = this.run();
    return { data: rows[0] ?? null, error: null };
  }
  then<TResult1 = { data: Row[] | null; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[] | null; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    if (this.isVerificationUpdate() && this.failVerificationUpdate) {
      return Promise.resolve({
        data: null,
        error: { code: '42703', message: 'column "price_verification_status" does not exist' },
      }).then(onfulfilled as never, onrejected as never);
    }
    return Promise.resolve({ data: this.run(), error: null }).then(
      onfulfilled as never,
      onrejected as never
    );
  }
}

function ebayFakeSupabase(opts: { failVerificationUpdate?: boolean } = {}) {
  const tables: Record<string, Row[]> = {
    merchants: [{ id: 'm-ebay', slug: 'ebay', name: 'eBay' }],
    currencies: [
      { id: 'cur-usd', code: 'USD' },
      { id: 'cur-eur', code: 'EUR' },
    ],
    products: [
      {
        id: 'p-macbook',
        name: 'MacBook Air 13',
        slug: 'macbook-air-13',
        brand: 'Apple',
        refresh_priority: 3,
        refresh_status: 'idle',
        next_refresh_at: '2026-11-01T00:00:00.000Z',
        data_freshness: '2026-11-02T07:13:52.000Z',
        deleted_at: null,
      },
    ],
    merchant_products: [],
    ebay_daily_usage: [{ usage_date: getEbayBudgetDateKey(new Date()), calls: 0 }],
    provider_health: [],
    error_log: [],
  };
  const client = {
    tables,
    from(table: string) {
      const rows = tables[table];
      if (!rows) throw new Error(`unexpected table ${table}`);
      return {
        select: () => new EbayBuilder(rows, table, opts.failVerificationUpdate ?? false),
        insert: (row: Row) => new EbayBuilder(rows, table, opts.failVerificationUpdate ?? false).insert(row),
        update: (patch: Row) => new EbayBuilder(rows, table, opts.failVerificationUpdate ?? false).update(patch),
      };
    },
  };
  return client;
}

function fakeListing(overrides: Partial<EbayListing> = {}): EbayListing {
  return {
    itemId: 'v1|ebay-1|0',
    title: 'Apple MacBook Air 13 inch Laptop M2 8GB 256GB',
    price: 899,
    currency: 'USD',
    condition: 'New',
    itemWebUrl: 'https://www.ebay.com/itm/ebay-1',
    imageUrl: null,
    ...overrides,
    gtin: overrides.gtin ?? null,
  };
}

describe('F-P0-02 refreshEbayPrices — the products-row rollup', () => {
  it('a matched live listing stamps the PRODUCTS row verified (not just the listing)', async () => {
    const client = ebayFakeSupabase();
    const result = await refreshEbayPrices(client as never, {
      searchFn: vi.fn(async () => ({ ok: true as const, source: 'ebay-browse-api' as const, listings: [fakeListing()] })),
    });
    expect(result.status).toBe('ok');
    // No merchant row existed, so the live listing is INSERTED
    // (updated counts only the update path) — the products-row
    // stamp runs after either path.
    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    const product = client.tables.products[0];
    expect(product.price_verification_status).toBe('verified');
    expect(typeof product.price_verified_at).toBe('string');
    expect(Number.isFinite(new Date(product.price_verified_at as string).getTime())).toBe(true);
    // The stamp is the real Browse check time, not a backfill:
    // it matches the merchant row's check time.
    const merchantRow = client.tables.merchant_products[0];
    expect(merchantRow).toBeDefined();
    expect(merchantRow.price_verified_at).toBe(product.price_verified_at);
  });

  it('a 42703 (migration 045 unapplied) never fails the refresh — the stamp is skipped', async () => {
    const client = ebayFakeSupabase({ failVerificationUpdate: true });
    const result = await refreshEbayPrices(client as never, {
      searchFn: vi.fn(async () => ({ ok: true as const, source: 'ebay-browse-api' as const, listings: [fakeListing()] })),
    });
    expect(result.status).toBe('ok');
    expect(result.inserted).toBe(1);
    const product = client.tables.products[0];
    expect(product.price_verification_status).toBeUndefined();
    // The listing still landed — only the products-row stamp was skipped.
    expect(client.tables.merchant_products).toHaveLength(1);
  });

  it('no matched listing stamps nothing', async () => {
    const client = ebayFakeSupabase();
    const result = await refreshEbayPrices(client as never, {
      searchFn: vi.fn(async () => ({
        ok: true as const,
        source: 'ebay-browse-api' as const,
        listings: [fakeListing({ title: 'Apple MacBook Pro 14 Laptop' })],
      })),
    });
    expect(result.updated).toBe(0);
    expect(result.inserted).toBe(0);
    expect(client.tables.products[0].price_verification_status).toBeUndefined();
    expect(client.tables.merchant_products).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F-P1-29 (resume) — the price state wired into the list API, the
// product page, and the admin surfaces; F-P1-15 — the flags ride
// the history export.
// ---------------------------------------------------------------------------

describe('F-P1-29 getProducts — priceState on every listed product with a price', () => {
  function listFakeClient(opts: { merchantRows: FakeRow[] }) {
    const productRow: FakeRow = {
      id: 'p-1',
      name: 'MacBook Air 13',
      slug: 'macbook-air-13',
      description: 'A thin laptop.',
      brand: 'Apple',
      category: 'Laptops',
      image_url: null,
      gtin: null,
      model_number: null,
      confidence_score: 50,
      data_freshness: '2026-11-02T07:13:52.000Z',
      created_at: '2026-11-02T07:13:52.000Z',
      updated_at: '2026-11-02T07:13:52.000Z',
      status: 'published',
      price_verification_status: 'unverified',
      price_verified_at: null,
    };
    class Chain {
      constructor(private table: string) {}
      select(): this { return this; }
      is(): this { return this; }
      neq(): this { return this; }
      eq(): this { return this; }
      in(): this { return this; }
      order(): this { return this; }
      range(): this { return this; }
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: never) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ): Promise<TResult1 | TResult2> {
        const value =
          this.table === 'products'
            ? { data: [productRow], error: null, count: 1 }
            : { data: opts.merchantRows, error: null };
        return Promise.resolve(value as never).then(onfulfilled as never, onrejected as never);
      }
    }
    return {
      from(table: string) {
        return new Chain(table);
      },
    };
  }

  it('attaches STALE to a listed product whose recorded price is 11 days old', async () => {
    const { getProducts } = await import('@/services/products');
    const client = listFakeClient({
      merchantRows: [
        {
          product_id: 'p-1',
          merchant_id: 'm-amazon',
          price: 899,
          compare_at_price: 1099,
          price_verification_status: 'unverified',
          price_source: 'manual-intake',
          price_verified_at: null,
        },
      ],
    });
    const r = await getProducts(client as never, {});
    expect(r.products).toHaveLength(1);
    // The live-catalog shape: unverified + 11 days old = STALE,
    // with the reason attached — never a bare label.
    expect(r.products[0].priceState?.state).toBe('STALE');
    expect(r.products[0].priceState?.reason).toMatch(/11 days/);
  });

  it('carries no priceState when no in-stock listing shows a price', async () => {
    const { getProducts } = await import('@/services/products');
    const client = listFakeClient({ merchantRows: [] });
    const r = await getProducts(client as never, {});
    expect(r.products).toHaveLength(1);
    expect(r.products[0].priceState).toBeUndefined();
  });
});

describe('F-P1-29 wiring — the surfaces render the derived state, not a second taxonomy', () => {
  it('the product page derives and renders the price state + reason', () => {
    const src = repoFile('app', 'products', '[slug]', 'page.tsx');
    expect(src).toContain('derivePriceState');
    expect(src).toContain('Price state:');
    expect(src).toContain('priceState.reason');
  });

  it('the admin product pages render score.priceState + the fully-verified verdict', () => {
    const detail = repoFile('app', 'admin', 'products', '[id]', 'page.tsx');
    expect(detail).toContain('score.priceState.label');
    expect(detail).toContain('score.fullyVerified.fullyVerified');
    const list = repoFile('app', 'admin', 'products', 'page.tsx');
    expect(list).toContain('score.priceState.label');
    expect(list).toContain('score.fullyVerified.fullyVerified');
  });

  it('the admin data-quality page renders the priceStates counts', () => {
    const src = repoFile('app', 'admin', 'data-quality', 'page.tsx');
    expect(src).toContain('summary.priceStates.LIVE_VERIFIED');
    expect(src).toContain('summary.priceStates.HISTORICAL_VERIFIED');
    expect(src).toContain('summary.priceStates.SOURCE_UNAVAILABLE');
  });
});

describe('F-P1-15 price-history export — the flags ride the export verbatim', () => {
  it('CSV carries source / observed_at / suspicious / verified / currency_assumed', async () => {
    const { priceHistoryRowsToCsv, PRICE_HISTORY_EXPORT_CSV_HEADERS } = await import(
      '@/lib/price-history-export'
    );
    expect(PRICE_HISTORY_EXPORT_CSV_HEADERS).toContain('verified,currency_assumed');
    const csv = priceHistoryRowsToCsv([
      {
        productSlug: 'macbook-air-13',
        productName: 'MacBook Air 13',
        price: 899,
        currency: 'USD',
        availability: 'in_stock',
        recordedAt: '2026-11-13T12:00:00.000Z',
        source: 'ebay-browse-api',
        observedAt: '2026-11-13T12:00:00.000Z',
        suspicious: false,
        verified: true,
        currencyAssumed: true,
      },
    ]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('ebay-browse-api');
    expect(lines[1]).toContain('true,true');
    expect(lines[1]).toContain('false');
  });

  it('unknown flags render empty, never guessed', async () => {
    const { priceHistoryRowsToCsv } = await import('@/lib/price-history-export');
    const csv = priceHistoryRowsToCsv([
      {
        productSlug: 'macbook-air-13',
        productName: 'MacBook Air 13',
        price: 899,
        currency: 'USD',
        availability: 'in_stock',
        recordedAt: '2026-11-02T07:13:52.000Z',
      },
    ]);
    const row = csv.trim().split('\n')[1];
    // Five trailing flag columns, all empty.
    expect(row.endsWith(',,,,')).toBe(true);
  });

  it('the export route maps the flags from getPriceHistory', () => {
    const src = repoFile('app', 'api', 'v1', 'price-history', 'export', 'route.ts');
    expect(src).toContain('verified: h.verified');
    expect(src).toContain('currencyAssumed: h.currencyAssumed');
    expect(src).toContain('source: h.source');
  });
});
