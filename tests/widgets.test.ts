/**
 * Tests for the embeddable price widgets' pure helpers (lib/widgets.ts).
 *
 * No I/O: slug validation, embed URL/code building, price-history
 * summarising, and the click-reporting payload. The embed page
 * itself (app/widgets/embed) is covered by the live check, not here.
 */

import { describe, expect, it } from 'vitest';
import {
  WIDGET_BASE_URL,
  WIDGET_DIMENSIONS,
  buildWidgetClickPayload,
  buildWidgetEmbedCode,
  buildWidgetUrl,
  isValidWidgetSlug,
  summarizePriceHistory,
  validateWidgetConfig,
} from '@/lib/widgets';

describe('isValidWidgetSlug', () => {
  it('accepts real catalog slugs', () => {
    expect(isValidWidgetSlug('macbook-air-13')).toBe(true);
    expect(isValidWidgetSlug('sony-wh-1000xm5')).toBe(true);
    expect(isValidWidgetSlug('a')).toBe(true);
  });

  it('rejects anything that is not a lowercase hyphen slug', () => {
    expect(isValidWidgetSlug('')).toBe(false);
    expect(isValidWidgetSlug('MacBook-Air')).toBe(false);
    expect(isValidWidgetSlug('macbook_air')).toBe(false);
    expect(isValidWidgetSlug('macbook air')).toBe(false);
    expect(isValidWidgetSlug('-macbook')).toBe(false);
    expect(isValidWidgetSlug('macbook-')).toBe(false);
    expect(isValidWidgetSlug('macbook--air')).toBe(false);
    expect(isValidWidgetSlug('../products')).toBe(false);
  });
});

describe('validateWidgetConfig', () => {
  it('accepts a full valid config', () => {
    const result = validateWidgetConfig({ slug: 'macbook-air-13', type: 'history', theme: 'dark' });
    expect(result).toEqual({
      config: { slug: 'macbook-air-13', type: 'history', theme: 'dark' },
    });
  });

  it('normalises the slug and defaults type/theme', () => {
    const result = validateWidgetConfig({ slug: '  MacBook-Air-13 ' });
    expect(result).toEqual({
      config: { slug: 'macbook-air-13', type: 'price', theme: 'light' },
    });
  });

  it('falls back to defaults for unknown type/theme instead of failing', () => {
    const result = validateWidgetConfig({ slug: 'dell-xps-13', type: 'chart', theme: 'pink' });
    expect(result).toEqual({
      config: { slug: 'dell-xps-13', type: 'price', theme: 'light' },
    });
  });

  it('fails only on a missing or malformed slug', () => {
    expect(validateWidgetConfig({})).toEqual({ errors: ['slug is required'] });
    expect(validateWidgetConfig({ slug: 'not a slug' })).toEqual({
      errors: ['slug must be lowercase letters, digits, and hyphens only'],
    });
    expect(validateWidgetConfig({ slug: 42 })).toEqual({ errors: ['slug is required'] });
  });
});

describe('buildWidgetUrl / buildWidgetEmbedCode', () => {
  const config = { slug: 'macbook-air-13', type: 'price' as const, theme: 'light' as const };

  it('builds the canonical embed URL on the live domain', () => {
    expect(buildWidgetUrl(config)).toBe(
      `${WIDGET_BASE_URL}/widgets/embed?slug=macbook-air-13&type=price&theme=light`
    );
  });

  it('strips a trailing slash from a custom base URL', () => {
    expect(buildWidgetUrl(config, 'https://example.com/')).toBe(
      'https://example.com/widgets/embed?slug=macbook-air-13&type=price&theme=light'
    );
  });

  it('builds an iframe snippet with the fixed price-widget dimensions', () => {
    const code = buildWidgetEmbedCode(config);
    expect(code).toContain(`src="${WIDGET_BASE_URL}/widgets/embed?slug=macbook-air-13`);
    expect(code).toContain(`width="${WIDGET_DIMENSIONS.price.width}"`);
    expect(code).toContain(`height="${WIDGET_DIMENSIONS.price.height}"`);
    expect(code).toContain('loading="lazy"');
    expect(code).toContain('title="SmartBuy AI price widget — macbook-air-13"');
  });

  it('uses the taller history dimensions for history widgets', () => {
    const code = buildWidgetEmbedCode({ ...config, type: 'history' });
    expect(code).toContain(`height="${WIDGET_DIMENSIONS.history.height}"`);
    expect(WIDGET_DIMENSIONS.history.height).toBeGreaterThan(WIDGET_DIMENSIONS.price.height);
  });
});

describe('summarizePriceHistory', () => {
  it('returns nulls and hasEnoughHistory false with no points', () => {
    expect(summarizePriceHistory([])).toEqual({
      lowest: null,
      highest: null,
      current: null,
      previous: null,
      change: null,
      points: 0,
      hasEnoughHistory: false,
    });
  });

  it('needs 2 points for enough history', () => {
    const one = summarizePriceHistory([{ price: 999, recordedAt: '2026-11-01T00:00:00Z' }]);
    expect(one).toMatchObject({ points: 1, current: 999, previous: null, change: null, hasEnoughHistory: false });
  });

  it('summarises lowest/highest/current/previous/change from real points', () => {
    const summary = summarizePriceHistory([
      { price: 1018.98, recordedAt: '2026-10-26T00:00:00Z' },
      { price: 999, recordedAt: '2026-11-01T00:00:00Z' },
      { price: 1005, recordedAt: '2026-11-02T00:00:00Z' },
    ]);
    expect(summary).toEqual({
      lowest: 999,
      highest: 1018.98,
      current: 1005,
      previous: 999,
      change: 6,
      points: 3,
      hasEnoughHistory: true,
    });
  });

  it('ignores non-positive and non-finite prices instead of inventing a range', () => {
    const summary = summarizePriceHistory([
      { price: 0, recordedAt: '2026-10-26T00:00:00Z' },
      { price: Number.NaN, recordedAt: '2026-10-27T00:00:00Z' },
      { price: -5, recordedAt: '2026-10-28T00:00:00Z' },
      { price: 500, recordedAt: '2026-11-01T00:00:00Z' },
    ]);
    expect(summary).toMatchObject({ points: 1, lowest: 500, highest: 500, current: 500 });
  });
});

describe('buildWidgetClickPayload', () => {
  it('builds the beacon payload for a valid click', () => {
    expect(
      buildWidgetClickPayload({ slug: 'macbook-air-13', targetUrl: 'https://shahjahanaibuy-b1zp.vercel.app/products/macbook-air-13' })
    ).toEqual({
      productSlug: 'macbook-air-13',
      targetUrl: 'https://shahjahanaibuy-b1zp.vercel.app/products/macbook-air-13',
      merchantName: 'SmartBuy widget',
    });
  });

  it('rejects bad slugs, empty targets, and non-http(s) targets', () => {
    expect(buildWidgetClickPayload({ slug: 'Bad Slug', targetUrl: 'https://example.com' })).toBeNull();
    expect(buildWidgetClickPayload({ slug: 'macbook-air-13', targetUrl: '' })).toBeNull();
    expect(buildWidgetClickPayload({ slug: 'macbook-air-13', targetUrl: 'javascript:alert(1)' })).toBeNull();
    expect(buildWidgetClickPayload({ slug: 'macbook-air-13', targetUrl: 'ftp://example.com/x' })).toBeNull();
    expect(buildWidgetClickPayload({ slug: 'macbook-air-13', targetUrl: 'not-a-url' })).toBeNull();
  });
});
