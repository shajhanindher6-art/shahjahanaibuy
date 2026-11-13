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

  it('fewer than 5 points → not-enough-history, no forecasts (Section 20, §12 #46: minimum unified at 5)', () => {
    expect(computeForecast([]).status).toBe('not-enough-history');
    expect(computeForecast([]).forecasts).toEqual([]);
    const one = computeForecast([point(100, 0)]);
    expect(one.status).toBe('not-enough-history');
    expect(one.currentPrice).toBe(100);
    expect(one.forecasts).toEqual([]);
    // 4 points is thin history now — no forecast at all.
    const four = computeForecast([
      point(100, 0),
      point(100, 10),
      point(100, 20),
      point(100, 30),
    ]);
    expect(four.status).toBe('not-enough-history');
    expect(four.pointsUsed).toBe(4);
    expect(four.forecasts).toEqual([]);
  });

  it('flat series: centre equals the price, direction flat, range contains it', () => {
    const result = computeForecast([
      point(100, 0),
      point(100, 10),
      point(100, 20),
      point(100, 30),
      point(100, 40),
    ]);
    expect(result.status).toBe('ok');
    expect(result.currentPrice).toBe(100);
    expect(result.pointsUsed).toBe(5);
    expect(result.historyDays).toBe(40);
    for (const f of result.forecasts) {
      expect(f.central).toBe(100);
      expect(f.low).toBeLessThan(100);
      expect(f.high).toBeGreaterThan(100);
      expect(f.direction).toBe('flat');
      expect(f.confidencePct).toBeGreaterThanOrEqual(FORECAST_MIN_CONFIDENCE_PCT);
      expect(f.confidencePct).toBeLessThanOrEqual(FORECAST_MAX_CONFIDENCE_PCT);
    }
    // 7d confidence (Section 19, Phase 3): a flat series carries no
    // directional evidence (R² counted as 0), and at the 5-point
    // minimum there is no point-count bonus — 15 + 0 + 0 − 0 = 15.
    // The old 4-point figures (21 / 16 / 9) no longer occur: below
    // 5 points there is no forecast at all (Section 20, §12 #46).
    expect(result.forecasts[0].confidencePct).toBe(15);
    // 30d: 15 − 5 = 10; 90d: 15 − 12 = 3, clamped to the 5% floor.
    expect(result.forecasts[1].confidencePct).toBe(10);
    expect(result.forecasts[2].confidencePct).toBe(5);
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
      point(80, 40),
    ]);
    expect(result.status).toBe('ok');
    const f30 = result.forecasts.find((f) => f.horizonDays === 30)!;
    // Slope is exactly −0.5/day: centre at day 70 = 100 − 0.5×70 = 65.
    expect(f30.central).toBe(65);
    expect(f30.direction).toBe('down');
    expect(f30.low).toBeGreaterThan(0);
    expect(f30.low).toBeLessThan(f30.central);
    expect(f30.high).toBeGreaterThan(f30.central);
    // Half-width: 1.96 × (2% of 90) × sqrt(1 + 30/90) ≈ 4.07.
    expect(f30.low).toBeCloseTo(60.93, 2);
    expect(f30.high).toBeCloseTo(69.07, 2);
  });

  it('rising series: direction up', () => {
    const result = computeForecast([
      point(80, 0),
      point(90, 10),
      point(100, 20),
      point(110, 30),
      point(120, 40),
    ]);
    expect(result.forecasts.every((f) => f.direction === 'up')).toBe(true);
    expect(result.forecasts[0].central).toBeGreaterThan(120);
  });

  it('2-point series → not-enough-history (Section 20, §12 #46: below 5 points there is no forecast)', () => {
    const result = computeForecast([point(100, 0), point(90, 10)]);
    expect(result.status).toBe('not-enough-history');
    expect(result.pointsUsed).toBe(2);
    expect(result.forecasts).toEqual([]);
    // The 2% sigma floor that kept the old 2-point range
    // non-degenerate is still exercised by the 5-point exact-fit
    // series above (flat / declining) — their ranges are
    // non-degenerate with zero residual spread.
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
      point(85, 30),
      point(80, 40),
    ]);
    expect(result.status).toBe('ok');
    expect(result.pointsUsed).toBe(5);
    expect(result.currentPrice).toBe(80);
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
    // The walk-forward fit needs at least 5 points (Section 20,
    // §12 #46), so splits start at day 20 (5 points) through day
    // 50; the day-55 split has no recorded price at/after +7d.
    // 7 trials, all hits.
    expect(report.status).toBe('ok');
    expect(report.trials).toBe(7);
    expect(report.hits).toBe(7);
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
