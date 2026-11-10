import { describe, expect, it } from 'vitest';
import {
  buildPriceDropDigest,
  type PriceHistoryPointInput,
  type WatchedProductInput,
} from '@/lib/price-drop-digest';

const NOW = new Date('2026-11-10T12:00:00Z').getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

const watched: WatchedProductInput[] = [
  { productId: 'p-mac', productSlug: 'macbook-air-m4', productName: 'MacBook Air M4' },
  { productId: 'p-pods', productSlug: 'airpods-pro', productName: 'AirPods Pro' },
  { productId: 'p-phone', productSlug: 'iphone-16', productName: 'iPhone 16' },
];

const history: PriceHistoryPointInput[] = [
  // MacBook: 30-day average ~1018.98, latest in the last 24h is 999 → a drop.
  { productId: 'p-mac', price: 1018.98, recordedAt: daysAgo(20) },
  { productId: 'p-mac', price: 1018.98, recordedAt: daysAgo(10) },
  { productId: 'p-mac', price: 999, recordedAt: hoursAgo(5) },
  // AirPods: flat price, no drop.
  { productId: 'p-pods', price: 189, recordedAt: daysAgo(15) },
  { productId: 'p-pods', price: 189, recordedAt: hoursAgo(3) },
  // iPhone: dropped 6 days ago (inside the weekly window, outside daily).
  { productId: 'p-phone', price: 899, recordedAt: daysAgo(20) },
  { productId: 'p-phone', price: 799, recordedAt: daysAgo(6) },
];

describe('buildPriceDropDigest', () => {
  it('includes only watched products with a real drop below the 30-day average, best first', () => {
    const digest = buildPriceDropDigest(watched, history, 'weekly', NOW);
    expect(digest.watchedCount).toBe(3);
    expect(digest.windowDays).toBe(7);
    expect(digest.deals.map((d) => d.productId)).toEqual(['p-phone', 'p-mac']);
    const phone = digest.deals[0];
    expect(phone.percentBelowAverage).toBeCloseTo(11.1, 1);
    expect(phone.currentPrice).toBe(799);
    expect(phone.reason).toMatch(/11\.1% below its 30-day average/);
    expect(phone.reason).toMatch(/\$799\.00 now versus a \$899\.00 average/);
    const mac = digest.deals[1];
    expect(mac.percentBelowAverage).toBeCloseTo(2.0, 1);
    expect(mac.previousPrice).toBe(1018.98);
  });

  it('daily window excludes a drop that happened 6 days ago', () => {
    const digest = buildPriceDropDigest(watched, history, 'daily', NOW);
    expect(digest.deals.map((d) => d.productId)).toEqual(['p-mac']);
    expect(digest.windowDays).toBe(1);
  });

  it('never includes a product the user does not watch', () => {
    const extra: PriceHistoryPointInput[] = [
      { productId: 'p-stranger', price: 500, recordedAt: daysAgo(20) },
      { productId: 'p-stranger', price: 100, recordedAt: hoursAgo(2) },
    ];
    const digest = buildPriceDropDigest(watched, [...history, ...extra], 'weekly', NOW);
    expect(digest.deals.some((d) => d.productId === 'p-stranger')).toBe(false);
  });

  it('returns an empty deal list — not invented deals — when nothing dropped', () => {
    const flat: PriceHistoryPointInput[] = [
      { productId: 'p-pods', price: 189, recordedAt: daysAgo(15) },
      { productId: 'p-pods', price: 189, recordedAt: hoursAgo(3) },
    ];
    const digest = buildPriceDropDigest(
      [{ productId: 'p-pods', productName: 'AirPods Pro' }],
      flat,
      'weekly',
      NOW
    );
    expect(digest.deals).toEqual([]);
    expect(digest.watchedCount).toBe(1);
  });

  it('skips a product with no baseline before the window — a single point cannot prove a drop', () => {
    const digest = buildPriceDropDigest(
      [{ productId: 'p-new', productName: 'Brand New' }],
      [{ productId: 'p-new', price: 50, recordedAt: hoursAgo(2) }],
      'weekly',
      NOW
    );
    expect(digest.deals).toEqual([]);
  });

  it('ignores invalid history points and de-duplicates watched products', () => {
    const digest = buildPriceDropDigest(
      [
        { productId: 'p-mac', productName: 'MacBook Air M4' },
        { productId: 'p-mac', productName: 'MacBook Air M4' },
      ],
      [
        { productId: 'p-mac', price: 1018.98, recordedAt: daysAgo(10) },
        { productId: 'p-mac', price: 0, recordedAt: hoursAgo(1) },
        { productId: 'p-mac', price: NaN, recordedAt: hoursAgo(1) },
        { productId: 'p-mac', price: 999, recordedAt: hoursAgo(5) },
      ],
      'weekly',
      NOW
    );
    expect(digest.watchedCount).toBe(1);
    expect(digest.deals).toHaveLength(1);
    expect(digest.deals[0].currentPrice).toBe(999);
  });
});
