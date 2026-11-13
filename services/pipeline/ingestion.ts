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
import { buildMatchReviewRecord, classifyPipelineDuplicate } from '@/services/matching-review';
import {
  processImagesDetailed,
  getImagePipelineConfig,
  type DetailedProcessedImage,
} from './image-processing';
import {
  insertProductImagesWithVerification,
} from '@/services/product-images';
import { writeProductSpecs, replaceProductSpecs } from '@/services/product-attributes';
import { upsertProductVariants } from './variants';
import { recordIngestionRejection } from '@/services/ingestion-rejections';
import { createAuditLog } from '@/services/audit-logs';
import {
  assessPriceChange,
  insertPriceHistoryRow,
  isDuplicatePricePoint,
  type PriceHistoryPoint,
} from '@/services/price-history-quality';
import { markProductSuccessfullyUpdated } from '@/services/last-successful-update';

/**
 * Sections 21–25, Stage D (R1) — the fetch time behind this
 * ingest. The ONLY live caller (lib/workers/processors.ts,
 * `product.fetch`) passes the moment its provider search
 * returned; that is the real observation time the freshness
 * stamp must carry. When absent, ingestion stamps NOTHING:
 * stamping insert-time would present a re-read / a delayed
 * insert as a fresh live check. Residual caveat (DB, not code):
 * `products.data_freshness` is `NOT NULL DEFAULT now()`
 * (migration 002), so a CREATE without a fetchedAt still gets
 * the DB default — only a migration can change that default.
 * The update path has no such default problem: omitting the
 * column leaves the stored stamp untouched.
 */
export interface IngestOptions {
  /** ISO timestamp of the provider fetch these rows came from. */
  fetchedAt?: string;
}

/** A usable fetchedAt (parseable ISO), or null when unknown/invalid. */
export function resolveIngestFetchedAt(options?: IngestOptions): string | null {
  const raw = options?.fetchedAt;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * Section 20, §12 #16 — the minimum-confidence gate for the
 * pipeline. A score below this is a product with (at most) a name
 * and a price and nothing else worth recording — name-only scores
 * 15, name + price + known availability scores 30, which is the
 * floor: a product must at least be priced and availability-known.
 * Price 0 is rejected on the same gate — no free-price flag exists
 * anywhere, so a $0 product is never recorded.
 *
 * Section 21–25, Stage C (B9) — the gate applies to UPDATES as
 * well as creates. Section 20 deliberately left updates ungated
 * ("an existing product's price update is not an insertion"), but
 * that let a thin feed row overwrite a catalogued product's
 * confidence with a 15 and re-stamp its freshness with nothing
 * behind it. An update that fails the gate is now rejected with
 * the same reasons as a create, and the rejection is persisted
 * (B5) so the admin can see what the feed tried to do.
 */
export const PIPELINE_MIN_CONFIDENCE_SCORE = 30;

/** Reasons a normalized row fails the ingest gate (empty = passes). */
export function ingestGateFailures(normalized: NormalizedProduct): string[] {
  const reasons: string[] = [];
  if (normalized.confidenceScore < PIPELINE_MIN_CONFIDENCE_SCORE) {
    reasons.push(
      `confidence score ${normalized.confidenceScore} is below the minimum ${PIPELINE_MIN_CONFIDENCE_SCORE}`
    );
  }
  if (!(normalized.price > 0)) {
    reasons.push('price must be greater than 0 (no free-price flag exists)');
  }
  return reasons;
}

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
  normalized: NormalizedProduct,
  fetchedAt: string | null = null
): Promise<boolean> {
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
  let latestAvailability: string | null = null;
  try {
    const { data } = await supabase
      .from('price_history')
      .select('price, availability, recorded_at')
      .eq('product_id', productId)
      .eq('retailer_id', retailerId)
      .order('recorded_at', { ascending: false })
      .limit(30);
    const rows = (data ?? []) as Array<{
      price: number | string;
      availability?: string | null;
      recorded_at: string;
    }>;
    latestAvailability = rows.length > 0 ? (rows[0].availability ?? null) : null;
    history = rows
      .map((row) => ({
        price: parseFloat(String(row.price)),
        recordedAt: row.recorded_at,
      }))
      .filter((p) => Number.isFinite(p.price));
  } catch {
    history = [];
  }
  // FINAL 100% (W3, F-P1-32) — change-only insert, the same rule
  // the refresh writer already applies (services/price-refresh.ts
  // :520-545): a re-ingest of an unchanged price is NOT a new
  // observation. Without this check the first live feed re-run
  // re-ingesting an unchanged price inserts a duplicate-price row
  // at a new timestamp. A changed price OR a changed availability
  // still records.
  if (
    isDuplicatePricePoint(
      history.length > 0
        ? { price: history[0].price, availability: latestAvailability }
        : null,
      normalized.price,
      normalized.availability
    )
  ) {
    logger.info('Ingestion: unchanged price, no history row written', {
      productId,
      price: normalized.price,
    });
    return false;
  }
  const nowIso = new Date().toISOString();
  const assessment = assessPriceChange(history, normalized.price, nowIso);
  if (assessment.suspicious) {
    logger.warn('Ingestion: suspicious price change flagged', {
      productId,
      reasons: assessment.reasons,
    });
  }
  // Sections 21–25, Stage D (R1) — `observed_at` is when the
  // provider observed this price (the fetch time), NOT the
  // insert time: `recorded_at` is the insert. Without a fetch
  // time the two coincide, as before.
  const { error } = await insertPriceHistoryRow(supabase, {
    product_id: productId,
    retailer_id: retailerId,
    price: normalized.price,
    currency: normalized.currency,
    availability: normalized.availability,
    url: normalized.url,
    recorded_at: nowIso,
    source: 'merchant-feed',
    observed_at: fetchedAt ?? nowIso,
    suspicious_change: assessment.suspicious,
  });
  if (error) return false;
  // Sections 21–25, Stage D (item 3) — a real provider response
  // was validated and its price point saved: a successful
  // update. Best-effort; the writer never throws.
  try {
    await markProductSuccessfullyUpdated(supabase, productId, fetchedAt ?? nowIso);
  } catch {
    // Freshness bookkeeping must never fail the product.
  }
  return true;
}

