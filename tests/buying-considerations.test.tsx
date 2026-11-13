/**
 * Section 19, §12 #18 — BuyingConsiderations component.
 *
 * Real signals in → the "Before you buy" list renders; no signals
 * → the honest "not enough data" line renders instead of an
 * invented checklist.
 *
 * Runs under the jsdom a11y config (vitest.a11y.config.ts) — the
 * main vitest config is node-only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { BuyingConsiderations } from '@/components/products/buying-considerations';

afterEach(cleanup);

describe('BuyingConsiderations', () => {
  it('renders real considerations from real signals', () => {
    render(
      <BuyingConsiderations
        lastCheckedAt="2026-11-12T12:00:00.000Z"
        merchants={[{ merchantName: 'Amazon', price: 999, compareAtPrice: 1299 }]}
        totalReviews={12}
        averageRating={4.5}
        verifiedReviews={3}
      />
    );
    expect(screen.getByText('Before you buy')).toBeTruthy();
    expect(screen.getByText(/last checked on/)).toBeTruthy();
    expect(screen.getByText(/below its recorded compare-at/)).toBeTruthy();
    expect(screen.getByText(/Rated 4\.5 out of 5 from 12 reviews/)).toBeTruthy();
    expect(screen.queryByText(/Not enough recorded data/)).toBeNull();
  });

  it('renders the honest empty state when no signal exists', () => {
    render(
      <BuyingConsiderations
        lastCheckedAt={null}
        merchants={[]}
        totalReviews={0}
        averageRating={null}
        verifiedReviews={0}
      />
    );
    expect(screen.getByText('Before you buy')).toBeTruthy();
    expect(
      screen.getByText(/Not enough recorded data to list buying considerations/)
    ).toBeTruthy();
  });
});
