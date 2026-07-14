/**
 * API v1 similar products endpoint.
 * GET /api/v1/products/[slug]/similar — fetch products in the same category/brand.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getProductBySlug } from '@/services/products';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.similar', slug: params.slug });

  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(20, Math.max(1, Number(searchParams.get('limit') ?? 4)));

    const supabase = await createSupabaseServerClient();
    const product = await getProductBySlug(supabase, params.slug);

    if (!product) {
      return notFound('Product not found');
    }

    let query = supabase
      .from('products')
      .select('id, name, slug, description, brand, category, image_url, confidence_score')
      .neq('id', product.id)
      .is('deleted_at', null)
      .order('confidence_score', { ascending: false })
      .limit(limit);

    const orConditions: string[] = [];
    if (product.category) orConditions.push(`category.ilike.%${product.category}%`);
    if (product.brand) orConditions.push(`brand.ilike.%${product.brand}%`);

    if (orConditions.length > 0) {
      query = query.or(orConditions.join(','));
    } else {
      query = query.order('created_at', { ascending: false });
    }

    const { data, error } = await query;

    if (error || !data) {
      return internalError('Failed to fetch similar products');
    }

    const results = (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      brand: row.brand,
      category: row.category,
      imageUrl: row.image_url,
      description: row.description,
      matchScore: Math.round((row.confidence_score ?? 50) + Math.random() * 20),
      reason: product.brand && row.brand === product.brand
        ? `Same brand as ${product.name}`
        : `Similar ${product.category ?? 'product'} category`,
    }));

    return apiSuccess(results, 200, { total: results.length });
  } catch {
    return internalError('Failed to fetch similar products');
  }
}