async function upsertProductSource(
  supabase: ReturnType<typeof getServiceClient>,
  productId: string,
  retailerId: string,
  normalized: NormalizedProduct,
  providerKey: string,
  fetchedAt: string | null = null
): Promise<void> {
  await supabase
    .from('product_sources')
    .upsert(
      {
        product_id: productId,
        retailer_id: retailerId,
        external_id: normalized.externalId,
        provider_key: providerKey,
        // Sections 21–25, Stage D (R1) — the fetch time, not the
        // insert time, when the caller knows it.
        last_fetched_at: fetchedAt ?? new Date().toISOString(),
        raw: normalized.raw ?? null,
      },
      { onConflict: 'retailer_id,external_id' }
    );
}

/**
 * FINAL 100%, F-P1-39 / F-P1-40 / F-P2-30 — gallery insert via
 * the verification-aware writer (services/product-images.ts).
 * The rich pipeline's per-image verification status is STORED
 * (migration 069 columns when applied, 42703 fallback when not),
 * and alt text is derived honestly from the product name — the
 * old helper hardcoded alt_text: null and threw the verdict away.
 * Existing gallery URLs are skipped (re-ingest safety).
 */
async function insertProductImages(
  supabase: ReturnType<typeof getServiceClient>,
  productId: string,
  productName: string,
  images: DetailedProcessedImage[]
): Promise<void> {
  if (images.length === 0) return;
  const result = await insertProductImagesWithVerification(supabase, productId, {
    images,
    productName,
  });
  if (result.error) {
    logger.warn('Ingestion: gallery images were not stored', {
      productId,
      error: result.error,
    });
  }
  if (result.verificationMissing) {
    logger.debug('Ingestion: gallery images stored without verification status (migration 069 unapplied)', {
      productId,
    });
  }
}

