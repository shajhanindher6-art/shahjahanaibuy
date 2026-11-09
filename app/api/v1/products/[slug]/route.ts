/**
 * API v1 product detail endpoint.
 * GET /api/v1/products/[slug] — fetch a single product by slug with its images.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import {
  getCachedProductBySlug,
  getProductImages,
  getProductAttributes,
} from '@/services/products';
import { getProductRepairability } from '@/services/repairability';
import { getProductEndurance } from '@/services/hardware-endurance';
import { getProductPhysical } from '@/services/physical-attributes';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.detail', slug: params.slug });

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
    // pattern (nulls until migration 021 runs).
    const [images, attributes, repairability, endurance, physical] = await Promise.all([
      getProductImages(supabase, product.id),
      getProductAttributes(supabase, product.id),
      getProductRepairability(supabase, product.id),
      getProductEndurance(supabase, product.id),
      getProductPhysical(supabase, product.id),
    ]);

    return apiSuccess({ ...product, images, attributes, repairability, endurance, physical });
  } catch {
    return internalError('Failed to fetch product');
  }
}
