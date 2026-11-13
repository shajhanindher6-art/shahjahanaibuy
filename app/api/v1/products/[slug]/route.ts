/**
 * API v1 product detail endpoint.
 * GET /api/v1/products/[slug] — fetch a single product by slug with its images.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  getCachedProductBySlug,
  getProductImages,
  getProductAttributes,
  getProductVariants,
} from '@/services/products';
import { getProductRepairability } from '@/services/repairability';
import { getProductEndurance } from '@/services/hardware-endurance';
import { getProductPhysical } from '@/services/physical-attributes';
import { getProductRecordedOverrides } from '@/services/recorded-overrides';
import { getProductGlobalReadiness } from '@/services/global-readiness';
import {
  getProductDimensions,
  getProductModelUrl,
  getProductAuthenticity,
  getProductSupplyChain,
} from '@/services/product-dimensions';

import { logApiError } from '@/lib/api/error-logging';
import { computeProductQualityScore } from '@/services/product-quality-score';
import { getProductQualityContexts } from '@/services/admin-products';
// Section 14, Chunk 1 — live per-request data: never statically prerendered.
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.detail', slug: params.slug });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`products.slug:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const product = await getCachedProductBySlug(supabase, params.slug);

    if (!product) {
      return notFound('Product not found');
    }

    // Structured specs (product_attributes) are fetched alongside the
    // images. getProductAttributes is fail-safe — it returns [] when
    // the table is missing, RLS blocks the read, or the product simply
    // has no seeded rows — so a product without specs still renders
    // exactly as before, with only the base Brand/Category/GTIN rows.
    // Option 16/17: repairability + endurance are separate fail-safe
    // reads — they return nulls when migrations 019/020 have not been
    // run yet, so the product still loads and the page shows honest
    // empty states. Option 18: physical attributes are the same
    // pattern (nulls until migration 021 runs). Option 19: recorded
    // overrides are the same pattern (nulls until migration 022 runs).
    // Option 20: global readiness is the same pattern (nulls until
    // migration 023 runs). Section 6: dimensions / model URL /
    // authenticity / supply chain are the same pattern (nulls until
    // migration 033 runs). Section 20, #8: variants ride the same
    // pattern — getProductVariants is fail-safe (returns [] on any
    // failure) and the detail page renders a variant selector ONLY
    // when the array is non-empty. 0 variant rows live today, so
    // the field is [] and nothing new renders — the wiring is the
    // fix, not the data.
    const [images, attributes, variants, repairability, endurance, physical, recorded, globalReadiness, dimensions, modelUrl, authenticity, supplyChain, qualityContexts] =
      await Promise.all([
        getProductImages(supabase, product.id),
        getProductAttributes(supabase, product.id),
        getProductVariants(supabase, product.id),
        getProductRepairability(supabase, product.id),
        getProductEndurance(supabase, product.id),
        getProductPhysical(supabase, product.id),
        getProductRecordedOverrides(supabase, product.id),
        getProductGlobalReadiness(supabase, product.id),
        getProductDimensions(supabase, product.id),
        getProductModelUrl(supabase, product.id),
        getProductAuthenticity(supabase, product.id),
        getProductSupplyChain(supabase, product.id),
        getProductQualityContexts(supabase, [product.id]),
      ]);

    // Dimensions are null (not an all-null object) when nothing is
    // recorded, so consumers can treat null as "no size data".
    const dimensionsOut =
      dimensions.lengthCm === null && dimensions.widthCm === null && dimensions.heightCm === null
        ? null
        : dimensions;

    // Sections 21–25, Stage H (H-P2-3) — the public page no
    // longer shows the field-presence "confidence" count as a
    // percentage. The 7-dimension data-quality score is computed
    // here, server-side, from the product row + the context reads
    // (specs / images / merchants / newest price point); a
    // dimension with no data scores 0 in that dimension, never a
    // guessed value. `merchantSourceMissing` (migration 045
    // unapplied) rides along so the page can say the score may
    // understate instead of showing a bare number (H-P2-4).
    const qualityContext = qualityContexts.contexts.get(product.id) ?? {};
    const dataQuality = {
      ...computeProductQualityScore(product, qualityContext),
      merchantSourceMissing: qualityContexts.merchantSourceMissing,
    };

    return apiSuccess({ ...product, images, attributes, variants, repairability, endurance, physical, recorded, globalReadiness, dimensions: dimensionsOut, modelUrl, authenticity, supplyChain, dataQuality });
  } catch (err) {
    logApiError(err, { request, route: 'products', status: 500 });
    return internalError('Failed to fetch product');
  }
}
