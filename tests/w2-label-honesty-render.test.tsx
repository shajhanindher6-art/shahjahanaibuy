// @vitest-environment jsdom
/**
 * Worker W2-RESUME #2 — LABEL HONESTY + PRICE SURFACES (Final 100%
 * Product & Real Data Completion). Render pin for F-P1-04:
 * ProductCard renders the brief's 5-state label + reason when the
 * caller supplies priceState, and renders no state claim when it
 * does not. (Main suite is node-env; the render pin lives here so
 * the jsdom pragma does not touch the other W2 tests.)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { ProductCard } from '@/components/products/product-card';
import { RegionProvider } from '@/components/region/region-provider';
import { derivePriceState } from '@/lib/verification/price-state';

afterEach(cleanup);

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) =>
    React.createElement('a', { href, ...props }, children),
}));

// jsdom has no window.matchMedia; stub it before any render.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList) as typeof window.matchMedia;
}

const NOW = new Date('2026-11-13T08:00:00.000Z');

function withRegion(children: React.ReactElement) {
  return (
    <RegionProvider initialCountryCode="US" initialLanguage="en">
      {children}
    </RegionProvider>
  );
}

describe('F-P1-04 — ProductCard renders the 5-state label', () => {
  it('renders "Price state: Stale" + reason for an 11-day-old unverified price', () => {
    const priceState = derivePriceState({
      priceVerificationStatus: 'unverified',
      priceVerifiedAt: null,
      lastCheckedAt: '2026-11-02T07:13:52.000Z',
      hasRecordedPrice: true,
      now: NOW,
    });
    expect(priceState.state).toBe('STALE');
    const { container } = render(
      withRegion(
        <ProductCard
          product={{
            id: 'p1',
            name: 'MacBook Air 13',
            slug: 'macbook-air-13',
            brand: 'Apple',
            category: 'Laptops',
            imageUrl: null,
            price: 999,
            dataFreshness: '2026-11-02T07:13:52.000Z',
            priceVerificationStatus: 'unverified',
            priceState,
          }}
        />
      )
    );
    expect(container.textContent).toContain('Price state:');
    expect(container.textContent).toContain('Stale');
    expect(container.textContent).toContain('never verified by a real fetch');
    // The freshness badge rides alongside the state label.
    expect(container.textContent).toContain('Stale price');
  });

  it('renders no state claim when no priceState is supplied', () => {
    const { container } = render(
      withRegion(
        <ProductCard
          product={{
            id: 'p1',
            name: 'MacBook Air 13',
            slug: 'macbook-air-13',
            brand: 'Apple',
            category: 'Laptops',
            imageUrl: null,
            price: 999,
            dataFreshness: '2026-11-02T07:13:52.000Z',
            priceVerificationStatus: 'unverified',
          }}
        />
      )
    );
    expect(container.textContent).not.toContain('Price state:');
  });
});
