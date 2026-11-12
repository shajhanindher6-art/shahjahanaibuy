/**
 * BNPL line component tests (Section 6, item 9).
 * Rendered via react-dom/server (vitest environment is node — no DOM).
 *
 * Section 18, item 68: this file used to be `bnpl-line.test.tsx`
 * and ran NOWHERE — the main vitest config includes only
 * `tests/**\/*.test.ts`, the a11y config only `a11y-runtime.test.tsx`,
 * and no script or workflow referenced it, so its 6 tests never
 * executed. Renamed to `.test.ts` to join the main suite. A `.ts`
 * file cannot contain JSX (esbuild parses it without JSX support),
 * so the component is rendered with `createElement` instead of JSX
 * syntax — same assertions, no behaviour change.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
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

function renderBnpl(
  store: LocalStore | null,
  totalUsd: number,
  months: number | null,
  aprPct: number | null
): string {
  return renderToStaticMarkup(
    createElement(BnplLine, { store, totalUsd, months, aprPct })
  );
}

describe('BnplLine', () => {
  it('says BNPL is not verified when the store has no verified bnpl method', () => {
    const html = renderBnpl(storeWithoutBnpl(), 999, 12, null);
    expect(html).toContain('not verified for this store');
    expect(html).not.toContain('/month');
  });

  it('says BNPL is not verified when there is no store', () => {
    const html = renderBnpl(null, 999, 12, null);
    expect(html).toContain('not verified for this store');
  });

  it('ignores an unverified bnpl entry', () => {
    const html = renderBnpl(storeWithBnpl(false), 999, 12, null);
    expect(html).toContain('not verified for this store');
  });

  it('shows the pre-interest split when APR is unknown', () => {
    const html = renderBnpl(storeWithBnpl(true), 999, 12, null);
    expect(html).toContain('$83.25/month');
    expect(html).toContain('12 months');
    expect(html).toContain('before interest/fees');
  });

  it('shows the 0% APR split when APR is recorded as 0', () => {
    const html = renderBnpl(storeWithBnpl(true), 600, 6, 0);
    expect(html).toContain('$100.00/month');
    expect(html).toContain('0% APR');
  });

  it('shows terms-not-recorded when no term is given', () => {
    const html = renderBnpl(storeWithBnpl(true), 999, null, null);
    expect(html).toContain('Pay in instalments');
    expect(html).toContain('terms not recorded');
    expect(html).not.toContain('/month');
  });
});
