import { describe, expect, it } from 'vitest';
import {
  backtestForecast,
  computeForecast,
  FORECAST_HORIZONS,
  type ForecastPoint,
} from '@/lib/forecast';
import {
  ACCURACY_MIN_RESOLVED,
  summarizeAccuracy,
  accuracySummaryLine,
} from '@/lib/prediction-accuracy';

// The Forecast Explainer page shows backtest accuracy numbers and
// explains forecast ranges in plain language. These tests pin the
// exact behaviours the page relies on — thin histories stay honest
// (n trials shown, never a promised accuracy) and the recorded-
// outcomes accuracy % stays gated until 20 outcomes resolve.
// Fixed day offsets from 2026-10-01 (UTC), like tests/forecast.test.ts,
// so every point is in the past relative to "now" — computeForecast
// and backtestForecast both drop points dated after now.
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 9, 1);

function day(n: number): string {
  return new Date(BASE + n * DAY_MS).toISOString();
}

function point(price: number, dayOffset: number): ForecastPoint {
  return { price, recordedAt: day(dayOffset) };
}

/** The live shape: 4 recorded points over 30 days, last two identical. */
const LIVE_SHAPE = [
  point(999, 0),
  point(949, 10),
  point(888, 20),
  point(888, 30),
];

/** The same shape extended to the 5-point minimum (Section 20, §12 #46). */
const FIVE_POINT_SHAPE = [...LIVE_SHAPE, point(888, 40)];

/** 7 points over 60 days — the 7-day backtest has 2 real trials on it. */
const SEVEN_POINT_SHAPE = [
  point(999, 0),
  point(949, 10),
  point(888, 20),
  point(888, 30),
  point(888, 40),
  point(888, 50),
  point(888, 60),
];

describe('forecast explainer — thin-history honesty', () => {
  it('4 points → not-enough-history: no forecast from thin history (Section 20, §12 #46)', () => {
    const result = computeForecast(LIVE_SHAPE);
    expect(result.status).toBe('not-enough-history');
    expect(result.pointsUsed).toBe(4);
    expect(result.forecasts).toEqual([]);
    expect(result.note).toMatch(/at least 5 recorded prices/);
  });

  it('5 points produce a forecast, labelled by point count', () => {
    const result = computeForecast(FIVE_POINT_SHAPE);
    expect(result.status).toBe('ok');
    expect(result.pointsUsed).toBe(5);
    expect(result.historyDays).toBe(40);
    expect(result.forecasts).toHaveLength(FORECAST_HORIZONS.length);
    for (const f of result.forecasts) {
      // A range, never a single promised price.
      expect(f.low).toBeLessThan(f.central);
      expect(f.high).toBeGreaterThan(f.central);
      expect(f.confidencePct).toBeLessThanOrEqual(90);
    }
    expect(result.note).toMatch(/not a guarantee/);
  });

  it('30- and 90-day backtests have 0 trials on 4 points over 30 days', () => {
    // A backtest trial needs a recorded price at/after the horizon
    // date; with ~30 days of history no such price exists for the
    // 30- or 90-day horizon. (The 7-day horizon does have trials —
    // the page shows its real n instead of hiding it.)
    for (const horizon of [30, 90] as const) {
      const report = backtestForecast(LIVE_SHAPE, horizon);
      expect(report.trials).toBe(0);
      expect(report.accuracyPct).toBeNull();
      expect(report.status).toBe('not-enough-history');
    }
  });

  it('the 7-day backtest on a 7-point history has 2 real trials', () => {
    // Below 6 points a backtest has no trials at all (it needs a
    // 5-point fit plus a later recorded price), so the 4-point
    // live shape cannot backtest — this 7-point extension of the
    // same shape is the smallest history with 2 real trials.
    // nowMs is pinned past the last point: the default (real now)
    // would drop the synthetic points dated after 2026-11-13.
    const report = backtestForecast(SEVEN_POINT_SHAPE, 7, new Date(day(61)).getTime());
    expect(report.trials).toBe(2);
    expect(report.accuracyPct).not.toBeNull();
    expect(report.entries).toHaveLength(2);
    expect(report.status).toBe('ok');
  });

  it('a longer history does produce trials — the page can show real n', () => {
    // 7 points, 5 days apart, all in October — every horizon-7
    // split has a recorded price at/after its horizon date.
    const longHistory = [
      point(100, 0),
      point(98, 5),
      point(96, 10),
      point(95, 15),
      point(94, 20),
      point(93, 25),
      point(92, 30),
    ];
    const report = backtestForecast(longHistory, 7);
    expect(report.trials).toBeGreaterThan(0);
    expect(report.accuracyPct).not.toBeNull();
    expect(report.entries.length).toBe(report.trials);
    for (const entry of report.entries) {
      expect(entry.withinRange).toBe(
        entry.actualPrice >= entry.low && entry.actualPrice <= entry.high
      );
    }
  });

  it('fewer than 5 points → no forecast and no backtest', () => {
    expect(computeForecast([point(100, 0)]).status).toBe('not-enough-history');
    expect(computeForecast(LIVE_SHAPE).status).toBe('not-enough-history');
    const report = backtestForecast([point(100, 0)], 30);
    expect(report.trials).toBe(0);
    expect(report.accuracyPct).toBeNull();
  });
});

describe('forecast explainer — recorded-outcomes accuracy gate', () => {
  it('no recorded outcomes → accuracy % stays unpublished', () => {
    const summary = summarizeAccuracy([]);
    expect(summary.status).toBe('not-enough-history');
    expect(summary.accuracyPercent).toBeNull();
    expect(summary.hasEnoughHistory).toBe(false);
    expect(accuracySummaryLine(summary)).toMatch(
      `${ACCURACY_MIN_RESOLVED} resolved predictions needed`
    );
  });

  it('19 resolved outcomes still gate the percentage; 20 publish it', () => {
    const nineteen = Array.from({ length: 19 }, (_, i) => ({
      status: i < 15 ? ('correct' as const) : ('incorrect' as const),
      horizonDays: 30,
    }));
    expect(summarizeAccuracy(nineteen).accuracyPercent).toBeNull();

    const twenty = [
      ...nineteen,
      { status: 'correct' as const, horizonDays: 30 },
    ];
    const summary = summarizeAccuracy(twenty);
    expect(summary.hasEnoughHistory).toBe(true);
    expect(summary.accuracyPercent).toBe(80);
    expect(accuracySummaryLine(summary)).toMatch(/80% of 20 resolved/);
  });
});
