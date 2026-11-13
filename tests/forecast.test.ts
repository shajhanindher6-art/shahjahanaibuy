import { describe, expect, it } from 'vitest';
import {
  backtestForecast,
  computeForecast,
  FORECAST_HORIZONS,
  FORECAST_MAX_CONFIDENCE_PCT,
  FORECAST_MIN_CONFIDENCE_PCT,
  type ForecastPoint,
} from '@/lib/forecast';

// Fixed day offsets from 2026-10-01 (UTC), so every expected value
// below is hand-computable and the tests are fully deterministic.
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 9, 1);

function day(n: number): string {
  return new Date(BASE + n * DAY_MS).toISOString();
}

function point(price: number, dayOffset: number): ForecastPoint {
  return { price, recordedAt: day(dayOffset) };
}

describe('computeForecast', () => {
  it('offers 7 / 30 / 90 day horizons', () => {
    expect(FORECAST_HORIZONS).toEqual([7, 30, 90]);
  });

  it('fewer than 2 points → not-enough-history, no forecasts', () => {
    expect(computeForecast([]).status).toBe('not-enough-history');
    expect(computeForecast([]).forecasts).toEqual([]);
    const one = computeForecast([point(100, 0)]);
    expect(one.status).toBe('not-enough-history');
    expect(one.currentPrice).toBe(100);
    expect(one.forecasts).toEqual([]);
  });

  it('flat series: centre equals the price, direction flat, range contains it', () => {
    const result = computeForecast([
      point(100, 0),
      point(100, 10),
      point(100, 20),
      point(100, 30),
    ]);
    expect(result.status).toBe('ok');
    expect(result.currentPrice).toBe(100);
    expect(result.pointsUsed).toBe(4);
    expect(result.historyDays).toBe(30);
    for (const f of result.forecasts) {
      expect(f.central).toBe(100);
      expect(f.low).toBeLessThan(100);
      expect(f.high).toBeGreaterThan(100);
      expect(f.direction).toBe('flat');
      expect(f.confidencePct).toBeGreaterThanOrEqual(FORECAST_MIN_CONFIDENCE_PCT);
      expect(f.confidencePct).toBeLessThanOrEqual(FORECAST_MAX_CONFIDENCE_PCT);
    }
    // 7d confidence (Section 19, Phase 3): a flat series carries no
    // directional evidence (R² counted as 0) and thin history caps
    // confidence at 25% — 15 + 0 + 6 (4 points) − 0 = 21. The old
    // formula rewarded perfect flatness (R² = 1) and scored 76.
    expect(result.forecasts[0].confidencePct).toBe(21);
    // 30d: 21 − 5 = 16; 90d: 21 − 12 = 9 — all low band.
    expect(result.forecasts[1].confidencePct).toBe(16);
    expect(result.forecasts[2].confidencePct).toBe(9);
    // 7d half-width: 1.96 × (2% of 100) × sqrt(1 + 7/90) ≈ 4.07.
    expect(result.forecasts[0].low).toBeCloseTo(95.93, 2);
    expect(result.forecasts[0].high).toBeCloseTo(104.07, 2);
  });

  it('declining series: direction down, centre below current, low stays positive', () => {
    const result = computeForecast([
      point(100, 0),
      point(95, 10),
      point(90, 20),
      point(85, 30),
    ]);
    expect(result.status).toBe('ok');
    const f30 = result.forecasts.find((f) => f.horizonDays === 30)!;
    // Slope is exactly −0.5/day: centre at day 60 = 100 − 0.5×60 = 70.
    expect(f30.central).toBe(70);
    expect(f30.direction).toBe('down');
    expect(f30.low).toBeGreaterThan(0);
    expect(f30.low).toBeLessThan(f30.central);
    expect(f30.high).toBeGreaterThan(f30.central);
    // Half-width: 1.96 × (2% of 92.5) × sqrt(1 + 30/90) ≈ 4.19.
    expect(f30.low).toBeCloseTo(65.81, 2);
    expect(f30.high).toBeCloseTo(74.19, 2);
  });

  it('rising series: direction up', () => {
    const result = computeForecast([
      point(80, 0),
      point(90, 10),
      point(100, 20),
      point(110, 30),
    ]);
    expect(result.forecasts.every((f) => f.direction === 'up')).toBe(true);
    expect(result.forecasts[0].central).toBeGreaterThan(110);
  });

  it('2-point series: range is non-degenerate and confidence is capped', () => {
    const result = computeForecast([point(100, 0), point(90, 10)]);
    expect(result.status).toBe('ok');
    const f7 = result.forecasts[0];
    // Slope −1/day: centre at day 17 = 100 − 17 = 83.
    expect(f7.central).toBe(83);
    // The 2% floor stops the exact 2-point fit producing a zero-width range.
    expect(f7.low).toBeLessThan(f7.central);
    expect(f7.high).toBeGreaterThan(f7.central);
    expect(f7.confidencePct).toBeLessThanOrEqual(FORECAST_MAX_CONFIDENCE_PCT);
    // Longer horizons are less confident than shorter ones.
    expect(result.forecasts[2].confidencePct).toBeLessThan(f7.confidencePct);
  });

  it('drops invalid rows and sorts unsorted input', () => {
    const result = computeForecast([
      point(90, 20),
      { price: Number.NaN, recordedAt: day(5) },
      { price: 0, recordedAt: day(6) },
      { price: -10, recordedAt: day(7) },
      { price: 100, recordedAt: 'not-a-date' },
      point(100, 0),
      point(95, 10),
    ]);
    expect(result.status).toBe('ok');
    expect(result.pointsUsed).toBe(3);
    expect(result.currentPrice).toBe(90);
  });

  it('confidence never exceeds 90, even for a perfect long fit', () => {
    const points = Array.from({ length: 20 }, (_, i) => point(100, i * 2));
    const result = computeForecast(points);
    for (const f of result.forecasts) {
      expect(f.confidencePct).toBeLessThanOrEqual(90);
      expect(f.confidencePct).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('backtestForecast', () => {
  it('exact linear decline: every trial lands inside its range', () => {
    // Price = 120 − day, a point every 5 days from day 0 to day 60.
    // nowMs is pinned past the last point: the default (real now)
    // would drop the synthetic points after 2026-11-10.
    const points = Array.from({ length: 13 }, (_, i) => point(120 - i * 5, i * 5));
    const report = backtestForecast(points, 7, new Date(day(61)).getTime());
    // Splits at days 5..50 have a recorded price at/after +7d; the
    // day-55 split does not (no point ≥ day 62). 10 trials, all hits.
    expect(report.status).toBe('ok');
    expect(report.trials).toBe(10);
    expect(report.hits).toBe(10);
    expect(report.accuracyPct).toBe(100);
    for (const e of report.entries) {
      expect(e.actualPrice).toBeGreaterThanOrEqual(e.low);
      expect(e.actualPrice).toBeLessThanOrEqual(e.high);
      expect(e.withinRange).toBe(true);
    }
  });

  it('short history with a 30-day horizon: zero trials, accuracy null', () => {
    const points = [point(100, 0), point(95, 10), point(90, 20), point(85, 30)];
    const report = backtestForecast(points, 30);
    expect(report.trials).toBe(0);
    expect(report.accuracyPct).toBeNull();
    expect(report.status).toBe('not-enough-history');
    expect(report.entries).toEqual([]);
  });

  it('a jump outside the range counts as a miss, not a hit', () => {
    // Flat at 100 for 40 days, then a jump to 150 — the flat-fit
    // range (σ floor 2%) cannot contain 150.
    const points = [
      point(100, 0),
      point(100, 10),
      point(100, 20),
      point(100, 30),
      point(100, 40),
      point(150, 50),
    ];
    const report = backtestForecast(points, 7, new Date(day(51)).getTime());
    expect(report.trials).toBeGreaterThan(0);
    expect(report.hits).toBeLessThan(report.trials);
    expect(report.accuracyPct).not.toBeNull();
    expect(report.accuracyPct!).toBeGreaterThanOrEqual(0);
    expect(report.accuracyPct!).toBeLessThanOrEqual(100);
    const miss = report.entries.find((e) => !e.withinRange);
    expect(miss).toBeDefined();
    expect(miss!.actualPrice).toBe(150);
  });

  it('rejects an unknown horizon value at the type level (7/30/90 only)', () => {
    expect(FORECAST_HORIZONS).toContain(7);
    expect(FORECAST_HORIZONS).toContain(30);
    expect(FORECAST_HORIZONS).toContain(90);
  });
});
