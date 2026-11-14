/**
 * FIX 3 — ProductTools links (components/tools/product-tools.tsx).
 *
 * The product page's "Tools for this product" block must carry the
 * product into every tool that accepts it — including price-match
 * and persona-fit, which both read ?product= and pass it onward.
 * (Both were called with no argument, so the product was lost on
 * entry to those two tools.)
 *
 * Renders the real component through renderToStaticMarkup with
 * next/link mocked to a plain <a> (the tool-pages.test.ts pattern).
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductTools } from '@/components/tools/product-tools';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) =>
    React.createElement('a', { href, ...props }, children),
}));

const PRODUCT = {
  id: 'prod-1',
  name: 'Test Laptop',
  slug: 'test-laptop',
};

describe('ProductTools links carry the product', () => {
  it('price-match and persona-fit links carry ?product=<slug>', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductTools, { products: [PRODUCT] })
    );
    expect(html).toContain('/tools/price-match?product=test-laptop');
    expect(html).toContain('/tools/persona-fit?product=test-laptop');
  });

  it('all 11 tool links are present and carry the product', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductTools, { products: [PRODUCT] })
    );
    expect(html).toContain('Tools for this product');
    expect(html).toContain('/tools/upgrade-advisor?current=test-laptop');
    expect(html).toContain('/tools/compatibility-checker?device=test-laptop');
    expect(html).toContain('/tools/energy-cost?product=test-laptop');
    expect(html).toContain('/tools/deal-stacker?product=test-laptop');
    expect(html).toContain('/tools/negotiation-coach?product=test-laptop');
    expect(html).toContain('/tools/repairability?product=test-laptop');
    expect(html).toContain('/tools/refurbished-checklist?product=test-laptop');
    expect(html).toContain('/tools/own-it-check?product=test-laptop');
    expect(html).toContain('/compare?products=prod-1');
  });

  it('the /compare link is bare when the product id is unknown', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductTools, {
        products: [{ slug: 'test-laptop', name: 'Test Laptop', id: null }],
      })
    );
    expect(html).toContain('href="/compare"');
    expect(html).not.toContain('/compare?products=');
  });

  it('renders nothing when there is no product', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductTools, { products: [] })
    );
    expect(html).toBe('');
  });
});