async function logAudit(
  supabase: ReturnType<typeof getServiceClient>,
  action: string,
  productId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  // Section 21–25, Stage J, J-P2-7 — this used to insert into
  // `audit_logs` directly, leaving `createAuditLog` (the one
  // helper for that table) with zero callers. The helper is now
  // the single writer: the `audit_logs` table is kept because the
  // pipeline genuinely audits product creates/updates into it —
  // deleting the table would have destroyed that trail. (Admin
  // actions keep their own trail via `recordAdminAction` /
  // `admin_audit_logs`.)
  await createAuditLog(supabase, null, {
    action,
    resource: 'product',
    resourceId: productId,
    metadata,
  });
}

/** Spec templates are keyed by the leaf category word ('headphones'),
 *  while normalized.category carries the full path
 *  ('Electronics > Headphones') — the template lookup needs the leaf. */
function leafCategory(category: string | null): string | null {
  if (!category) return null;
  const parts = category.split('>').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

async function createNewProduct(
  supabase: ReturnType<typeof getServiceClient>,
  normalized: NormalizedProduct,
  retailerId: string,
  providerKey: string,
  fetchedAt: string | null = null
): Promise<{ id: string; brandCreated: boolean; categoryCreated: boolean }> {
  const slug = await resolveUniqueSlug(supabase, normalized.slug);

  // Category assignment
  const catResult = await assignCategory(supabase, normalized.category);

  // Brand detection
  const brandResult = await detectBrand(supabase, normalized.brand);

  // Image processing — FINAL 100%, F-P1-39 / F-P2-29: the RICH
  // path, behind config (getImagePipelineConfig). Ingestion used
  // to call processImages(images) with no options, so the HEAD
  // accessibility check and the storage upload were never enabled
  // and the per-image verificationStatus was computed then
  // discarded. Now the config decides: accessibility checks and
  // uploads run when the owner enables them; with storage or the
  // allowlist unconfigured the upload reports 'not-configured'
  // and the hotlink is kept — never a fake success.
  const pipelineConfig = getImagePipelineConfig();
  const processedImages = await processImagesDetailed(normalized.images, {
    checkAccessibility: pipelineConfig.checkAccessibility,
    uploadToStorage: pipelineConfig.uploadToStorage,
  });

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
    // Sections 21–25, Stage D (R1) — the freshness stamp is the
    // provider FETCH time, never insert-time. Without a known
    // fetch time the column is omitted (the DB default in
    // migration 002 still stamps now() on create — only a
    // migration can remove that default; the only live caller
    // always passes fetchedAt, so in practice the stamp is
    // always the real fetch time).
    ...(fetchedAt ? { data_freshness: fetchedAt } : {}),
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
  // FINAL 100% (F-P1-45): persist the canonical model number
  // best-effort, in its own update — the column exists only
  // after migration 055 is applied, and a 42703 (or any error)
  // here must never fail the create above.
  if (normalized.modelNumber) {
    try {
      await supabase
        .from('products')
        .update({ model_number: normalized.modelNumber })
        .eq('id', productId);
    } catch {
      // Best-effort only: the match already ran on the normalized value.
    }
  }
  await insertProductImages(supabase, productId, normalized.name, processedImages);
  // Section 21–25, Stage C (B1) — the production spec-write path:
  // specs the feed carried are validated against the category
  // template and written with per-spec attribution
  // (source 'merchant-feed', verified by 'system'). A spec the
  // template does not know is never stored and never guessed —
  // the write reports its errors and the product keeps its
  // honest 0-spec state for that key.
  if (normalized.specs.length > 0) {
    const specWrite = await writeProductSpecs(supabase, {
      productId,
      category: leafCategory(normalized.category),
      entries: normalized.specs,
      attribution: { source: 'merchant-feed', verifiedBy: 'system' },
    });
    if (specWrite.errors.length > 0) {
      logger.warn('Ingestion: feed specs were not stored', {
        productId,
        errors: specWrite.errors,
      });
    }
  }
  // Section 21–25, Stage C (B4) — variants the feed carried are
  // matched/created (SKU → GTIN → attributes). No provider
  // supplies variants today, so this is normally a no-op.
  if (normalized.variants.length > 0) {
    const variantWrite = await upsertProductVariants(supabase, productId, normalized.variants);
    if (variantWrite.errors.length > 0) {
      logger.warn('Ingestion: some feed variants were not stored', {
        productId,
        errors: variantWrite.errors,
      });
    }
  }
  await recordPriceHistory(supabase, productId, retailerId, normalized, fetchedAt);
  await upsertProductSource(supabase, productId, retailerId, normalized, providerKey, fetchedAt);
  await logAudit(supabase, 'product.created', productId, {
    name: normalized.name,
    provider: providerKey,
    brand: normalized.brand,
    category: leafCategory(normalized.category),
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
  matchedBy: DeduplicationResult['matchedBy'],
  fetchedAt: string | null = null,
  /** FINAL 100% (F-P1-12): the match confidence behind this update, for the audit trail. */
  matchConfidence?: number | null
): Promise<{ brandCreated: boolean; categoryCreated: boolean }> {
  // Section 20, §12 #66 — NO floor on the score. The old
  // `Math.max(score, 50)` made every ingested product read "50%"
  // regardless of completeness (audit §1 P0-5); the stored value
  // is now the computed presence count as-is. It is still a
  // completeness count, not a data-quality score — the transparent
  // multi-dimension score lives in services/product-quality-score.ts
  // and is computed on read.
  // Sections 21–25, Stage D (R1) — the freshness stamp moves
  // ONLY when the fetch time is known. An update without a
  // fetchedAt leaves the stored stamp untouched: stamping
  // now() here used to present every re-ingest as a fresh live
  // check.
  const updateData: Record<string, unknown> = {
    ...(fetchedAt ? { data_freshness: fetchedAt } : {}),
    confidence_score: normalized.confidenceScore,
    next_refresh_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    refresh_status: 'idle',
  };

  let brandCreated = false;
  let categoryCreated = false;
  let brandReviewRequired = false;
  let brandReviewReason: string | undefined;

  if (normalized.brand) {
    const brandResult = await detectBrand(supabase, normalized.brand);
    if (brandResult.brandId) updateData.brand_id = brandResult.brandId;
    // Section 18, item 23: keep the text column in step with the
    // FK id, from the resolved brand row.
    if (brandResult.name) updateData.brand = brandResult.name;
    brandCreated = brandResult.created;
    // FINAL 100% (F-P1-44): a fuzzy brand fold is flagged for
    // review — it travels into the audit log below, never silently.
    brandReviewRequired = brandResult.reviewRequired === true;
    brandReviewReason = brandResult.reviewReason;
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
  // FINAL 100% (F-P1-45): persist the canonical model number
  // best-effort, in its own update — the column exists only
  // after migration 055 is applied, and a 42703 (or any error)
  // here must never fail the product update above. A missing
  // model stays an honest null.
  if (normalized.modelNumber) {
    try {
      await supabase
        .from('products')
        .update({ model_number: normalized.modelNumber })
        .eq('id', productId);
    } catch {
      // Best-effort only: the match already ran on the normalized value.
    }
  }
  // FINAL 100%, F-P1-39 — the update path exercises the same
  // rich image path as creates (config-gated), and new gallery
  // URLs land via the verification-aware writer (existing URLs
  // are skipped, so re-ingest never duplicates the gallery).
  // The product's image_url is still only replaced when the
  // feed carries one (below) — a gallery row is never promoted
  // to the hero image on its own.
  if (normalized.images.length > 0) {
    const pipelineConfig = getImagePipelineConfig();
    const processedImages = await processImagesDetailed(normalized.images, {
      checkAccessibility: pipelineConfig.checkAccessibility,
      uploadToStorage: pipelineConfig.uploadToStorage,
    });
    const productName = normalized.name;
    await insertProductImages(supabase, productId, productName, processedImages);
  }
  // Section 21–25, Stage C (B1/B4) — an update carries the specs
  // and variants the feed supplied for the keys it touches: specs
  // replace-by-key (other stored specs are left alone), variants
  // match-or-create. Invalid entries are reported, never stored.
  if (normalized.specs.length > 0) {
    const specWrite = await replaceProductSpecs(supabase, {
      productId,
      category: leafCategory(normalized.category),
      entries: normalized.specs,
      attribution: { source: 'merchant-feed', verifiedBy: 'system' },
    });
    if (specWrite.errors.length > 0) {
      logger.warn('Ingestion: feed specs were not stored on update', {
        productId,
        errors: specWrite.errors,
      });
    }
  }
  if (normalized.variants.length > 0) {
    const variantWrite = await upsertProductVariants(supabase, productId, normalized.variants);
    if (variantWrite.errors.length > 0) {
      logger.warn('Ingestion: some feed variants were not stored on update', {
        productId,
        errors: variantWrite.errors,
      });
    }
  }
  await recordPriceHistory(supabase, productId, retailerId, normalized, fetchedAt);
  await upsertProductSource(supabase, productId, retailerId, normalized, providerKey, fetchedAt);
  // FINAL 100% (F-P1-12/F-P1-44): the audit trail records WHAT
  // matched this update and how confidently — plus whether the
  // brand fold needs review. Confidence lives in the audit
  // metadata until the match_confidence columns exist.
  await logAudit(supabase, 'product.updated', productId, {
    provider: providerKey,
    matchedBy,
    ...(matchConfidence !== undefined && matchConfidence !== null
      ? { matchConfidence }
      : {}),
    ...(brandReviewRequired
      ? { brandReviewRequired: true, brandReviewReason }
      : {}),
  });

  return { brandCreated, categoryCreated };
}

export async function ingestProduct(
  raw: RawProductData,
  providerKey: string,
  options?: IngestOptions
): Promise<IngestionResult> {
  // Sections 21–25, Stage D (R1) — the fetch time, when the
  // caller knows it (the product.fetch processor passes the
  // moment its provider search returned).
  const fetchedAt = resolveIngestFetchedAt(options);
  // 1. Validate
  const validation = validateRawProduct(raw);
  if (!validation.success) {
    logger.warn('Ingestion: validation failed', { errors: validation.errors });
    // No rejection record here by design: validation runs before
    // any database client exists ("rejects invalid input before
    // touching the database"), and the errors are returned inline
    // to the caller in full. Post-validation rejections below ARE
    // persisted (B5).
    return {
      success: false,
      action: 'rejected',
      errors: Object.entries(validation.errors).map(([k, v]) => `${k}: ${v.join(', ')}`),
    };
  }

  // 2. Normalize
  const normalized = normalizeProduct(validation.data);
  const supabase = getServiceClient();

  // Section 21–25, Stage C (B5) — persist a pipeline rejection
  // (row + reason + timestamp) so the admin can review it at
  // /admin/ingestion-failures. Best-effort: a store failure never
  // changes the rejection itself.
  const persistRejection = async (reason: string): Promise<void> => {
    await recordIngestionRejection(supabase, {
      source: 'pipeline',
      rowNumber: null,
      productName: normalized.name,
      row: {
        name: normalized.name,
        slug: normalized.slug,
        brand: normalized.brand,
        category: normalized.category,
        price: normalized.price,
        currency: normalized.currency,
        merchant: normalized.retailerSlug,
        gtin: normalized.gtin,
      },
      reason,
    });
  };

  try {
    // 3. Get retailer
    const retailerId = await getRetailerId(supabase, normalized.retailerSlug);
    if (!retailerId) {
      const reason = `Unknown retailer: ${normalized.retailerSlug}`;
      await persistRejection(reason);
      return {
        success: false,
        action: 'rejected',
        errors: [reason],
      };
    }

    // 4. Deduplication
    const dedup = await findDuplicate(supabase, normalized);

    // FINAL 100% (F-P1-42, F-P2-42): the review gate. A failed
    // dedupe check FAILS CLOSED — the ingest is held, never
    // admitted as "no match". A fuzzy or model-conflicting match
    // is HELD FOR REVIEW — the existing product is NOT updated,
    // its GTIN/image/description are NOT overwritten, and the
    // hold is persisted as an ingestion rejection (the durable
    // review trail until a review-queue table exists) with the
    // match record in the rejection reason.
    if (dedup.dedupeError) {
      const reason = `Duplicate check failed, ingest held (fail-closed): ${dedup.dedupeError}`;
      logger.warn('Ingestion: dedupe check failed, holding ingest', { error: dedup.dedupeError });
      await persistRejection(reason);
      return { success: false, action: 'rejected', errors: [reason] };
    }

    if (dedup.isDuplicate && dedup.existingProductId) {
      const decision = classifyPipelineDuplicate({
        isDuplicate: dedup.isDuplicate,
        matchedBy: dedup.matchedBy,
        confidence: dedup.confidence ?? null,
        incomingModel: normalized.modelNumber ?? null,
        existingModel: dedup.existingModelNumber ?? null,
      });
      if (decision.action === 'hold-for-review') {
        const review = buildMatchReviewRecord('pipeline-duplicate', {
          productName: normalized.name,
          existingProductId: dedup.existingProductId,
          matchedBy: dedup.matchedBy,
          confidence: dedup.confidence ?? null,
          reasons: decision.reasons,
        });
        const reason =
          `Match held for manual review — no auto-merge: ${decision.reasons.join(' ')} ` +
          `(existing product ${dedup.existingProductId}, matched by ${dedup.matchedBy ?? 'unknown'}, ` +
          `confidence ${dedup.confidence ?? 'unknown'}). Review record: ${JSON.stringify(review)}`;
        logger.warn('Ingestion: uncertain duplicate held for review', {
          id: dedup.existingProductId,
          matchedBy: dedup.matchedBy,
        });
        await persistRejection(reason);
        return { success: false, action: 'rejected', errors: [reason] };
      }
      // 5. Update existing — Section 21–25, Stage C (B9): the
      // update path is gated with the same confidence + price>0
      // checks as creates. A thin feed row no longer overwrites
      // a catalogued product's confidence and freshness.
      const updateGateFailures = ingestGateFailures(normalized);
      if (updateGateFailures.length > 0) {
        const reasons = updateGateFailures;
        logger.warn('Ingestion: confidence gate rejected product update', {
          id: dedup.existingProductId,
          reasons,
        });
        await persistRejection(
          `Update gate: ${reasons.join('; ')} (existing product ${dedup.existingProductId}, matched by ${dedup.matchedBy ?? 'unknown'})`
        );
        return {
          success: false,
          action: 'rejected',
          errors: reasons.map((r) => `Ingest gate: ${r}`),
        };
      }
      const { brandCreated, categoryCreated } = await updateExistingProduct(
        supabase,
        dedup.existingProductId,
        normalized,
        retailerId,
        providerKey,
        dedup.matchedBy,
        fetchedAt,
        dedup.confidence ?? null
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
    // now rejected before any write.
    const createGateFailures = ingestGateFailures(normalized);
    if (createGateFailures.length > 0) {
      const reasons = createGateFailures;
      logger.warn('Ingestion: confidence gate rejected new product', {
        name: normalized.name,
        reasons,
      });
      await persistRejection(`Create gate: ${reasons.join('; ')}`);
      return {
        success: false,
        action: 'rejected',
        errors: reasons.map((r) => `Ingest gate: ${r}`),
      };
    }
    const result = await createNewProduct(supabase, normalized, retailerId, providerKey, fetchedAt);
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
    await persistRejection(`Ingestion failed: ${message}`);
    return { success: false, action: 'rejected', errors: [message] };
  }
}

export async function ingestBatch(
  raws: RawProductData[],
  providerKey: string,
  options?: IngestOptions
): Promise<IngestionResult[]> {
  return Promise.all(raws.map((r) => ingestProduct(r, providerKey, options)));
}
