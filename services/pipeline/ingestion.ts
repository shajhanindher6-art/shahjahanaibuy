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
import {
  assessPriceChange,
  insertPriceHistoryRow,
  type PriceHistoryPoint,
} from '@/services/price-history-quality';

/**
 * Section 20, §12 #16 — the minimum-confidence gate for
 * CREATING a product through the pipeline. A score below this
 * is a product with (at most) a name and a price and nothing
 * else worth recording — name-only scores 15, name + price +
 * known availability scores 30, which is the floor: a new
 * product must at least be priced and availability-known. The
 * gate applies to CREATES only: updating an already-catalogued
 * product (matched by GTIN/slug) is not an insertion, and the
 * refresh/update path must not be blocked because the incoming
 * feed row is thin. Price 0 is rejected on the same gate — no
 * free-price flag exists anywhere, so a $0 product is never
 * created (a price-0 UPDATE to an existing product is left to
 * the update path, as before).
 */
export const PIPELINE_MIN_CONFIDENCE_SCORE = 30;

/** PostgREST/Postgres code for "column does not exist". */
function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

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
  // Section 20, §12 #39/#42/#44 — assess the new point against
  // the retailer's recorded history BEFORE inserting, and store
  // the flag + provenance with the row. The history read is
  // best-effort: a failed read assesses against an empty history
  // (no spike can be computed) rather than failing the insert.
  // Source is 'merchant-feed': the point arrived through a
  // provider fetch, not typed in by an admin. The insert itself
  // retries without the migration-057 columns when they do not
  // exist yet (42703, inside insertPriceHistoryRow).
  let history: PriceHistoryPoint[] = [];
  try {
    const { data } = await supabase
      .from('price_history')
      .select('price, recorded_at')
      .eq('product_id', productId)
      .eq('retailer_id', retailerId)
      .order('recorded_at', { ascending: false })
      .limit(30);
    history = ((data ?? []) as Array<{ price: number | string; recorded_at: string }>)
      .map((row) => ({
        price: parseFloat(String(row.price)),
        recordedAt: row.recorded_at,
      }))
      .filter((p) => Number.isFinite(p.price));
  } catch {
    history = [];
  }
  const nowIso = new Date().toISOString();
  const assessment = assessPriceChange(history, normalized.price, nowIso);
  if (assessment.suspicious) {
    logger.warn('Ingestion: suspicious price change flagged', {
      productId,
      reasons: assessment.reasons,
    });
  }
  await insertPriceHistoryRow(supabase, {
    product_id: productId,
    retailer_id: retailerId,
    price: normalized.price,
    currency: normalized.currency,
    availability: normalized.availability,
    url: normalized.url,
    recorded_at: nowIso,
    source: 'merchant-feed',
    observed_at: nowIso,
    suspicious_change: assessment.suspicious,
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

  // Section 20, §12 #26 — born-pending per the migration 045
  // design (the same shape as the intake approve path): a
  // pipeline-created product is never public merely because it
  // was inserted, and its price is 'unverified' until a real
  // fetch checks it. Until 045 is applied the columns do not
  // exist: the insert retries without them (42703) and the row
  // is public as before — ingestion never fails over an
  // unapplied migration.
  const productBase = {
    name: normalized.name,
    slug,
    description: normalized.description,
    // Section 18, item 23: write BOTH representations. The FK
    // ids alone left the product invisible to the text-based
    // brand/category reads (services/products.ts filters on the
    // text columns); the text values come from the resolved
    // brand/category rows, never invented. When resolution
    // failed (null id) the text stays null, as before.
    brand: brandResult.name ?? null,
    brand_id: brandResult.brandId,
    category: catResult.name ?? null,
    category_id: catResult.categoryId,
    image_url: processedImages[0]?.url ?? normalized.imageUrl,
    gtin: normalized.gtin,
    confidence_score: normalized.confidenceScore,
    data_freshness: new Date().toISOString(),
    next_refresh_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    refresh_status: 'idle',
    refresh_priority: 3,
  };
  const productWithStatus = {
    ...productBase,
    status: 'pending',
    price_verification_status: 'unverified',
  };

  let { data, error } = await supabase
    .from('products')
    .insert(productWithStatus)
    .select('id')
    .single();

  if (error && isUndefinedColumnError(error)) {
    ({ data, error } = await supabase
      .from('products')
      .insert(productBase)
      .select('id')
      .single());
  }

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
  // Section 20, §12 #66 — NO floor on the score. The old
  // `Math.max(score, 50)` made every ingested product read "50%"
  // regardless of completeness (audit §1 P0-5); the stored value
  // is now the computed presence count as-is. It is still a
  // completeness count, not a data-quality score — the transparent
  // multi-dimension score lives in services/product-quality-score.ts
  // and is computed on read.
  const updateData: Record<string, unknown> = {
    data_freshness: new Date().toISOString(),
    confidence_score: normalized.confidenceScore,
    next_refresh_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    refresh_status: 'idle',
  };

  let brandCreated = false;
  let categoryCreated = false;

  if (normalized.brand) {
    const brandResult = await detectBrand(supabase, normalized.brand);
    if (brandResult.brandId) updateData.brand_id = brandResult.brandId;
    // Section 18, item 23: keep the text column in step with the
    // FK id, from the resolved brand row.
    if (brandResult.name) updateData.brand = brandResult.name;
    brandCreated = brandResult.created;
  }

  if (normalized.category) {
    const catResult = await assignCategory(supabase, normalized.category);
    if (catResult.categoryId) updateData.category_id = catResult.categoryId;
    // Section 18, item 23: keep the text column in step with the
    // FK id, from the resolved category row.
    if (catResult.name) updateData.category = catResult.name;
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

    // 6. Create new — Section 20, §12 #16/#26: the ingest gate.
    // A new product must clear the minimum confidence bar AND
    // carry a real price (> 0). A thin feed row (name only,
    // price 0) used to be inserted as a published product; it is
    // now rejected before any write. The UPDATE branch above is
    // deliberately ungated — an existing product's price update
    // is not an insertion.
    if (
      normalized.confidenceScore < PIPELINE_MIN_CONFIDENCE_SCORE ||
      !(normalized.price > 0)
    ) {
      const reasons: string[] = [];
      if (normalized.confidenceScore < PIPELINE_MIN_CONFIDENCE_SCORE) {
        reasons.push(
          `confidence score ${normalized.confidenceScore} is below the minimum ${PIPELINE_MIN_CONFIDENCE_SCORE}`
        );
      }
      if (!(normalized.price > 0)) {
        reasons.push('price must be greater than 0 (no free-price flag exists)');
      }
      logger.warn('Ingestion: confidence gate rejected new product', {
        name: normalized.name,
        reasons,
      });
      return {
        success: false,
        action: 'rejected',
        errors: reasons.map((r) => `Ingest gate: ${r}`),
      };
    }
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
