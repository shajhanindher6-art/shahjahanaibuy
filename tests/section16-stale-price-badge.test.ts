/**
 * Section 16, item 9 — stale-price badge tests.
 *
 * components/products/stale-price-badge.tsx renders the freshness
 * label next to every listed price: amber "Stale price · N days
 * old" once the recorded check is older than STALE_PRICE_DAYS (7),
 * otherwise the quiet "Price checked … · N days old" line. Unknown
 * freshness renders "Price age unknown" (Section 19, Phase 2 §12
 * #21 — never a guessed age, and never silence: the old "renders
 * nothing" read as fresh).
 *
 * Rendered via react-dom/server (the repo's node vitest env has no
 * DOM; same pattern as tests/section14-chunk5-products.test.ts).
 * Dates are built relative to now so the age assertions cannot rot.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The badge uses JSX without importing React (Next.js SWC handles
// that in the app); the repo's node vitest config compiles JSX to
// classic React.createElement calls, so React must be on the global
// scope BEFORE the component module evaluates — hence the dynamic
// import in beforeAll, not a static import.
(globalThis as { React?: typeof React }).React = React;

let StalePriceBadge: typeof import('@/components/products/stale-price-badge').StalePriceBadge;
beforeAll(async () => {
  ({ StalePriceBadge } = await import(
    '@/components/products/stale-price-badge'
  ));
});

const DAY_MS = 86_400_000;

/** ISO timestamp exactly N whole days before now. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

function renderBadge(dataFreshness: string | null | undefined): string {
  return renderToStaticMarkup(
    createElement(StalePriceBadge, { dataFreshness })
  );
}

describe('StalePriceBadge — stale prices', () => {
  it('10 days old renders "Stale price" + the age in days', () => {
    const html = renderBadge(daysAgo(10));
    expect(html).toContain('Stale price');
    expect(html).toContain('10 days old');
    expect(html).toContain('bg-amber-100');
  });

  it('8 days old is stale (threshold is > 7, not >= 7)', () => {
    const html = renderBadge(daysAgo(8));
    expect(html).toContain('Stale price');
    expect(html).toContain('8 days old');
  });

  it('the stale badge carries the checked date in its title tooltip', () => {
    const html = renderBadge(daysAgo(10));
    expect(html).toContain('Prices last checked');
    expect(html).toContain('10 days old');
  });
});

describe('StalePriceBadge — fresh prices', () => {
  it('3 days old renders the checked label + the age, never "Stale price"', () => {
    const html = renderBadge(daysAgo(3));
    expect(html).toContain('Price checked');
    expect(html).toContain('3 days old');
    expect(html).not.toContain('Stale price');
  });

  it('exactly 7 days old is still fresh (stale only above 7)', () => {
    const html = renderBadge(daysAgo(7));
    expect(html).toContain('Price checked');
    expect(html).toContain('7 days old');
    expect(html).not.toContain('Stale price');
  });

  it('checked today reads "checked today"', () => {
    const html = renderBadge(daysAgo(0));
    expect(html).toContain('Price checked');
    expect(html).toContain('checked today');
    expect(html).not.toContain('Stale price');
  });

  it('1 day old reads "1 day old" (singular)', () => {
    const html = renderBadge(daysAgo(1));
    expect(html).toContain('1 day old');
    expect(html).not.toContain('1 days old');
  });
});

describe('StalePriceBadge — unknown freshness', () => {
  // Section 19, Phase 2 (§12 #21): unknown freshness used to
  // render nothing — a row with no freshness timestamp showed no
  // warning at all and read as fresh. It now renders honest
  // "Price age unknown" text instead — still never a guessed age.
  it('null freshness renders "Price age unknown" (never a guessed age, never silence)', () => {
    const html = renderBadge(null);
    expect(html).toContain('Price age unknown');
    expect(html).not.toContain('Stale price');
    expect(html).not.toContain('days old');
  });

  it('undefined freshness renders "Price age unknown"', () => {
    expect(renderBadge(undefined)).toContain('Price age unknown');
  });
});

describe('StalePriceBadge — wired into the product card with the same props', () => {
  it('product-card passes the product freshness straight through', () => {
    const source = readFileSync(
      join(process.cwd(), 'components/products/product-card.tsx'),
      'utf8'
    );
    expect(source).toContain(
      '<StalePriceBadge dataFreshness={product.dataFreshness} />'
    );
    // The badge renders with exactly the props the card passes:
    // a stale product freshness shows the stale badge on the card.
    expect(renderBadge(daysAgo(10))).toContain('Stale price');
    // …and a fresh one shows the quiet checked line.
    expect(renderBadge(daysAgo(2))).toContain('Price checked');
  });

  it('the other list surfaces mount the same badge on the same prop', () => {
    for (const file of [
      'app/search/page.tsx',
      'app/deals/page.tsx',
      'app/compare/page.tsx',
      'app/page.tsx',
    ]) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      expect(source).toContain('StalePriceBadge');
      expect(source).toContain('dataFreshness=');
    }
  });
});
