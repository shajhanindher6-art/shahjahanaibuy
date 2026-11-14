/**
 * Master Tool Integration, Stage 4 (S4-1) — ShoppingDecisionService tests.
 *
 * These tests cover ORCHESTRATION ONLY, with every delegate mocked:
 * the matrix, prediction and comparison math is NOT re-tested here
 * (their own test files cover it). What is asserted:
 * - delegates are composed in the right order (resolve → matrix →
 *   prediction → comparison);
 * - missing inputs are listed honestly in `dataQuality.missing`
 *   (unresolved slug, no listings, thin/stale history, no specs /
 *   GTIN / image / model number);
 * - the verdict is withheld when data is thin or stale, and issued
 *   only when every compared product clears the gate;
 * - single-product vs two-product paths (comparison absent vs
 *   present, cheaper-alternative price passed to the buy-wait
 *   delegate);
 * - every number in the result is attributed in `sources`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/tool-integration', () => ({
  getToolProduct: vi.fn(),
  getToolPriceHistory: vi.fn(),
  getToolMerchantProducts: vi.fn(),
}));
vi.mock('@/services/decision-matrix', () => ({
  buildMatrixRows: vi.fn(),
}));
vi.mock('@/services/buy-wait-prediction', () => ({
  predictBuyVsWait: vi.fn(),
  BUY_WAIT_MIN_POINTS: 5,
}));
vi.mock('@/services/ai-comparison', () => ({
  compareProducts: vi.fn(),
}));
vi.mock('@/services/commerce', () => ({
  getCoupons: vi.fn(),
  getMerchants: vi.fn(),
}));
vi.mock('@/services/products', () => ({
  getProductAttributes: vi.fn(),
}));

import { buildShoppingDecision } from '@/services/shopping-decision';
import {
  getToolProduct,
  getToolPriceHistory,
  getToolMerchantProducts,
} from '@/services/tool-integration';
import { buildMatrixRows, type MatrixRow } from '@/services/decision-matrix';
import {
  predictBuyVsWait,
  type BuyWaitPrediction,
} from '@/services/buy-wait-prediction';
import { compareProducts } from '@/services/ai-comparison';
import { getCoupons, getMerchants } from '@/services/commerce';
import { getProductAttributes } from '@/services/products';
import type { Product } from '@/types';
import type { MerchantProduct } from '@/types/catalog';
import type { ProductComparison } from '@/types/ai';
import type { AnySupabaseClient } from '@/lib/supabase/types';

const mockGetToolProduct = vi.mocked(getToolProduct);
const mockGetToolPriceHistory = vi.mocked(getToolPriceHistory);
const mockGetToolMerchantProducts = vi.mocked(getToolMerchantProducts);
const mockBuildMatrixRows = vi.mocked(buildMatrixRows);
const mockPredictBuyVsWait = vi.mocked(predictBuyVsWait);
const mockCompareProducts = vi.mocked(compareProducts);
const mockGetCoupons = vi.mocked(getCoupons);
const mockGetMerchants = vi.mocked(getMerchants);
const mockGetProductAttributes = vi.mocked(getProductAttributes);

const supabase = {} as AnySupabaseClient;

function fakeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    name: 'MacBook Air',
    slug: 'macbook-air',
    description: null,
    brand: 'Apple',
    category: 'Laptops',
    imageUrl: 'https://example.com/macbook.jpg',
    gtin: '0194253000001',
    modelNumber: 'M2',
    dataFreshness: new Date().toISOString(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    priceVerificationStatus: 'unverified',
    ...overrides,
  };
}

function fakeListing(overrides: Partial<MerchantProduct> = {}): MerchantProduct {
  return {
    id: 'mp-1',
    productId: 'prod-1',
    merchantId: 'merchant-amazon',
    merchantSku: null,
    price: 999,
    compareAtPrice: null,
    currencyId: null,
    availability: 'in_stock',
    url: null,
    shippingCost: null,
    shippingDays: null,
    inStock: true,
    stockQuantity: null,
    lastSyncedAt: null,
    ...overrides,
  };
}

function fakeHistory(pointCount: number, freshness: 'fresh' | 'stale' | 'unknown' = 'fresh') {
  const now = Date.now();
  const history = Array.from({ length: pointCount }, (_, i) => ({
    id: `ph-${i}`,
    productId: 'prod-1',
    retailerId: 'retailer-amazon',
    price: 999 - i,
    currency: 'USD',
    availability: 'in_stock',
    url: null,
    recordedAt: new Date(now - i * 86_400_000).toISOString(),
  }));
  return {
    history,
    lowestPrice: pointCount > 0 ? 999 - (pointCount - 1) : null,
    highestPrice: pointCount > 0 ? 999 : null,
    currentPrice: pointCount > 0 ? 999 : null,
    previousPrice: null,
    priceChange: null,
    freshness: {
      status: freshness,
      ageDays: freshness === 'fresh' ? 1 : freshness === 'stale' ? 11 : null,
      lastRecordedAt: pointCount > 0 ? history[0].recordedAt : null,
      stale: freshness === 'stale',
    },
    noMovement: false,
  };
}

function fakePrediction(overrides: Partial<BuyWaitPrediction> = {}): BuyWaitPrediction {
  return {
    recommendation: 'buy_now',
    confidence: 45,
    reason: 'Buy Now — at the recorded low.',
    pointCount: 6,
    spanDays: 30,
    seasonalSupported: false,
    currentPrice: 999,
    lowestPrice: 994,
    averagePrice: 996.5,
    slopePct: null,
    dropCount: 1,
    daysSinceLastDrop: 2,
    lowConfidence: false,
    priceStale: false,
    daysSinceLastPrice: 1,
    budgetGapUsd: null,
    ...overrides,
  };
}

const fakeMatrixRow: MatrixRow = {
  key: 'lowest-price',
  label: 'Lowest price',
  cells: [{ kind: 'usd', usd: 999 }],
  highlight: [true],
};

function fakeComparison(bestChoice: string | null): ProductComparison {
  return {
    id: '',
    products: [],
    aiSummary: 'Comparison summary.',
    bestChoice,
    createdAt: new Date().toISOString(),
    suitability: [],
    sourceLabel: 'Based on recorded data.',
  };
}

/** Seed every delegate with the "full data" happy path for one product. */
function seedFullProduct(product: Product, pointCount = 6) {
  mockGetToolProduct.mockResolvedValue(product);
  mockGetToolPriceHistory.mockResolvedValue(fakeHistory(pointCount));
  mockGetToolMerchantProducts.mockResolvedValue([fakeListing({ productId: product.id })]);
  mockGetProductAttributes.mockResolvedValue([
    {
      id: 'attr-1',
      productId: product.id,
      key: 'ram',
      value: '8 GB',
      unit: null,
      group: null,
      sortOrder: 0,
    },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCoupons.mockResolvedValue([]);
  mockGetMerchants.mockResolvedValue([
    {
      id: 'merchant-amazon',
      name: 'Amazon',
      slug: 'amazon',
      logoUrl: null,
      websiteUrl: null,
      countryId: null,
      currencyId: null,
      contactEmail: null,
      phone: null,
      status: 'active',
      commissionRate: 0,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ]);
  mockBuildMatrixRows.mockReturnValue([fakeMatrixRow]);
  mockPredictBuyVsWait.mockReturnValue(fakePrediction());
  mockCompareProducts.mockResolvedValue(fakeComparison('prod-1'));
});

describe('buildShoppingDecision — single product', () => {
  it('composes resolve → matrix → prediction in order and returns the combined result', async () => {
    const product = fakeProduct();
    seedFullProduct(product);

    const decision = await buildShoppingDecision(supabase, { productSlugs: ['macbook-air'] });

    expect(decision.products).toEqual([product]);
    expect(decision.matrix).toEqual([fakeMatrixRow]);
    expect(decision.prediction?.recommendation).toBe('buy_now');
    expect(decision.predictionsBySlug['macbook-air']?.recommendation).toBe('buy_now');
    // Single product: no comparison, verdict withheld (fewer than two).
    expect(decision.comparison).toBeUndefined();
    expect(decision.verdict).toEqual({
      bestChoiceProductId: null,
      withheld: true,
      reason: 'No comparison verdict — fewer than two products were resolved.',
    });
    expect(mockCompareProducts).not.toHaveBeenCalled();

    // Order: resolve first, matrix next, prediction last.
    const order = (fn: { mock: { invocationCallOrder: number[] } }) =>
      fn.mock.invocationCallOrder[0];
    expect(order(mockGetToolProduct)).toBeLessThan(order(mockBuildMatrixRows));
    expect(order(mockBuildMatrixRows)).toBeLessThan(order(mockPredictBuyVsWait));
    // The matrix delegate receives the assembled inputs (no re-fetch by the orchestrator).
    expect(mockBuildMatrixRows).toHaveBeenCalledTimes(1);
    const matrixInput = mockBuildMatrixRows.mock.calls[0][0];
    expect(matrixInput).toHaveLength(1);
    expect(matrixInput[0].slug).toBe('macbook-air');
    expect(matrixInput[0].retailers).toHaveLength(1);
    expect(matrixInput[0].priceHistory).toHaveLength(6);
  });

  it('passes the budget through and no invented alternative price for a single product', async () => {
    seedFullProduct(fakeProduct());

    await buildShoppingDecision(supabase, { productSlugs: ['macbook-air'], budgetUsd: 800 });

    expect(mockPredictBuyVsWait).toHaveBeenCalledWith(expect.any(Array), {
      budgetUsd: 800,
      cheaperAlternativePrice: null,
    });
  });

  it('lists every unavailable input honestly in missing[]', async () => {
    const bare = fakeProduct({
      imageUrl: null,
      gtin: null,
      modelNumber: null,
    });
    mockGetToolProduct.mockResolvedValue(bare);
    mockGetToolPriceHistory.mockResolvedValue(fakeHistory(0, 'unknown'));
    mockGetToolMerchantProducts.mockResolvedValue([]);
    mockGetProductAttributes.mockResolvedValue([]);
    mockPredictBuyVsWait.mockReturnValue(
      fakePrediction({ recommendation: 'not_enough_data', confidence: 0, pointCount: 0 })
    );

    const decision = await buildShoppingDecision(supabase, { productSlugs: ['macbook-air'] });

    expect(decision.dataQuality.missing).toEqual([
      'merchant listings for macbook-air',
      'price history for macbook-air',
      'specs for macbook-air',
      'GTIN for macbook-air',
      'product image for macbook-air',
      'model number for macbook-air',
    ]);
    expect(decision.dataQuality.verified).toBe(false);
    expect(decision.dataQuality.fresh).toBe(false);
    expect(decision.prediction?.recommendation).toBe('not_enough_data');
    // The delegate's own verdict is passed through, not replaced.
    expect(decision.products).toEqual([bare]);
  });

  it('records an unresolved slug in missing[] and still decides on the resolved product', async () => {
    const product = fakeProduct();
    mockGetToolProduct.mockImplementation(async (_sb, slug: string) =>
      slug === 'macbook-air' ? product : null
    );
    mockGetToolPriceHistory.mockResolvedValue(fakeHistory(6));
    mockGetToolMerchantProducts.mockResolvedValue([fakeListing()]);
    mockGetProductAttributes.mockResolvedValue([
      { id: 'a1', productId: 'prod-1', key: 'ram', value: '8 GB', unit: null, group: null, sortOrder: 0 },
    ]);

    const decision = await buildShoppingDecision(supabase, {
      productSlugs: ['macbook-air', 'no-such-product'],
    });

    expect(decision.products).toEqual([product]);
    expect(decision.dataQuality.missing).toContain('product:no-such-product not found');
    expect(decision.prediction).not.toBeNull();
  });

  it('reports verified=true only when the product carries the verified stamp', async () => {
    seedFullProduct(fakeProduct({ priceVerificationStatus: 'verified' }));

    const decision = await buildShoppingDecision(supabase, { productSlugs: ['macbook-air'] });

    expect(decision.dataQuality.verified).toBe(true);
    expect(decision.dataQuality.fresh).toBe(true);
    expect(decision.dataQuality.missing).toEqual([]);
  });

  it('returns an honest empty decision when no slug is given', async () => {
    const decision = await buildShoppingDecision(supabase, { productSlugs: [] });

    expect(decision.products).toEqual([]);
    expect(decision.prediction).toBeNull();
    expect(decision.comparison).toBeUndefined();
    expect(decision.verdict.withheld).toBe(true);
    expect(decision.dataQuality.missing).toEqual(['product: no product slug given']);
    expect(mockCompareProducts).not.toHaveBeenCalled();
  });
});

describe('buildShoppingDecision — two products', () => {
  function seedTwoProducts() {
    const a = fakeProduct();
    const b = fakeProduct({
      id: 'prod-2',
      name: 'Galaxy S24 Ultra',
      slug: 'galaxy-s24-ultra',
      brand: 'Samsung',
      gtin: '0194253000002',
      modelNumber: 'S928',
    });
    mockGetToolProduct.mockImplementation(async (_sb, slug: string) =>
      slug === 'macbook-air' ? a : slug === 'galaxy-s24-ultra' ? b : null
    );
    mockGetToolPriceHistory.mockResolvedValue(fakeHistory(6));
    mockGetToolMerchantProducts.mockImplementation(async (_sb, productId: string) =>
      productId === 'prod-1'
        ? [fakeListing({ productId: 'prod-1', price: 999 })]
        : [fakeListing({ id: 'mp-2', productId: 'prod-2', price: 899 })]
    );
    mockGetProductAttributes.mockImplementation(async (_sb, productId: string) => [
      { id: `a-${productId}`, productId, key: 'ram', value: '8 GB', unit: null, group: null, sortOrder: 0 },
    ]);
    return { a, b };
  }

  it('attaches the comparison, issues the verdict, and passes each product the other as the cheaper alternative', async () => {
    seedTwoProducts();

    const decision = await buildShoppingDecision(supabase, {
      productSlugs: ['macbook-air', 'galaxy-s24-ultra'],
    });

    expect(decision.products).toHaveLength(2);
    expect(mockCompareProducts).toHaveBeenCalledWith(supabase, ['prod-1', 'prod-2']);
    expect(decision.comparison?.bestChoice).toBe('prod-1');
    expect(decision.verdict).toEqual({
      bestChoiceProductId: 'prod-1',
      withheld: false,
      reason: null,
    });
    // Cheaper-alternative wiring: A ($999) is told about B ($899) and vice versa.
    const calls = mockPredictBuyVsWait.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toEqual({ budgetUsd: null, cheaperAlternativePrice: 899 });
    expect(calls[1][1]).toEqual({ budgetUsd: null, cheaperAlternativePrice: 999 });
    // Comparison runs after the predictions.
    const order = (fn: { mock: { invocationCallOrder: number[] } }) =>
      fn.mock.invocationCallOrder[0];
    expect(order(mockPredictBuyVsWait)).toBeLessThan(order(mockCompareProducts));
  });

  it('withholds the verdict when one product has too few price points', async () => {
    seedTwoProducts();
    mockGetToolPriceHistory.mockImplementation(async (_sb, productId: string) =>
      productId === 'prod-1' ? fakeHistory(6) : fakeHistory(3)
    );
    mockPredictBuyVsWait.mockImplementation((_points, _opts) =>
      fakePrediction({ recommendation: 'not_enough_data', confidence: 0, pointCount: 3 })
    );
    // The first product's own prediction must still report its real count.
    mockPredictBuyVsWait.mockImplementationOnce(() => fakePrediction({ pointCount: 6 }));

    const decision = await buildShoppingDecision(supabase, {
      productSlugs: ['macbook-air', 'galaxy-s24-ultra'],
    });

    expect(decision.verdict.withheld).toBe(true);
    expect(decision.verdict.bestChoiceProductId).toBeNull();
    expect(decision.verdict.reason).toContain('galaxy-s24-ultra');
    expect(decision.verdict.reason).toContain('3 recorded price points');
    expect(decision.dataQuality.missing).toContain(
      'sufficient price history for galaxy-s24-ultra (3/5 points)'
    );
    // The comparison result is still attached — only the VERDICT is withheld.
    expect(decision.comparison?.bestChoice).toBe('prod-1');
  });

  it('withholds the verdict when one product price is stale', async () => {
    seedTwoProducts();
    mockGetToolPriceHistory.mockImplementation(async (_sb, productId: string) =>
      productId === 'prod-1' ? fakeHistory(6) : fakeHistory(6, 'stale')
    );

    const decision = await buildShoppingDecision(supabase, {
      productSlugs: ['macbook-air', 'galaxy-s24-ultra'],
    });

    expect(decision.verdict.withheld).toBe(true);
    expect(decision.verdict.bestChoiceProductId).toBeNull();
    expect(decision.verdict.reason).toContain('galaxy-s24-ultra');
    expect(decision.verdict.reason).toContain('stale');
    expect(decision.dataQuality.fresh).toBe(false);
    expect(decision.dataQuality.missing).toContain(
      'fresh price for galaxy-s24-ultra (latest recorded price is stale)'
    );
  });

  it('keeps comparison null and withholds the verdict when the delegate returns no result', async () => {
    seedTwoProducts();
    mockCompareProducts.mockResolvedValue(null);

    const decision = await buildShoppingDecision(supabase, {
      productSlugs: ['macbook-air', 'galaxy-s24-ultra'],
    });

    expect(decision.comparison).toBeNull();
    expect(decision.verdict).toEqual({
      bestChoiceProductId: null,
      withheld: true,
      reason: 'No comparison verdict — the comparison service returned no result.',
    });
  });
});

describe('buildShoppingDecision — sources', () => {
  it('attributes every number to its origin', async () => {
    const { a, b } = (() => {
      const a = fakeProduct();
      const b = fakeProduct({
        id: 'prod-2',
        name: 'Galaxy S24 Ultra',
        slug: 'galaxy-s24-ultra',
        brand: 'Samsung',
        gtin: '0194253000002',
        modelNumber: 'S928',
      });
      return { a, b };
    })();
    mockGetToolProduct.mockImplementation(async (_sb, slug: string) =>
      slug === 'macbook-air' ? a : b
    );
    mockGetToolPriceHistory.mockResolvedValue(fakeHistory(6));
    mockGetToolMerchantProducts.mockResolvedValue([fakeListing()]);
    mockGetProductAttributes.mockResolvedValue([
      { id: 'a1', productId: 'prod-1', key: 'ram', value: '8 GB', unit: null, group: null, sortOrder: 0 },
    ]);

    const decision = await buildShoppingDecision(supabase, {
      productSlugs: ['macbook-air', 'galaxy-s24-ultra'],
    });

    const byField = new Map(decision.sources.map((s) => [s.field, s]));
    expect(byField.get('product:macbook-air')?.origin).toContain('getToolProduct');
    expect(byField.get('lowestPrice:macbook-air')?.value).toBe(999);
    expect(byField.get('lowestPrice:macbook-air')?.origin).toContain('getToolMerchantProducts');
    expect(byField.get('priceHistoryPoints:macbook-air')?.value).toBe(6);
    expect(byField.get('priceHistoryPoints:macbook-air')?.origin).toContain('getToolPriceHistory');
    expect(byField.get('matrix')?.origin).toContain('decision-matrix.ts#buildMatrixRows');
    expect(byField.get('prediction')?.origin).toContain('buy-wait-prediction.ts#predictBuyVsWait');
    expect(byField.get('comparison')?.origin).toContain('ai-comparison.ts#compareProducts');
  });
});
