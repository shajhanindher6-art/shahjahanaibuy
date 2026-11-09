/**
 * Client-side fetch for one product's seeded specifications.
 *
 * Reads GET /api/v1/products/[slug], which returns `attributes[]`
 * (camelCase ProductAttribute rows: key, value, unit, group,
 * sortOrder). The response is normalised defensively — snake_case
 * keys are accepted too, so a stale deploy shape cannot break the
 * caller — and ANY failure (network, non-2xx, malformed payload)
 * resolves to [] instead of throwing: missing specs are honest
 * empty data, never an error the UI has to explain.
 */

import type { ProductAttribute } from '@/types/catalog';
import { fetchTimed } from '@/lib/fetch-timed';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toProductAttribute(row: unknown): ProductAttribute | null {
  const r = asRecord(row);
  if (!r) return null;
  const key = r.key;
  if (typeof key !== 'string' || key === '') return null;
  const id = r.id;
  const productId = r.productId ?? r.product_id;
  return {
    id: typeof id === 'string' ? id : '',
    productId: typeof productId === 'string' ? productId : '',
    key,
    value: typeof r.value === 'string' ? r.value : r.value == null ? '' : String(r.value),
    unit: typeof r.unit === 'string' ? r.unit : null,
    group: typeof r.group === 'string' ? r.group : null,
    sortOrder: Number(r.sortOrder ?? r.sort_order ?? 0) || 0,
  };
}

export interface FetchAttributesResult {
  /** False when the endpoint could not be reached or answered with
      an error — the caller can then hide its section instead of
      showing an empty state for data it never actually saw. */
  ok: boolean;
  attributes: ProductAttribute[];
}

/**
 * Seeded specs for one product slug. Returns ok:false with [] when
 * the endpoint fails (network, non-2xx, malformed payload); ok:true
 * with [] when the product simply has no seeded rows.
 */
export async function fetchProductAttributes(slug: string): Promise<FetchAttributesResult> {
  try {
    // P0 fix (2026-11-09 audit): 15s hard timeout — a hanging API
    // used to keep the Spec Matrix on "Loading…" forever; on timeout
    // this returns ok:false and the section hides instead of hanging.
    const res = await fetchTimed(`/api/v1/products/${encodeURIComponent(slug)}`, 15000);
    if (!res.ok) return { ok: false, attributes: [] };
    const json: unknown = await res.json();
    const data = asRecord(json)?.data;
    const attributes = asRecord(data)?.attributes;
    if (!Array.isArray(attributes)) return { ok: false, attributes: [] };
    return {
      ok: true,
      attributes: attributes
        .map(toProductAttribute)
        .filter((a): a is ProductAttribute => a !== null),
    };
  } catch {
    return { ok: false, attributes: [] };
  }
}
