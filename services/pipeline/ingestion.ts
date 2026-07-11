/**
 * Ingestion service — the core data pipeline orchestrator.
 *
 * Full enterprise pipeline flow:
 * 1. Validation (Zod schema)
 * 2. Normalization (provider → internal model)
 * 3. Deduplication (GTIN → slug)
 * 4. Category Assignment (match/create categories)
 * 5. Brand Detection (match/create brands)
 * 6. Image Processing (deduplicate, validate)
 * 7. Product Insert/Update
 * 8. Price History Recording
 * 9. Audit Logging
 *
 * All database writes use the service role client (bypasses RLS).
 */

import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/config/logger';
import type { RawProductData } from '@/services/providers/types';
import { validateRawProduct } from './validation';
import { normalizeProduct, type NormalizedProduct } from './normalization';
import { findDuplicate, resolveUniqueSlug, type DeduplicationResult } from './deduplication';
import { assignCategory } from './category-assignment';
import { detectBrand } from './brand-detection';
import { processImages } from './image-processing';

export interface IngestionResult {
  success: boolean;
  productId?: string;
  action: 'created' | 'updated' | 'rejected';
  errors?: string[];
  metadata?: {
    brandCreated?: boolean;
    categoryCreated?: boolean;
    matchedBy?: string;
  };
}

function getServiceClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey ?? env.supabaseAnonKey, {
    auth: { persistSession: false },
  });
}

async function getRetailerId(
  supabase: ReturnType<typeof getServiceClient>,
  slug: string
): Promise<string | null> {
  const { data } = await supabase
    .from('retailers')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  return data?.id ?? null;
}

async function recordPriceHistory(
  supabase: ReturnType<typeof getServiceClient>,
  productId: string,
  retailerId: string,
  normalized: NormalizedProduct
): Promise<void> {
  await supabase.from('price_history').insert({
    product_id: productId,
    retailer_id: retailerId,
    price: normalized.price,
    currency: normalized.currency,
    availability: normalized.availability,
    url: normalized.url,
    recorded_at: new Date().toISOString(),
  });
}

async function upsertProductSource(
  supabase: ReturnType<typeof getServiceClient>,
  productId: string,
  retailerId: string,
  normalized: NormalizedProduct,
  providerKey: string
): Promise<void> {
  await supabase
    .from('product_sources')
    .upsert(
      {
        product_id: productId,
        retailer_id: retailerId,
        external_id: normalized.externalId,
        provider_key: providerKey,
        last_fetched_at: new Date().toISOString(),
        raw: normalized.raw ?? null,
      },
      { onConflict: 'retailer_id,external_id' }
    );
}

async function insertProductImages(
  supabase: ReturnType<typeof getServiceClient>,
  productId: string,
  images: { url: string; isPrimary: boolean }[]
): Promise<void> {
  if (images.length === 0) return;
  const rows = images.map((img, i) => ({
    product_id: productId,
    url: img.url,
    alt_text: null,
    is_primary: img.isPrimary,
    sort_order: i,
  }));
  await supabase.from('product_images').insert(rows);
}

async function logAudit(
  supabase: ReturnType<typeof getServiceClient>,
  action: string,
  productId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await supabase.from('audit_logs').insert({
    user_id: null,
    action,
    resource: 'product',
    resource_id: productId,
    metadata,
  });
}

