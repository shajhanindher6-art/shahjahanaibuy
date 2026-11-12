/**
 * Section 16, item 11 — forecast basis-label tests.
 *
 * formatForecastBasis (lib/forecast.ts) labels every forecast range
 * with the history behind it: "Based on N recorded price points ·
 * X% confidence (low/medium/high)". The live catalog's 4-point
 * forecasts land in "low" — the UI must now say so instead of
 * showing a bare percentage.
 *
 * The label is rendered by the product-page forecast card
 * (components/forecast/forecast-card.tsx) and by
 * /tools/forecast-explainer. The card itself is a self-fetching
 * client component, so the render assertion here is a static wiring
 * check (same pattern as tests/a11y-static.test.ts) plus the
 * label built from a REAL computeForecast run — never a fixture
 * confidence number.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeForecast,
  formatForecastBasis,
  forecastConfidenceLabel,
  type ForecastPoint,
} from '@/lib/forecast';

describe('formatForecastBasis — label text', () => {
  it('4 points at 21% confidence reads low (the live-catalog case)', () => {
    expect(formatForecastBasis(4, 21)).toBe(
      'Based on 4 recorded price points · 21% confidence (low)'
    );
  });

  it('more points at higher confidence reads medium, then high', () => {
    expect(formatForecastBasis(12, 55)).toBe(
      'Based on 12 recorded price points · 55% confidence (medium)'
    );
    expect(formatForecastBasis(30, 75)).toBe(
      'Based on 30 recorded price points · 75% confidence (high)'
    );
  });

  it('1 point uses the singular "price point"', () => {
    expect(formatForecastBasis(1, 30)).toBe(
      'Based on 1 recorded price point · 30% confidence (low)'
    );
  });
});

describe('forecastConfidenceLabel — band boundaries', () => {
  it('below 40% is low, 40–69% medium, 70%+ high', () => {
    expect(forecastConfidenceLabel(0)).toBe('low');
    expect(forecastConfidenceLabel(39)).toBe('low');
    expect(forecastConfidenceLabel(40)).toBe('medium');
    expect(forecastConfidenceLabel(69)).toBe('medium');
    expect(forecastConfidenceLabel(70)).toBe('high');
    expect(forecastConfidenceLabel(90)).toBe('high');
  });
});

describe('formatForecastBasis — built from a real computeForecast run', () => {
  /** 4 recorded points, 10 days apart, mildly noisy prices. */
  function fourPointHistory(): ForecastPoint[] {
    const start = new Date('2026-10-01T00:00:00Z').getTime();
    const day = 86_400_000;
    return [1000, 990, 1010, 995].map((price, i) => ({
      price,
      recordedAt: new Date(start + i * 10 * day).toISOString(),
    }));
  }

  it('a 4-point forecast labels itself with 4 points and its real band', () => {
    const forecast = computeForecast(fourPointHistory());
    expect(forecast.status).toBe('ok');
    expect(forecast.pointsUsed).toBe(4);
    for (const horizon of forecast.forecasts) {
      const label = formatForecastBasis(
        horizon.pointsUsed,
        horizon.confidencePct
      );
      expect(label).toContain('Based on 4 recorded price points');
      expect(label).toContain(
        `(${forecastConfidenceLabel(horizon.confidencePct)})`
      );
    }
  });

  it('a 20-point history labels itself with 20 points (more history, same label shape)', () => {
    const start = new Date('2026-08-01T00:00:00Z').getTime();
    const day = 86_400_000;
    const points: ForecastPoint[] = Array.from({ length: 20 }, (_, i) => ({
      price: 1000 + Math.sin(i) * 15 - i * 2,
      recordedAt: new Date(start + i * 5 * day).toISOString(),
    }));
    const forecast = computeForecast(points);
    expect(forecast.status).toBe('ok');
    expect(forecast.pointsUsed).toBe(20);
    const label = formatForecastBasis(
      forecast.forecasts[0].pointsUsed,
      forecast.forecasts[0].confidencePct
    );
    expect(label).toContain('Based on 20 recorded price points');
    expect(label).toMatch(/confidence \((low|medium|high)\)$/);
  });
});

describe('forecast basis label — rendered where forecasts are shown', () => {
  it('the product-page forecast card renders formatForecastBasis per horizon', () => {
    const source = readFileSync(
      join(process.cwd(), 'components/forecast/forecast-card.tsx'),
      'utf8'
    );
    expect(source).toContain(
      '{formatForecastBasis(f.pointsUsed, f.confidencePct)}'
    );
  });

  it('/tools/forecast-explainer renders the same basis label', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/tools/forecast-explainer/page.tsx'),
      'utf8'
    );
    expect(source).toContain(
      'formatForecastBasis(f.pointsUsed, f.confidencePct)'
    );
  });
});
