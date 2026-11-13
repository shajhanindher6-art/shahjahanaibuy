import { describe, expect, it, afterEach } from 'vitest';
import { describePlatformStatus } from '@/services/platform-status';
import { alertPriceFreshness } from '@/services/alert-checker';
import { discountPercent, discountPercentLabel, DISCOUNT_BASIS_LABEL } from '@/lib/deal-math';
import { computeDealScore, dealScoreForDisplay } from '@/lib/deal-score';
import {
  FORECAST_MIN_POINTS,
  computeForecast,
  type ForecastPoint,
} from '@/lib/forecast';
import {
  BUY_WAIT_MIN_POINTS,
  predictBuyVsWait,
  type BuyWaitPoint,
} from '@/services/buy-wait-prediction';
import { normalizePriceVerificationStatus } from '@/services/price-verification';
import { recordedDataLabel, verifiedDataLabel } from '@/lib/ai-source-label';
import { validateRawProduct } from '@/services/pipeline/validation';
import { normalizeProduct } from '@/services/pipeline/normalization';

// Section 20, Stage B resume — P0 honesty regressions (audit §12
// #40, #45, #46, #51, #67, #81, #82, #84). Every item below was a
// user-visible wrong claim; each test pins the honest behaviour so
// a future change cannot silently re-introduce it. #83 (AI copy
// residuals) and the "Data completeness" relabel live in
// unexported template functions / TSX, so they are verified by
// reading (see the report) rather than by a unit test here.

const DAY_MS = 86_400_000;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

function historyPoints(count: number, lastAgeDays: number, price = 999): BuyWaitPoint[] {
  const points: BuyWaitPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    points.push({
      price,
      recordedAt: new Date(Date.now() - (lastAgeDays + i) * DAY_MS).toISOString(),
    });
  }
  return points;
}

function forecastPoints(count: number): ForecastPoint[] {
  return historyPoints(count, 0).map((p) => ({
    price: p.price,
    recordedAt: p.recordedAt,
  }));
}

describe('§12 #51 — platform status never overstates an integration', () => {
  const saved: Record<string, string | undefined> = {
    AMAZON_ASSOC_TAG: process.env.AMAZON_ASSOC_TAG,
    EBAY_CLIENT_ID: process.env.EBAY_CLIENT_ID,
    EBAY_CLIENT_SECRET: process.env.EBAY_CLIENT_SECRET,
    SKIMLINKS_PUBLISHER_ID: process.env.SKIMLINKS_PUBLISHER_ID,
  };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function byId(id: string) {
    const entry = describePlatformStatus().find((p) => p.id === id);
    if (!entry) throw new Error(`missing platform ${id}`);
    return entry;
  }

  it('Best Buy is recorded-prices-only, never live, with no config at all', () => {
    delete process.env.AMAZON_ASSOC_TAG;
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_CLIENT_SECRET;
    delete process.env.SKIMLINKS_PUBLISHER_ID;
    expect(byId('best-buy').status).toBe('recorded-prices-only');
  });

  it('Amazon with only a tag is tag-only, never configured, and never leaks the tag', () => {
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_CLIENT_SECRET;
    delete process.env.SKIMLINKS_PUBLISHER_ID;
    process.env.AMAZON_ASSOC_TAG = 'smartbuy-20';
    expect(byId('amazon').status).toBe('tag-only');
    expect(JSON.stringify(describePlatformStatus())).not.toContain('smartbuy-20');
  });
});

describe('§12 #81 — stale prices never fire an "is now $Y!" alert', () => {
  it('an 11-day-old record (the live seed age) is stale', () => {
    expect(alertPriceFreshness(daysAgo(11))).toBe('stale');
  });

  it('a 2-day-old record is fresh', () => {
    expect(alertPriceFreshness(daysAgo(2))).toBe('fresh');
  });

  it('7 days is not stale (threshold is > 7), 8 days is', () => {
    expect(alertPriceFreshness(daysAgo(7))).toBe('fresh');
    expect(alertPriceFreshness(daysAgo(8))).toBe('stale');
  });

  it('a missing check date is unknown, never read as fresh', () => {
    expect(alertPriceFreshness(null)).toBe('unknown');
    expect(alertPriceFreshness(undefined)).toBe('unknown');
  });
});

describe('§12 #40 — discounts are labelled "vs list price"', () => {
  it('the basis label is the literal "vs list price"', () => {
    expect(DISCOUNT_BASIS_LABEL).toBe('vs list price');
  });

  it('discountPercentLabel carries the basis with the number', () => {
    expect(discountPercentLabel(80, 100)).toBe('20% off vs list price');
    expect(discountPercentLabel(999, 1199)).toContain('vs list price');
  });

  it('no discount without a real compare-at saving — never a guessed %', () => {
    expect(discountPercent(100, 100)).toBeNull();
    expect(discountPercent(100, null)).toBeNull();
    expect(discountPercentLabel(100, 100)).toBeNull();
  });
});