async function createNewProduct(
  supabase: ReturnType<typeof getServiceClient>,
  normalized: NormalizedProduct,
  retailerId: string,
  providerKey: string
): Promise<{ id: string; brandCreated: boolean; categoryCreated: boolean }> {
  const slug = await resolveUniqueSlug(supabase, normalized.slug);

  // Category assignment
  const catResult = await assignCategory(supabase, normalized.category);

  // Brand detection
  const brandResult = await detectBrand(supabase, normalized.brand);

  // Image processing
  const processedImages = await processImages(normalized.images);

  const { data, error } = await supabase
    .from('products')
    .insert({
      name: normalized.name,
      slug,
      description: normalized.description,
      brand_id: brandResult.brandId,
      category_id: catResult.categoryId,
      image_url: processedImages[0]?.url ?? normalized.imageUrl,
      gtin: normalized.gtin,
      confidence_score: normalized.confidenceScore,
      data_freshness: new Date().toISOString(),
      next_refresh_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      refresh_status: 'idle',
      refresh_priority: 3,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert product: ${error?.message ?? 'unknown'}`);
  }

  const productId = data.id;
  await insertProductImages(supabase, productId, processedImages);
  await recordPriceHistory(supabase, productId, retailerId, normalized);
  await upsertProductSource(supabase, productId, retailerId, normalized, providerKey);
  await logAudit(supabase, 'product.created', productId, {
    name: normalized.name,
    provider: providerKey,
    brand: normalized.brand,
    category: normalized.category,
  });

  return {
    id: productId,
    brandCreated: brandResult.created,
    categoryCreated: catResult.created,
  };
}

async function updateExistingProduct(
  supabase: ReturnType<typeof getServiceClient>,
  productId: string,
  normalized: NormalizedProduct,
  retailerId: string,
  providerKey: string,
  matchedBy: DeduplicationResult['matchedBy']
): Promise<{ brandCreated: boolean; categoryCreated: boolean }> {
  const updateData: Record<string, unknown> = {
    data_freshness: new Date().toISOString(),
    confidence_score: Math.max(normalized.confidenceScore, 50),
    next_refresh_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    refresh_status: 'idle',
  };

  let brandCreated = false;
  let categoryCreated = false;

  if (normalized.brand) {
    const brandResult = await detectBrand(supabase, normalized.brand);
    if (brandResult.brandId) updateData.brand_id = brandResult.brandId;
    brandCreated = brandResult.created;
  }

  if (normalized.category) {
    const catResult = await assignCategory(supabase, normalized.category);
    if (catResult.categoryId) updateData.category_id = catResult.categoryId;
    categoryCreated = catResult.created;
  }

  if (normalized.description) updateData.description = normalized.description;
  if (normalized.imageUrl) updateData.image_url = normalized.imageUrl;
  if (normalized.gtin) updateData.gtin = normalized.gtin;

  await supabase.from('products').update(updateData).eq('id', productId);
  await recordPriceHistory(supabase, productId, retailerId, normalized);
  await upsertProductSource(supabase, productId, retailerId, normalized, providerKey);
  await logAudit(supabase, 'product.updated', productId, {
    provider: providerKey,
    matchedBy,
  });

  return { brandCreated, categoryCreated };
}

export async function ingestProduct(
  raw: RawProductData,
  providerKey: string
): Promise<IngestionResult> {
  // 1. Validate
  const validation = validateRawProduct(raw);
  if (!validation.success) {
    logger.warn('Ingestion: validation failed', { errors: validation.errors });
    return {
      success: false,
      action: 'rejected',
      errors: Object.entries(validation.errors).map(([k, v]) => `${k}: ${v.join(', ')}`),
    };
  }

  // 2. Normalize
  const normalized = normalizeProduct(validation.data);
  const supabase = getServiceClient();

  try {
    // 3. Get retailer
    const retailerId = await getRetailerId(supabase, normalized.retailerSlug);
    if (!retailerId) {
      return {
        success: false,
        action: 'rejected',
        errors: [`Unknown retailer: ${normalized.retailerSlug}`],
      };
    }

    // 4. Deduplication
    const dedup = await findDuplicate(supabase, normalized);

    if (dedup.isDuplicate && dedup.existingProductId) {
      // 5. Update existing
      const { brandCreated, categoryCreated } = await updateExistingProduct(
        supabase,
        dedup.existingProductId,
        normalized,
        retailerId,
        providerKey,
        dedup.matchedBy
      );
      logger.info('Ingestion: updated existing product', {
        id: dedup.existingProductId,
        matchedBy: dedup.matchedBy,
      });
      return {
        success: true,
        productId: dedup.existingProductId,
        action: 'updated',
        metadata: { brandCreated, categoryCreated, matchedBy: dedup.matchedBy ?? undefined },
      };
    }

    // 6. Create new
    const result = await createNewProduct(supabase, normalized, retailerId, providerKey);
    logger.info('Ingestion: created new product', { id: result.id });
    return {
      success: true,
      productId: result.id,
      action: 'created',
      metadata: { brandCreated: result.brandCreated, categoryCreated: result.categoryCreated },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    logger.error('Ingestion: failed', { error: message });
    return { success: false, action: 'rejected', errors: [message] };
  }
}

export async function ingestBatch(
  raws: RawProductData[],
  providerKey: string
): Promise<IngestionResult[]> {
  return Promise.all(raws.map((r) => ingestProduct(r, providerKey)));
}
