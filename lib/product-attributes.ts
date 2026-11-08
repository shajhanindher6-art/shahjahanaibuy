/**
 * Pure helpers for rendering seeded product_attributes rows
 * (EAV-style specs: key, value, unit, group, sort_order).
 *
 * These take plain data in and return plain data out — no database,
 * no network — so they are unit-tested in tests/product-attributes.test.ts.
 *
 * Honesty rules (do not weaken):
 * - Only real rows from the database are rendered. Nothing here invents
 *   a spec value, a label, or a default.
 * - `key` is displayed verbatim as stored (e.g. "RAM", "Storage").
 * - `value` is displayed verbatim plus its stored `unit` when one
 *   exists (e.g. "16 GB"). No unit conversion, no guessing.
 * - A row with an empty value renders as nothing (the SpecRow hides
 *   it), never as a dash or placeholder.
 */

import type { ProductAttribute } from '@/types/catalog';

export interface AttributeGroup {
  /** The stored group name, or null for ungrouped rows. */
  group: string | null;
  items: ProductAttribute[];
}

/**
 * Group attributes by their stored `group`, preserving first-seen
 * group order and the input order (sort_order) inside each group.
 * Rows with a null/empty group are collected under `group: null`.
 * Returns [] for null/undefined/empty input.
 */
export function groupAttributes(
  attributes: ProductAttribute[] | null | undefined
): AttributeGroup[] {
  if (!attributes || attributes.length === 0) return [];

  const groups: AttributeGroup[] = [];
  const byGroup = new Map<string | null, ProductAttribute[]>();

  for (const attr of attributes) {
    const key = attr.group && attr.group !== '' ? attr.group : null;
    let bucket = byGroup.get(key);
    if (!bucket) {
      bucket = [];
      byGroup.set(key, bucket);
      groups.push({ group: key, items: bucket });
    }
    bucket.push(attr);
  }

  return groups;
}

/**
 * Display value for one attribute row: the stored value plus its
 * stored unit when one exists ("16 GB", "512 GB", "100 Wh").
 * Returns '' when the value itself is empty.
 */
export function formatAttributeValue(attr: ProductAttribute): string {
  const value = attr.value ?? '';
  if (value === '') return '';
  return attr.unit ? `${value} ${attr.unit}` : value;
}
