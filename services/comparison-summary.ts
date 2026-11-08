/**
 * Comparison Summary — Option 14-B.
 *
 * Deterministic badge rules for the summary banner above the
 * comparison matrices. NO LLM, NO invented claims: every badge is
 * earned from REAL data only, by a rule written down here.
 *
 *   - "Best for Battery Life": the unique product with the highest
 *     parseable battery value (attribute key matching /battery/i,
 *     unit Wh or mAh). Only when at least two products have a
 *     parseable battery value AND they share one unit — Wh and mAh
 *     are never compared against each other (no voltage assumption,
 *     no conversion). A tie for the max, or a unit mix, earns no badge.
 *   - "Best for Multitasking": the unique product with the highest
 *     parseable RAM value (key RAM or Memory, unit GB or MB), same
 *     ≥2-products / unique-max / single-unit rules.
 *   - "Best Value for Money": the unique product with the lowest
 *     lowest-price (real retailer prices already on the page). Only
 *     when at least two products have a real price and the minimum
 *     is unique. A tie, or fewer than two priced products, earns
 *     no badge.
 *
 * Numeric parsing takes the leading number of a value ("16 GB" → 16,
 * "2.5 GHz" → 2.5, "1,000 mAh" → 1000). A value with no leading
 * number ("Large") is unparseable and ignored. Nothing here fetches
 * anything — the caller passes the products and their attributes in.
 */

import { formatAttributeValue } from '@/lib/product-attributes';
import type { ProductAttribute } from '@/types/catalog';

export interface SummaryBadgeProductInput {
  productId: string;
  name: string;
  /** Lowest recorded retailer price, or null when unpriced. */
  lowestPriceUsd: number | null;
  attributes: ProductAttribute[];
}

export type ComparisonBadge =
  | {
      kind: 'battery';
      productId: string;
      productName: string;
      label: 'Best for Battery Life';
      /** Formatted battery value, e.g. "100 Wh". */
      detail: string;
    }
  | {
      kind: 'value';
      productId: string;
      productName: string;
      label: 'Best Value for Money';
      /** Lowest recorded price in USD (rendered region-aware). */
      priceUsd: number;
    }
  | {
      kind: 'multitasking';
      productId: string;
      productName: string;
      label: 'Best for Multitasking';
      /** Formatted RAM value, e.g. "16 GB". */
      detail: string;
    };

interface ParsedNumber {
  num: number;
  /** Unit parsed from the value string itself, e.g. "gb" from "16 GB". */
  trailingUnit: string | null;
}

/** Leading number of a value string, or null when there is none. */
export function parseLeadingNumber(raw: string | null | undefined): ParsedNumber | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim().replace(/,/g, '');
  if (text === '') return null;
  const match = text.match(/^(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return null;
  const rest = text.slice(match[1].length).trim();
  const unitMatch = rest.match(/^([a-zA-Z]+)/);
  return { num, trailingUnit: unitMatch ? unitMatch[1].toLowerCase() : null };
}

interface NumericCandidate {
  productIndex: number;
  value: number;
  unit: string;
  display: string;
}

function collectNumericCandidates(
  products: SummaryBadgeProductInput[],
  keyPattern: RegExp,
  allowedUnits: string[]
): NumericCandidate[] {
  const candidates: NumericCandidate[] = [];
  const allowed = new Set(allowedUnits.map((u) => u.toLowerCase()));

  products.forEach((product, productIndex) => {
    for (const attr of product.attributes ?? []) {
      const key = (attr.key ?? '').trim();
      if (!keyPattern.test(key)) continue;
      const parsed = parseLeadingNumber(attr.value);
      if (!parsed || !Number.isFinite(parsed.num) || parsed.num <= 0) continue;
      const unit = (attr.unit && attr.unit !== '' ? attr.unit : parsed.trailingUnit)?.toLowerCase() ?? null;
      if (!unit || !allowed.has(unit)) continue;
      candidates.push({
        productIndex,
        value: parsed.num,
        unit,
        display: formatAttributeValue(attr),
      });
      break; // first parseable row for this key per product wins
    }
  });

  return candidates;
}

/**
 * The unique-max winner among numeric candidates, or null when the
 * rule cannot be applied honestly: fewer than two distinct products
 * with a value, values spanning more than one unit, or a tie for the
 * maximum.
 */
function uniqueMaxCandidate(
  candidates: NumericCandidate[]
): NumericCandidate | null {
  const byProduct = new Map<number, NumericCandidate>();
  for (const c of candidates) {
    if (!byProduct.has(c.productIndex)) byProduct.set(c.productIndex, c);
  }
  if (byProduct.size < 2) return null;
  const units = new Set([...byProduct.values()].map((c) => c.unit));
  if (units.size !== 1) return null;
  const list = [...byProduct.values()];
  const max = Math.max(...list.map((c) => c.value));
  const winners = list.filter((c) => c.value === max);
  if (winners.length !== 1) return null;
  return winners[0];
}

function uniqueMinPrice(
  products: SummaryBadgeProductInput[]
): { productIndex: number; price: number } | null {
  const priced = products
    .map((p, i) => ({ productIndex: i, price: p.lowestPriceUsd }))
    .filter(
      (c): c is { productIndex: number; price: number } =>
        c.price !== null && Number.isFinite(c.price) && c.price > 0
    );
  if (priced.length < 2) return null;
  const min = Math.min(...priced.map((c) => c.price));
  const winners = priced.filter((c) => c.price === min);
  if (winners.length !== 1) return null;
  return winners[0];
}

/**
 * The list of badges earned by the compared products, in a fixed
 * order (battery, value, multitasking). Returns [] when nothing is
 * earned — the banner renders nothing in that case.
 */
export function buildComparisonBadges(
  products: SummaryBadgeProductInput[]
): ComparisonBadge[] {
  if (!products || products.length < 2) return [];
  const badges: ComparisonBadge[] = [];

  const battery = uniqueMaxCandidate(
    collectNumericCandidates(products, /battery/i, ['wh', 'mah'])
  );
  if (battery) {
    const product = products[battery.productIndex];
    badges.push({
      kind: 'battery',
      productId: product.productId,
      productName: product.name,
      label: 'Best for Battery Life',
      detail: battery.display,
    });
  }

  const value = uniqueMinPrice(products);
  if (value) {
    const product = products[value.productIndex];
    badges.push({
      kind: 'value',
      productId: product.productId,
      productName: product.name,
      label: 'Best Value for Money',
      priceUsd: value.price,
    });
  }

  const ram = uniqueMaxCandidate(
    collectNumericCandidates(products, /^(ram|memory)$/i, ['gb', 'mb'])
  );
  if (ram) {
    const product = products[ram.productIndex];
    badges.push({
      kind: 'multitasking',
      productId: product.productId,
      productName: product.name,
      label: 'Best for Multitasking',
      detail: ram.display,
    });
  }

  return badges;
}
