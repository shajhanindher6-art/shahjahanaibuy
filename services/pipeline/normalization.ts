/**
 * Normalization service — maps validated RawProductData to internal Product model.
 */

import type { ValidatedRawProduct } from './validation';
import { normalizeGtin } from '@/lib/gtin';
import { normalizeModel } from '@/lib/model-normalization';
import type { SpecEntryInput } from '@/lib/spec-templates';
import type { ProductVariantInput } from './variants';

export interface NormalizedProduct {
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  gtin: string | null;
  /** FINAL 100% (F-P1-45/F-P1-46): canonical normalized model number, or null. */
  modelNumber: string | null;
  confidenceScore: number;
  images: string[];
  price: number;
  currency: string;
  availability: string;
  url: string | null;
  externalId: string;
  retailerSlug: string;
  raw: Record<string, unknown> | undefined;
  /** Specs the feed carried (validated against the template at write time). */
  specs: SpecEntryInput[];
  /** Variants the feed carried (matched/created at write time). */
  variants: ProductVariantInput[];
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

function normalizeCategory(category?: string | null): string | null {
  if (!category) return null;
  return category
    .split('>')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' > ');
}

function calculateConfidenceScore(data: ValidatedRawProduct): number {
  let score = 0;
  if (data.name) score += 15;
  if (data.description) score += 15;
  if (data.brand) score += 10;
  if (data.category) score += 10;
  if (data.gtin) score += 20;
  if (data.images && data.images.length > 0) score += 10;
  if (data.price > 0) score += 10;
  if (data.url) score += 5;
  if (data.availability !== 'unknown') score += 5;
  return Math.min(score, 100);
}

export function normalizeProduct(data: ValidatedRawProduct): NormalizedProduct {
  return {
    name: data.name,
    slug: generateSlug(data.name),
    description: data.description ?? null,
    brand: data.brand ?? null,
    category: normalizeCategory(data.category),
    imageUrl: data.images?.[0] ?? null,
    // Section 20, §12 #31 — store the canonical digits-only
    // GTIN (spaces/hyphens stripped); an absent GTIN stays null.
    gtin: normalizeGtin(data.gtin),
    // FINAL 100% (F-P1-46): store the canonical normalized model
    // ("SM-S928B" variants collapse to "SMS928B"); absent stays null.
    modelNumber: normalizeModel(data.modelNumber ?? null),
    confidenceScore: calculateConfidenceScore(data),
    images: data.images ?? [],
    price: data.price,
    currency: data.currency.toUpperCase(),
    availability: data.availability,
    url: data.url ?? null,
    externalId: data.externalId,
    retailerSlug: data.retailerSlug,
    raw: data.raw,
    specs: (data.specs ?? []).map((s) => ({
      key: s.key,
      value: s.value,
      ...(s.unit ? { unit: s.unit } : {}),
    })),
    variants: (data.variants ?? []).map((v) => ({
      name: v.name,
      ...(v.attributes ? { attributes: v.attributes } : {}),
      ...(v.sku ? { sku: v.sku } : {}),
      ...(v.gtin ? { gtin: v.gtin } : {}),
      // FINAL 100% (F-P1-47): variant model number passthrough.
      ...(v.modelNumber ? { modelNumber: v.modelNumber } : {}),
      ...(v.imageUrl ? { imageUrl: v.imageUrl } : {}),
      ...(v.inStock !== undefined ? { inStock: v.inStock } : {}),
      ...(v.sortOrder !== undefined ? { sortOrder: v.sortOrder } : {}),
    })),
  };
}
