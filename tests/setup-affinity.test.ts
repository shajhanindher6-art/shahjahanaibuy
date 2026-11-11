/**
 * Unit tests for the "Complete your setup" affinity picks (Section
 * 14, Chunk 2, B12). Pure map + ranking — no database, no network.
 */

import { describe, expect, it } from 'vitest';
import { getSetupAffinity, SETUP_AFFINITY, type AffinityCandidate } from '@/lib/setup-affinity';

function candidate(partial: Partial<AffinityCandidate> & { slug: string }): AffinityCandidate {
  return {
    id: partial.slug,
    name: 'Product',
    brand: null,
    category: 'Headphones',
    price: 100,
    ...partial,
  };
}

const CATALOG: AffinityCandidate[] = [
  candidate({ slug: 'macbook-air-13', name: 'MacBook Air 13', brand: 'Apple', category: 'Laptops', price: 999 }),
  candidate({ slug: 'sony-wh-1000xm5', name: 'Sony WH-1000XM5', brand: 'Sony', category: 'Headphones', price: 399 }),
  candidate({ slug: 'bose-quietcomfort-ultra', name: 'Bose QuietComfort Ultra', brand: 'Bose', category: 'Headphones', price: 429 }),
  candidate({ slug: 'logitech-mx-master-3s', name: 'Logitech MX Master 3S', brand: 'Logitech', category: 'Mouse', price: 99 }),
  candidate({ slug: 'garmin-venu-3', name: 'Garmin Venu 3', brand: 'Garmin', category: 'Watches', price: 449 }),
  candidate({ slug: 'galaxy-s24-ultra', name: 'Galaxy S24 Ultra', brand: 'Samsung', category: 'Phones', price: 1199 }),
];

describe('getSetupAffinity', () => {
  it('maps laptop -> headphones, mouse, monitor (cheapest per slot, in order)', () => {
    expect(SETUP_AFFINITY.laptop).toEqual(['headphones', 'mouse', 'monitor']);
    const picks = getSetupAffinity('Laptops', 'macbook-air-13', CATALOG);
    // Headphones: cheapest is the Sony ($399, not the Bose $429).
    // Mouse: the Logitech ($99). Monitor: no monitor in the catalog.
    expect(picks.map((p) => p.slug)).toEqual(['sony-wh-1000xm5', 'logitech-mx-master-3s']);
    expect(picks[0].affinityCategory).toBe('headphones');
    expect(picks[1].affinityCategory).toBe('mouse');
  });

  it('maps phone -> watch, headphones', () => {
    const picks = getSetupAffinity('Phones', 'galaxy-s24-ultra', CATALOG);
    expect(picks.map((p) => p.slug)).toEqual(['garmin-venu-3', 'sony-wh-1000xm5']);
    expect(picks.map((p) => p.affinityCategory)).toEqual(['watch', 'headphones']);
  });

  it('never picks the current product or its own category', () => {
    const picks = getSetupAffinity('Headphones', 'sony-wh-1000xm5', CATALOG);
    // Headphones affinity is phone + laptop; the current product
    // and the other headphones must not appear.
    expect(picks.map((p) => p.slug)).toEqual(['galaxy-s24-ultra', 'macbook-air-13']);
    expect(picks.every((p) => p.slug !== 'sony-wh-1000xm5')).toBe(true);
  });

  it('drops unpriced candidates and caps at 3', () => {
    const picks = getSetupAffinity(
      'Laptops',
      'macbook-air-13',
      [
        ...CATALOG,
        candidate({ slug: 'unpriced-hp', name: 'Free Headphones', category: 'Headphones', price: null }),
        candidate({ slug: 'zero-hp', name: 'Zero Headphones', category: 'Headphones', price: 0 }),
      ]
    );
    expect(picks.map((p) => p.slug)).toEqual(['sony-wh-1000xm5', 'logitech-mx-master-3s']);
    expect(picks.length).toBeLessThanOrEqual(3);
  });

  it('returns [] for an unknown category, a null category, or no priced fill', () => {
    expect(getSetupAffinity('Toasters', 'x', CATALOG)).toEqual([]);
    expect(getSetupAffinity(null, 'x', CATALOG)).toEqual([]);
    expect(
      getSetupAffinity('Laptops', 'macbook-air-13', [
        candidate({ slug: 'only-laptop', category: 'Laptops', price: 500 }),
      ])
    ).toEqual([]);
  });

  it('matches categories case-insensitively, either direction', () => {
    const picks = getSetupAffinity('laptop', 'macbook-air-13', CATALOG);
    expect(picks.map((p) => p.slug)).toEqual(['sony-wh-1000xm5', 'logitech-mx-master-3s']);
  });
});
