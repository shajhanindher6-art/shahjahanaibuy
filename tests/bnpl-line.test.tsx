/**
 * BNPL line component tests (Section 6, item 9).
 * Rendered via react-dom/server (vitest environment is node — no DOM).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BnplLine } from '@/components/products/bnpl-line';
import type { LocalStore } from '@/lib/stores';

function storeWithBnpl(verified: boolean): LocalStore {
  return {
    name: 'Test Store',
    slug: 'test',
    countryCode: 'US',
    websiteUrl: 'https://example.com',
    searchUrlTemplate: 'https://example.com/search?q={q}',
    paymentMethods: [
      { id: 'bnpl', label: 'Pay in instalments', verified },
      { id: 'cod', label: 'Cash on Delivery', verified: true },
    ],
  };
}

function storeWithoutBnpl(): LocalStore {
  return {
    name: 'Test Store',
    slug: 'test',
    countryCode: 'US',
    websiteUrl: 'https://example.com',
    searchUrlTemplate: 'https://example.com/search?q={q}',
    paymentMethods: [{ id: 'cod', label: 'Cash on Delivery', verified: true }],
  };
}

describe('BnplLine', () => {
  it('says BNPL is not verified when the store has no verified bnpl method', () => {
    const html = renderToStaticMarkup(
      <BnplLine store={storeWithoutBnpl()} totalUsd={999} months={12} aprPct={null} />
    );
    expect(html).toContain('not verified for this store');
    expect(html).not.toContain('/month');
  });

  it('says BNPL is not verified when there is no store', () => {
    const html = renderToStaticMarkup(
      <BnplLine store={null} totalUsd={999} months={12} aprPct={null} />
    );
    expect(html).toContain('not verified for this store');
  });

  it('ignores an unverified bnpl entry', () => {
    const html = renderToStaticMarkup(
      <BnplLine store={storeWithBnpl(false)} totalUsd={999} months={12} aprPct={null} />
    );
    expect(html).toContain('not verified for this store');
  });

  it('shows the pre-interest split when APR is unknown', () => {
    const html = renderToStaticMarkup(
      <BnplLine store={storeWithBnpl(true)} totalUsd={999} months={12} aprPct={null} />
    );
    expect(html).toContain('$83.25/month');
    expect(html).toContain('12 months');
    expect(html).toContain('before interest/fees');
  });

  it('shows the 0% APR split when APR is recorded as 0', () => {
    const html = renderToStaticMarkup(
      <BnplLine store={storeWithBnpl(true)} totalUsd={600} months={6} aprPct={0} />
    );
    expect(html).toContain('$100.00/month');
    expect(html).toContain('0% APR');
  });

  it('shows terms-not-recorded when no term is given', () => {
    const html = renderToStaticMarkup(
      <BnplLine store={storeWithBnpl(true)} totalUsd={999} months={null} aprPct={null} />
    );
    expect(html).toContain('Pay in instalments');
    expect(html).toContain('terms not recorded');
    expect(html).not.toContain('/month');
  });
});