describe('§12 #67 — confidence_score is completeness, not quality', () => {
  it('the 50-floor is gone: a name-only product scores 15, not 50', () => {
    const result = validateRawProduct({
      externalId: 'x1',
      retailerSlug: 'amazon',
      name: 'Widget',
      price: 0,
      currency: 'USD',
      availability: 'unknown',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(normalizeProduct(result.data).confidenceScore).toBe(15);
    }
  });

  it('a fully-specified product still scores on presence alone (100 max)', () => {
    const result = validateRawProduct({
      externalId: 'x2',
      retailerSlug: 'amazon',
      name: 'Widget',
      description: 'A widget.',
      brand: 'Acme',
      category: 'Gadgets',
      gtin: '4006381333931',
      images: ['https://example.com/w.jpg'],
      price: 10,
      currency: 'USD',
      availability: 'in_stock',
      url: 'https://example.com/w',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(normalizeProduct(result.data).confidenceScore).toBe(100);
    }
  });
});

describe('§12 #45 — Deal Score formula is NOT rebased (deferred, pinned)', () => {
  it('the formula is unchanged: 100 − 0 + 30 + 20×0.3 = 136, clamped to 100', () => {
    expect(
      computeDealScore({
        discountProbability: 0,
        currentPrice: 100,
        lowestPrice: 100,
        confidenceScore: 20,
      })
    ).toBe(100);
  });

  it('the 4-point live series stays WITHHELD, never shown as 100/100', () => {
    expect(
      dealScoreForDisplay({
        discountProbability: 0,
        currentPrice: 999,
        lowestPrice: 999,
        confidenceScore: 20,
        dataPoints: 4,
      })
    ).toBeNull();
  });

  it('with 5 points the same formula is shown (threshold, not rebase)', () => {
    expect(
      dealScoreForDisplay({
        discountProbability: 0,
        currentPrice: 999,
        lowestPrice: 999,
        confidenceScore: 20,
        dataPoints: 5,
      })
    ).toBe(100);
  });
});

describe('§12 #46 — forecast / buy-wait minimum unified at 5 points', () => {
  it('both minimums are 5', () => {
    expect(FORECAST_MIN_POINTS).toBe(5);
    expect(BUY_WAIT_MIN_POINTS).toBe(5);
  });

  it('forecast refuses 4 points and issues a forecast at 5', () => {
    expect(computeForecast(forecastPoints(4)).status).toBe('not-enough-history');
    expect(computeForecast(forecastPoints(4)).forecasts).toEqual([]);
    expect(computeForecast(forecastPoints(5)).status).toBe('ok');
    expect(computeForecast(forecastPoints(5)).forecasts.length).toBeGreaterThan(0);
  });

  it('buy-wait refuses 4 points and issues a verdict at 5', () => {
    expect(predictBuyVsWait(historyPoints(4, 0)).recommendation).toBe('not_enough_data');
    expect(predictBuyVsWait(historyPoints(5, 0)).recommendation).not.toBe('not_enough_data');
  });
});

describe('§12 #82 — AI inputs carry verification status; "verified" is earned, never assumed', () => {
  it('an absent verification stamp normalizes to unverified', () => {
    expect(normalizePriceVerificationStatus(undefined)).toBe('unverified');
    expect(normalizePriceVerificationStatus(null)).toBe('unverified');
    expect(normalizePriceVerificationStatus('verified')).toBe('verified');
  });

  it('the default chat label says recorded, not verified, with the real check date', () => {
    const label = recordedDataLabel('2026-11-02T07:13:52Z');
    expect(label).toContain('recorded prices, not checked live');
    expect(label).toContain('Nov 2, 2026');
    expect(label).not.toContain('verified recorded data');
  });

  it('the verified label says what was verified, by whom, and when — and renders nothing when the date is unknown', () => {
    // Final 100% — F-P2-18: the old "based on verified recorded
    // data" wording never said what/by whom/when. The label now
    // names all three, and returns null (render nothing) when no
    // check date is known.
    const label = verifiedDataLabel('2026-11-02T07:13:52Z');
    expect(label).toContain('prices verified');
    expect(label).toContain("SmartBuy's live price check");
    expect(label).toContain('Nov 2, 2026');
    expect(label).toContain('real fetch');
    expect(verifiedDataLabel(null)).toBeNull();
  });
});

describe('§12 #84 — forecast / buy-wait "Current" is never stale-presented', () => {
  it('buy-wait on an 11-day-old last price is stale-flagged and says so in the reason', () => {
    const prediction = predictBuyVsWait(historyPoints(5, 11));
    expect(prediction.priceStale).toBe(true);
    expect(prediction.daysSinceLastPrice).toBe(11);
    expect(prediction.reason).toContain('stale');
  });

  it('buy-wait on a fresh last price is not stale-flagged', () => {
    const prediction = predictBuyVsWait(historyPoints(5, 0));
    expect(prediction.priceStale).toBe(false);
    expect(prediction.reason).not.toContain('stale');
  });

  it('a budget above the current price is honoured as a gap, never a buy above budget', () => {
    const prediction = predictBuyVsWait(historyPoints(5, 0), { budgetUsd: 500 });
    expect(prediction.recommendation).toBe('wait');
    expect(prediction.budgetGapUsd).toBe(499);
    expect(prediction.reason).toContain('above your budget by $499.00');
  });

  it('a cheaper alternative (≥5% cheaper) routes to compare_alternatives', () => {
    const prediction = predictBuyVsWait(historyPoints(5, 0), {
      cheaperAlternativePrice: 800,
    });
    expect(prediction.recommendation).toBe('compare_alternatives');
  });

  it('the forecast note never promises a future price', () => {
    expect(computeForecast(forecastPoints(5)).note).toContain('not a guarantee');
  });
});
