/**
 * Shared AI transparency block tests (Section 19, Phase 7, §12 #70).
 * Rendered via react-dom/server (vitest environment is node — no
 * DOM), same pattern as tests/bnpl-line.test.ts: `.test.ts` with
 * createElement, no JSX.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TransparencyBlock } from '@/components/ai/transparency-block';

function renderBlock(props: Parameters<typeof TransparencyBlock>[0]): string {
  return renderToStaticMarkup(createElement(TransparencyBlock, props));
}

describe('TransparencyBlock (§12 #70)', () => {
  it('renders data used, timestamp, confidence, assumptions and missing info', () => {
    const html = renderBlock({
      title: 'How these deals are ranked',
      dataUsed: ['Deals table: claimed discount, deal type, dates.'],
      dataTimestamp: '2026-11-12T10:00:00.000Z',
      dataTimestampLabel: 'Rankings generated at',
      confidence: 'AI Score is a ranking score, not a verified discount.',
      assumptions: ['The claimed discount is the merchant’s stated figure.'],
      missingInfo: ['No review data is used for ranking.'],
    });
    expect(html).toContain('How these deals are ranked');
    expect(html).toContain('Deals table: claimed discount');
    expect(html).toContain('12 November 2026');
    expect(html).toContain('AI Score is a ranking score');
    expect(html).toContain('merchant’s stated figure');
    expect(html).toContain('No review data is used for ranking');
    expect(html).toContain('What is missing');
  });

  it('renders an honest "missing info" line when the caller lists nothing', () => {
    const html = renderBlock({
      dataUsed: ['Recorded price history.'],
      dataTimestamp: null,
    });
    expect(html).toContain('Not listed');
    expect(html).toContain('treat this result as incomplete');
    // A missing timestamp is never guessed.
    expect(html).toContain('Not recorded');
  });

  it('renders an honest line when no data source is listed', () => {
    const html = renderBlock({ dataUsed: [] });
    expect(html).toContain('did not list what data was used');
  });

  it('omits the confidence row when the surface has no score', () => {
    const html = renderBlock({ dataUsed: ['Recorded prices.'] });
    expect(html).not.toContain('Confidence');
  });
});
