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
    const [images, attributes] = await Promise.all([
      getProductImages(supabase, product.id),
      getProductAttributes(supabase, product.id),
    ]);

    return apiSuccess({ ...product, images, attributes });
  } catch {
    return internalError('Failed to fetch product');
  }
}
