/**
 * Section 16, item 10 — Deal Score withheld-state tests.
 *
 * components/products/deal-score-badge.tsx renders the honest
 * withheld state — "Score withheld · N of 5 points" — when the
 * score is null because the prediction rests on fewer than
 * DEAL_SCORE_MIN_DATA_POINTS (5) recorded price points. At or
 * above 5 points the score renders as a number, never withheld.
 * An unknown count renders nothing rather than a guessed count.
 *
 * Rendered via react-dom/server (the repo's node vitest env has no
 * DOM; same pattern as tests/section14-chunk5-products.test.ts).
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

let DealScoreBadge: typeof import('@/components/products/deal-score-badge').DealScoreBadge;
beforeAll(async () => {
  ({ DealScoreBadge } = await import(
    '@/components/products/deal-score-badge'
  ));
});
import {
  DEAL_SCORE_MIN_DATA_POINTS,
  dealScoreForDisplay,
  formatDealScoreWithheld,
} from '@/lib/deal-score';

function renderBadge(props: {
  score: number | null;
  dataPoints?: number | null;
}): string {
  return renderToStaticMarkup(createElement(DealScoreBadge, props));
}

describe('DealScoreBadge — withheld below 5 points', () => {
  it('null score + 4 points renders the withheld message with the real count', () => {
    const html = renderBadge({ score: null, dataPoints: 4 });
    expect(html).toContain('Score withheld');
    expect(html).toContain('4 of 5 points');
  });

  it('null score + 1 point renders the withheld message with 1 point', () => {
    const html = renderBadge({ score: null, dataPoints: 1 });
    expect(html).toContain('Score withheld');
    expect(html).toContain('1 of 5 points');
  });

  it('null score + 0 points renders the withheld message with 0 points', () => {
    const html = renderBadge({ score: null, dataPoints: 0 });
    expect(html).toContain('Score withheld');
    expect(html).toContain('0 of 5 points');
  });

  it('the withheld note names the 5-point threshold in its title', () => {
    const html = renderBadge({ score: null, dataPoints: 4 });
    expect(html).toContain('at least 5 recorded price points');
  });
});

describe('DealScoreBadge — shown at/above 5 points', () => {
  it('a real score renders the number, never the withheld message', () => {
    const html = renderBadge({ score: 85, dataPoints: 6 });
    expect(html).toContain('85');
    expect(html).not.toContain('Score withheld');
    expect(html).toContain('Deal Score 85 out of 100');
  });

  it('a score at exactly 5 points is shown, not withheld', () => {
    const html = renderBadge({ score: 72, dataPoints: 5 });
    expect(html).toContain('72');
    expect(html).not.toContain('Score withheld');
  });

  it('null score + exactly 5 points renders nothing (threshold met, no count to explain)', () => {
    expect(renderBadge({ score: null, dataPoints: 5 })).toBe('');
  });
});

describe('DealScoreBadge — unknown count', () => {
  it('null score + unknown count renders nothing (never a guessed count)', () => {
    expect(renderBadge({ score: null, dataPoints: null })).toBe('');
    expect(renderBadge({ score: null })).toBe('');
  });
});

describe('Deal Score withheld gate (lib/deal-score.ts)', () => {
  it('formatDealScoreWithheld names the real count below 5, null at/above', () => {
    expect(formatDealScoreWithheld(4)).toContain('4 of 5');
    expect(formatDealScoreWithheld(5)).toBeNull();
    expect(formatDealScoreWithheld(6)).toBeNull();
    expect(formatDealScoreWithheld(null)).toBeNull();
    expect(formatDealScoreWithheld(undefined)).toBeNull();
  });

  it('dealScoreForDisplay hides the score below 5 points and shows it at 5', () => {
    const base = {
      discountProbability: 0,
      currentPrice: 999,
      lowestPrice: 999,
      confidenceScore: 100,
    };
    expect(
      dealScoreForDisplay({ ...base, dataPoints: 4 })
    ).toBeNull();
    expect(
      dealScoreForDisplay({ ...base, dataPoints: 5 })
    ).toBe(100);
    expect(DEAL_SCORE_MIN_DATA_POINTS).toBe(5);
  });
});

describe('DealScoreBadge — wired with real dataPoints on the list surfaces', () => {
  it('product-card mounts the badge and explains a withheld score in the card body', () => {
    const source = readFileSync(
      join(process.cwd(), 'components/products/product-card.tsx'),
      'utf8'
    );
    expect(source).toContain('DealScoreBadge');
    expect(source).toContain('dataPoints');
    // The card's own body note (not the badge) states the same
    // withheld fact with the real count when the score is hidden.
    expect(source).toContain('dealScoreDataPoints < 5');
    expect(source).toContain('Deal Score withheld');
  });

  it('search and compare mount the badge with real dataPoints', () => {
    for (const file of ['app/search/page.tsx', 'app/compare/page.tsx']) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      expect(source).toContain('DealScoreBadge');
      expect(source).toContain('dataPoints');
    }
  });
});
