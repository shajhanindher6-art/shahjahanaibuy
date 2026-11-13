/**
 * Section 19, Phase 3 — best-time-to-buy component (§12 #31/#32).
 *
 * #31: no exact date is ever rendered, even when a date is passed.
 * #32: TRACK PRICE and COMPARE ALTERNATIVES are rendered as
 * recommendations (near-low → Track Price; cheaper alternative
 * supplied → Compare Alternatives).
 *
 * Runs under the jsdom a11y config (vitest.a11y.config.ts) — the
 * main vitest config is node-only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { BestTimeToBuyIndicator } from '@/components/products/best-time-to-buy';

afterEach(cleanup);

function renderIndicator(overrides: Partial<Parameters<typeof BestTimeToBuyIndicator>[0]> = {}) {
  return render(
    <BestTimeToBuyIndicator
      discountProbability={20}
      currentPrice={999}
      averagePrice={1000}
      lowestPrice={950}
      expectedSaleDate={null}
      {...overrides}
    />
  );
}

describe('#31 — no exact date is ever rendered', () => {
  it('renders no date even when an exact date value is passed', () => {
    renderIndicator({ expectedSaleDate: '2026-12-25' });
    expect(screen.queryByText(/next predicted sale/i)).toBeNull();
    expect(screen.queryByText(/December 25/i)).toBeNull();
    expect(screen.queryByText(/2026-12-25/)).toBeNull();
    expect(screen.queryByText(/Dec 25/i)).toBeNull();
  });

  it('renders no date for a past date either', () => {
    renderIndicator({ expectedSaleDate: '2026-11-02' });
    expect(document.body.textContent).not.toMatch(/November 2|2026-11-02/);
  });
});

describe('#32 — TRACK PRICE + COMPARE ALTERNATIVES surface in the component', () => {
  it('near the recorded low with no strong signal → Track Price', () => {
    // Current 990 is within 5% above the 950 low, above the
    // 0.95×average buy-now line (950), and the discount
    // probability (20) is below the wait threshold (60).
    renderIndicator({ currentPrice: 990 });
    expect(screen.getByText('Track Price')).toBeDefined();
    expect(screen.queryByText('Monitor Price')).toBeNull();
  });

  it('cheaper alternative supplied → Compare Alternatives', () => {
    renderIndicator({ cheaperAlternativePrice: 850 });
    expect(screen.getByText('Compare Alternatives')).toBeDefined();
    expect(screen.queryByText('Monitor Price')).toBeNull();
  });

  it('a small alternative gap does not trigger compare', () => {
    renderIndicator({ cheaperAlternativePrice: 980 });
    expect(screen.queryByText('Compare Alternatives')).toBeNull();
  });

  it('BUY NOW / WAIT / MONITOR still work as before', () => {
    const { unmount } = renderIndicator({ currentPrice: 900, averagePrice: 1000 });
    expect(screen.getByText('Buy Now')).toBeDefined();
    unmount();
    renderIndicator({ discountProbability: 75 });
    expect(screen.getByText('Wait for Sale')).toBeDefined();
    cleanup();
    renderIndicator({});
    expect(screen.getByText('Monitor Price')).toBeDefined();
  });
});
