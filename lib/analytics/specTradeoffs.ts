/**
 * Zero-Jargon Spec Matrix (Option 16, Step 2).
 *
 * Translates RECORDED product specs (product_attributes rows) into
 * plain-language benefits. Deterministic string/number rules only —
 * no LLM, no fetch, no scraping.
 *
 * HONESTY RULES (do not weaken them):
 * - Only recorded rows are translated. A spec that was never recorded
 *   is never translated, guessed, or shown with a made-up value.
 * - Translations describe what a spec level generally enables
 *   ("what this means for you"), never a measured test result, a
 *   benchmark score, or a battery-life claim in hours.
 * - An attribute key with no translation rule returns null and is
 *   skipped by the table — the raw spec still shows in the Specs tab.
 * - The spec tier (basic / balanced / pro) is the highest tier across
 *   translated rows, or null when nothing was translated.
 */

import type { ProductAttribute } from '@/types/catalog';

export type SpecTier = 'basic' | 'balanced' | 'pro';

export interface SpecTradeoffRow {
  /** Stored spec key, verbatim (e.g. "RAM"). */
  key: string;
  /** Stored value + unit, verbatim (e.g. "16 GB"). */
  displayValue: string;
  /** Plain-language benefit. */
  benefit: string;
  tier: SpecTier;
}

function numericValue(attr: ProductAttribute): number | null {
  const digits = String(attr.value ?? '').replace(/[^0-9.]/g, '');
  if (digits === '' || digits === '.') return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function keyOf(attr: ProductAttribute): string {
  return String(attr.key ?? '').trim().toLowerCase();
}

function valueOf(attr: ProductAttribute): string {
  return String(attr.value ?? '').trim().toLowerCase();
}

/**
 * Translate one recorded spec row into a plain-language benefit.
 * Returns null when the key has no translation rule or the value
 * cannot be parsed — the caller skips it.
 */
export function translateSpec(
  attr: ProductAttribute
): { benefit: string; tier: SpecTier } | null {
  const key = keyOf(attr);
  const raw = valueOf(attr);
  const num = numericValue(attr);

  if (key.includes('ram') || key.includes('memory')) {
    if (num === null) return null;
    if (num >= 16) {
      return {
        benefit: 'Smooth 4K video editing & heavy multitasking',
        tier: 'pro',
      };
    }
    if (num >= 8) {
      return {
        benefit: 'Smooth everyday multitasking — many apps and tabs at once',
        tier: 'balanced',
      };
    }
    return {
      benefit: 'Fine for browsing, email and documents',
      tier: 'basic',
    };
  }

  if (key.includes('storage') || key.includes('ssd') || key.includes('rom')) {
    if (num === null) return null;
    if (num >= 1000) {
      return {
        benefit: 'Room for years of photos, videos and large apps',
        tier: 'pro',
      };
    }
    if (num >= 512) {
      return {
        benefit: 'Plenty of room for apps, photos and large files',
        tier: 'balanced',
      };
    }
    return {
      benefit: 'Enough for apps and documents — cloud storage helps for more',
      tier: 'basic',
    };
  }

  if (key.includes('battery')) {
    if (num === null) return null;
    // Wh (laptops) and mAh (phones) share the same rule: a bigger
    // number means longer time away from a charger. No hours claimed.
    const isMah = (attr.unit ?? '').toLowerCase().includes('mah') || raw.includes('mah');
    const big = isMah ? num >= 5000 : num >= 70;
    const medium = isMah ? num >= 4000 : num >= 40;
    if (big) {
      return { benefit: 'Large battery — longer time away from a charger', tier: 'pro' };
    }
    if (medium) {
      return { benefit: 'Solid battery for a day of mixed use', tier: 'balanced' };
    }
    return { benefit: 'Smaller battery — keep a charger nearby', tier: 'basic' };
  }

  if (key.includes('display') || key.includes('screen')) {
    if (num === null) return null;
    if (num >= 15) {
      return {
        benefit: 'Large canvas for editing and split-screen work',
        tier: 'pro',
      };
    }
    if (num >= 13) {
      return {
        benefit: 'Comfortable size for work and watching',
        tier: 'balanced',
      };
    }
    return { benefit: 'Compact and portable — great for travel', tier: 'basic' };
  }

  if (key.includes('processor') || key.includes('cpu') || key.includes('chip')) {
    if (/i9|m3 pro|m3 max|m4 pro|ryzen 9|ultra 9/.test(raw)) {
      return {
        benefit: 'Top-tier speed for rendering and heavy workloads',
        tier: 'pro',
      };
    }
    if (/i7|m3|m4|ryzen 7|ultra 7/.test(raw)) {
      return {
        benefit: 'Fast for demanding apps and light editing',
        tier: 'balanced',
      };
    }
    if (/i5|m2|ryzen 5|ultra 5/.test(raw)) {
      return {
        benefit: 'Solid speed for everyday work and study',
        tier: 'balanced',
      };
    }
    if (/i3|m1|ryzen 3|celeron|pentium/.test(raw)) {
      return {
        benefit: 'Basic speed — best for light tasks',
        tier: 'basic',
      };
    }
    return null;
  }

  if (key.includes('camera') || key.includes('megapixel')) {
    if (num === null) return null;
    if (num >= 48) {
      return { benefit: 'Very detailed photos — great for cropping and printing', tier: 'pro' };
    }
    if (num >= 24) {
      return { benefit: 'Sharp photos for everyday and travel', tier: 'balanced' };
    }
    return { benefit: 'Basic photos for casual snapshots', tier: 'basic' };
  }

  if (key.includes('weight')) {
    if (num === null) return null;
    // Stored in kg (unit) or grams (large numbers without a kg unit).
    const grams = (attr.unit ?? '').toLowerCase().includes('g') && !(attr.unit ?? '').toLowerCase().includes('kg')
      ? num
      : num * 1000;
    if (grams <= 1200) {
      return { benefit: 'Feather-light — easy to carry all day', tier: 'pro' };
    }
    if (grams <= 1800) {
      return { benefit: 'Comfortable to carry in a bag', tier: 'balanced' };
    }
    return { benefit: 'Heavier — better kept on a desk', tier: 'basic' };
  }

  return null;
}

/**
 * Translate all recorded spec rows that have a rule. Rows without a
 * rule are skipped (the raw spec still shows in the Specs tab).
 * Returns [] for null/empty input.
 */
export function tradeoffRows(
  attributes: ProductAttribute[] | null | undefined
): SpecTradeoffRow[] {
  if (!attributes || attributes.length === 0) return [];
  const rows: SpecTradeoffRow[] = [];
  for (const attr of attributes) {
    const translated = translateSpec(attr);
    if (!translated) continue;
    const displayValue = [attr.value, attr.unit].filter(Boolean).join(' ');
    rows.push({
      key: attr.key,
      displayValue: displayValue || String(attr.value ?? ''),
      benefit: translated.benefit,
      tier: translated.tier,
    });
  }
  return rows;
}

/**
 * Highest spec tier across the translated rows, or null when no row
 * could be translated (no recorded specs, or no rule for them).
 */
export function specTierFromAttributes(
  attributes: ProductAttribute[] | null | undefined
): SpecTier | null {
  const rows = tradeoffRows(attributes);
  if (rows.length === 0) return null;
  const rank: Record<SpecTier, number> = { basic: 0, balanced: 1, pro: 2 };
  let best: SpecTier = 'basic';
  for (const row of rows) {
    if (rank[row.tier] > rank[best]) best = row.tier;
  }
  return best;
}
