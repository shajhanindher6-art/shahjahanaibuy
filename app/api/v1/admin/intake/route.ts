/**
 * Section 9 — Catalog intake API (admin only).
 * POST /api/v1/admin/intake
 *
 * Two actions, one route:
 *  - preview: parse + validate a CSV (multipart file upload `file`, or
 *    JSON `{ csv }`). Returns the per-row review (valid / error /
 *    duplicate / near-duplicate). INSERTS NOTHING.
 *  - approve: JSON `{ rows, includeRowNumbers }` — the raw rows from a
 *    preview plus the CSV line numbers of near-duplicate rows the admin
 *    explicitly chose to include. Re-validates everything against the
 *    live catalog, then inserts only the valid rows (products +
 *    merchant_products) and records the batch in admin_audit_logs with
 *    `source: 'manual-intake'`. Section 15, P3-2: the eBay preview
 *    flow reuses this approve step and passes
 *    `source: 'ebay-browse-api'` instead — the audit log then
 *    records the eBay origin (plus per-row ebay_item_id, itemWebUrl
 *    and fetched_at from the preview), and the inserted products
 *    get `data_freshness` stamped at approve time so the "Live eBay
 *    asking price, checked <timestamp>" label is grounded. The
 *    default stays 'manual-intake'; any other source value is
 *    rejected.
 *
 * Prices entered here are MANUAL prices — typed in by an admin, never
 * fetched live and never presented as live prices. `products` /
 * `merchant_products` have no `source` column in the schema (none is
 * invented); provenance lives in the audit-log details JSONB.
 *
 * Section 17, Stage C items 14–15 (migration 045, unapplied):
 * approve inserts each product as `status: 'pending'` with its
 * price-verification stamp (manual → 'unverified'; eBay Browse →
 * 'verified' with verified_at = approve time) and flips it to
 * 'published' only after the merchant listing is in — a row is
 * never public because it was merely inserted. The public query
 * path (services/products.ts) lists published rows only. Until
 * migration 045 is applied, the inserts retry without the new
 * columns (Postgres 42703) and the row is public as before —
 * the approve never 500s over an unapplied migration.
 *
 * Admin-only (migration 017: catalog writes are admin-only at the RLS
 * level too). Writes go through the service-role client after
 * requireAdmin; the session client is never used for writes.
 */

import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/config/logger';
import {
  apiSuccess,
  badRequest,
  internalError,
  validationError,
} from '@/lib/api/responses';
import {
  logApiRequest,
  requireAdmin,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { checkCsrfOrigin } from '@/lib/api/csrf';
import { validateBody } from '@/lib/api/validation';
import { z } from 'zod';
import { logApiError } from '@/lib/api/error-logging';
import { invalidateProductCaches } from '@/lib/cache';
import {
  INTAKE_SOURCE,
  parseIntakeCsv,
  reviewIntakeRows,
  planIntakeInsert,
  intakeNameBrandKey,
  normalizeIntakeKey,
  normalizeGtin,
  type IntakeCatalogContext,
  type IntakeRowInput,
  type IntakeReviewedRow,
} from '@/services/catalog-intake';
import { EBAY_INTAKE_SOURCE } from '@/services/ebay-intake';
import { priceVerificationForIntakeSource } from '@/services/price-verification';
import { recordAdminAction } from '@/services/admin';

export const dynamic = 'force-dynamic';

const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MB — intake files are small by design
const MAX_ROWS = 1000;

/**
 * Section 18, Phase 2, item 10 (audit §1 #13) — intake JSON body
 * validated with the shared `validateBody` helper (Zod). Only the
 * envelope is validated here: `action` must be preview/approve,
 * `source` (when present) one of the two known sources, `csv` a
 * string within the size cap, `includeRowNumbers` an array of
 * numbers, and `rows` an array of row objects. The rows themselves
 * are deliberately NOT strictly typed: the approve step re-validates
 * each raw row against the live catalog and reports per-row errors
 * (`reviewIntakeRows`) — a malformed row must be a review error,
 * not a whole-batch 400. The multipart preview path has no JSON
 * body and is untouched.
 */
const intakeRowSchema = z.record(z.string(), z.unknown());
const intakeJsonBodySchema = z.object({
  action: z.enum(['preview', 'approve']),
  csv: z.string().max(MAX_CSV_BYTES).optional(),
  source: z.enum([INTAKE_SOURCE, EBAY_INTAKE_SOURCE]).optional(),
  rows: z.array(intakeRowSchema).max(MAX_ROWS).optional(),
  includeRowNumbers: z.array(z.number()).optional(),
});

/**
 * Loads the live catalog context used for validation: existing product
 * slugs + name/brand keys, merchants by normalized slug/name, and
 * currencies by code. Read-only. Exported for the eBay preview route
 * (Section 15, P3-2), which validates eBay listings against the same
 * live catalog instead of duplicating the loader.
 */
export async function loadCatalogContext(
  service: SupabaseClient,
): Promise<IntakeCatalogContext> {
  const [productsRes, merchantsRes, currenciesRes] = await Promise.all([
    service.from('products').select('slug, name, brand, gtin').limit(5000),
    service.from('merchants').select('id, slug, name'),
    service.from('currencies').select('id, code'),
  ]);

  const existingSlugs = new Set<string>();
  const existingNameBrands = new Map<string, string>();
  // Section 20, #9: normalized GTIN -> slug, for the same-GTIN /
  // different-slug leg in reviewIntakeRows.
  const existingGtins = new Map<string, string>();
  for (const p of (productsRes.data ?? []) as Array<{
    slug: string;
    name: string | null;
    brand: string | null;
    gtin: string | null;
  }>) {
    existingSlugs.add(p.slug.toLowerCase());
    if (p.name && p.brand) {
      existingNameBrands.set(intakeNameBrandKey(p.name, p.brand), p.slug);
    }
    if (p.gtin) {
      const key = normalizeGtin(p.gtin);
      if (key && !existingGtins.has(key)) existingGtins.set(key, p.slug);
    }
  }

  const knownMerchants = new Map<string, string>();
  for (const m of (merchantsRes.data ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
  }>) {
    knownMerchants.set(normalizeIntakeKey(m.slug), m.id);
    knownMerchants.set(normalizeIntakeKey(m.name), m.id);
  }

  const knownCurrencies = new Map<string, string>();
  for (const c of (currenciesRes.data ?? []) as Array<{ id: string; code: string }>) {
    knownCurrencies.set(c.code.trim().toUpperCase(), c.id);
  }

  return { existingSlugs, existingNameBrands, existingGtins, knownMerchants, knownCurrencies };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Section 17, Stage C items 14–15 — Postgres 42703
 * ("column does not exist"): migration 045 unapplied. Callers
 * retry the write without the new columns instead of failing
 * the approve.
 */
function isUndefinedColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703';
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  logApiRequest(request, { endpoint: 'admin.intake' });
  const limited = await rateLimitResponse(
    `admin.intake:${getClientIp(request)}`,
    30,
  );
  if (limited) return limited;

  // Section 18, Phase 2, item 8 — CSRF Origin check (cookie-authed
  // mutation; absent Origin fails open for non-browser clients).
  const csrf = checkCsrfOrigin(request);
  if (csrf) return csrf;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Catalog intake unavailable: service client not configured');
  }

  const contentType = request.headers.get('content-type') ?? '';
  let action: string | undefined;
  let csv: string | undefined;
  let rows: IntakeRowInput[] | undefined;
  let includeRowNumbers: number[] = [];
  // Section 15, P3-2: optional provenance source for the approve
  // step. Defaults to 'manual-intake'; the eBay preview flow
  // passes 'ebay-browse-api'. Any other value is rejected below.
  let source: string = INTAKE_SOURCE;

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      action = 'preview';
      const file = form.get('file');
      if (!(file instanceof File)) {
        return badRequest('Upload a CSV file in the "file" field');
      }
      if (file.size > MAX_CSV_BYTES) {
        return badRequest('CSV file is too large (max 2 MB)');
      }
      csv = await file.text();
    } else {
      const body: unknown = await request.json().catch(() => null);
      if (!isRecord(body)) {
        return badRequest('Expected a JSON body with an "action" field');
      }
      // Section 18, Phase 2, item 10 — Zod envelope validation.
      // Per-row validation still happens in reviewIntakeRows
      // below; this only rejects a malformed envelope (bad
      // action/source, non-array rows) with a 400.
      const validation = validateBody(intakeJsonBodySchema, body);
      if (!validation.success) {
        const firstError = Object.values(validation.errors).flat()[0];
        return badRequest(firstError ?? 'Invalid request body');
      }
      action = validation.data.action;
      if (typeof validation.data.csv === 'string') csv = validation.data.csv;
      if (validation.data.source) {
        source = validation.data.source;
      }
      if (validation.data.rows) {
        rows = validation.data.rows as unknown as IntakeRowInput[];
      }
      if (validation.data.includeRowNumbers) {
        includeRowNumbers = validation.data.includeRowNumbers.filter(
          (n): n is number => typeof n === 'number',
        );
      }
    }
  } catch (err) {
    // Section 18, Phase 0: previously silent — log + Sentry-capture.
    logApiError(err, {
      request,
      route: 'admin.intake',
      status: 400,
      startedAt,
      context: { stage: 'parse-body' },
    });
    return badRequest('Could not read the request body');
  }

  // ---- Preview: parse + validate, insert nothing. ----
  if (action === 'preview') {
    if (!csv || !csv.trim()) {
      return badRequest('No CSV content provided');
    }
    if (csv.length > MAX_CSV_BYTES) {
      return badRequest('CSV content is too large (max 2 MB)');
    }

    const { rows: parsedRows, headerErrors } = parseIntakeCsv(csv);
    if (parsedRows.length === 0) {
      return validationError('No data rows found in the CSV', {
        headerErrors,
        source: INTAKE_SOURCE,
      });
    }
    if (parsedRows.length > MAX_ROWS) {
      return badRequest(`Too many rows (${parsedRows.length}); max ${MAX_ROWS} per upload`);
    }

    let context: IntakeCatalogContext;
    try {
      context = await loadCatalogContext(service);
    } catch (err) {
      // Section 18, Phase 0: previously silent — log + Sentry-capture.
      logApiError(err, {
        request,
        route: 'admin.intake',
        status: 500,
        startedAt,
        context: { stage: 'load-catalog-context', action: 'preview' },
      });
      return internalError('Failed to load catalog data for validation');
    }

    const review = reviewIntakeRows(parsedRows, context);
    return apiSuccess({
      source: INTAKE_SOURCE,
      priceNote:
        'Prices in this file are manual prices entered by an admin. They are NOT live prices and must be shown as manually-entered prices.',
      headerErrors,
      review,
      rows: parsedRows,
    });
  }

  // ---- Approve: re-validate, then insert only valid rows. ----
  if (action === 'approve') {
    if (!rows || rows.length === 0) {
      return badRequest('Approve requires the "rows" from a preview');
    }
    if (rows.length > MAX_ROWS) {
      return badRequest(`Too many rows (${rows.length}); max ${MAX_ROWS} per batch`);
    }

    let context: IntakeCatalogContext;
    try {
      context = await loadCatalogContext(service);
    } catch (err) {
      // Section 18, Phase 0: previously silent — log + Sentry-capture.
      logApiError(err, {
        request,
        route: 'admin.intake',
        status: 500,
        startedAt,
        context: { stage: 'load-catalog-context', action: 'approve' },
      });
      return internalError('Failed to load catalog data for validation');
    }

    // Never trust the client's review: re-validate raw rows server-side.
    const review = reviewIntakeRows(rows, context);
    const includeSet = new Set(includeRowNumbers);
    const toInsert = review.rows.map((r) => ({
      ...r,
      include: includeSet.has(r.rowNumber) ? true : r.include,
    }));
    const plans = planIntakeInsert(toInsert);

    const inserted: string[] = [];
    // Section 18, item 33 — product ids parallel to `inserted`,
    // for cache invalidation below (slug alone cannot build the
    // price-history / merchant-listing cache keys).
    const insertedIds: string[] = [];
    const skipped: Array<{ row: number; reason: string }> = [];
    // Section 17, Stage C items 14–15: true when any row in this
    // batch fell back to the pre-045 columns (migration unapplied)
    // — recorded in the audit log and the response so the admin
    // can see the batch went in legacy mode.
    let legacyMode = false;
    // Section 20, #6: true when any row in this batch carried a
    // model number that could not be stored because migration
    // 055 is unapplied — surfaced in the response so the admin
    // knows to re-enter it after applying 055.
    let modelNumberUnsupported = false;
    // Section 15, P3-2: the approve-time check timestamp for eBay
    // rows — the "Live eBay asking price, checked <timestamp>"
    // label reads data_freshness, so it is stamped here, once per
    // batch, only for the eBay source.
    const approvedAt = new Date().toISOString();

    for (const plan of plans) {
      // Section 17, Stage C items 14–15: the product is born
      // PENDING with its verification stamp — never public on
      // insert. It flips to 'published' only after the merchant
      // listing is in (the publish step below). Until migration
      // 045 is applied the new columns do not exist: the insert
      // retries without them (42703) and the row is public as
      // before — the approve never fails over an unapplied
      // migration.
      const verification = priceVerificationForIntakeSource(
        // Validated above to be one of the two known sources.
        source as typeof INTAKE_SOURCE | typeof EBAY_INTAKE_SOURCE,
        approvedAt
      );
      const productBase = {
        name: plan.product.name,
        slug: plan.product.slug,
        brand: plan.product.brand,
        category: plan.product.category,
        ...(plan.product.description
          ? { description: plan.product.description }
          : {}),
        ...(plan.product.image_url ? { image_url: plan.product.image_url } : {}),
        ...(plan.product.gtin ? { gtin: plan.product.gtin } : {}),
        // Section 20, #6: model number, stored only when
        // migration 055 is applied (see the staged 42703
        // fallback below — the batch never fails over it).
        ...(plan.product.model_number
          ? { model_number: plan.product.model_number }
          : {}),
        ...(source === EBAY_INTAKE_SOURCE
          ? { data_freshness: approvedAt }
          : {}),
      };
      // Same row without the model number — the middle fallback
      // step (055 unapplied, 045 applied).
      const { model_number: _droppedModelNumber, ...productBaseNoModel } = productBase;
      void _droppedModelNumber;
      const productWithStatus = {
        ...productBase,
        status: 'pending',
        price_verification_status: verification.priceVerificationStatus,
        price_verified_at: verification.priceVerifiedAt,
      };
      const productWithStatusNoModel = {
        ...productBaseNoModel,
        status: 'pending',
        price_verification_status: verification.priceVerificationStatus,
        price_verified_at: verification.priceVerifiedAt,
      };
      let productRes = await service
        .from('products')
        .insert(productWithStatus)
        .select('id')
        .single();
      let legacyColumns = false;
      // Section 20, #6 — staged 42703 fallback. The first insert
      // can fail for TWO missing columns (045's status columns
      // or 055's model_number), and a single retry cannot tell
      // which: (1) retry without model_number — succeeds when
      // only 055 is unapplied, and the batch records
      // modelNumberUnsupported so the admin knows the value was
      // not stored; (2) retry with neither — succeeds when 045
      // is unapplied too (legacy mode, as before). The batch
      // never fails over an unapplied migration.
      if (productRes.error && isUndefinedColumnError(productRes.error) && plan.product.model_number) {
        modelNumberUnsupported = true;
        productRes = await service
          .from('products')
          .insert(productWithStatusNoModel)
          .select('id')
          .single();
      }
      if (productRes.error && isUndefinedColumnError(productRes.error)) {
        legacyColumns = true;
        legacyMode = true;
        if (plan.product.model_number) modelNumberUnsupported = true;
        productRes = await service
          .from('products')
          .insert(productBaseNoModel)
          .select('id')
          .single();
      }
      const { data: product, error: productError } = productRes;

      if (productError || !product) {
        skipped.push({
          row: plan.rowNumber,
          reason:
            productError?.code === '23505'
              ? `Slug "${plan.product.slug}" already exists`
              : (productError?.message ?? 'Product insert failed'),
        });
        continue;
      }

      const productId = (product as { id: string }).id;
      const mpBase = {
        product_id: productId,
        merchant_id: plan.merchantProduct.merchantId,
        price: plan.merchantProduct.price,
        currency_id: plan.merchantProduct.currencyId,
        availability: 'in_stock',
        in_stock: true,
        ...(plan.merchantProduct.merchantSku
          ? { merchant_sku: plan.merchantProduct.merchantSku }
          : {}),
      };
      let mpRes = await service.from('merchant_products').insert({
        ...mpBase,
        price_verification_status: verification.priceVerificationStatus,
        price_source: verification.priceSource,
        price_verified_at: verification.priceVerifiedAt,
      });
      if (mpRes.error && isUndefinedColumnError(mpRes.error)) {
        mpRes = await service.from('merchant_products').insert(mpBase);
      }
      const { error: mpError } = mpRes;

      if (mpError) {
        // Product exists but has no merchant listing; report it rather
        // than silently leaving a half-inserted row unflagged.
        skipped.push({
          row: plan.rowNumber,
          reason: `Merchant listing failed for "${plan.product.slug}": ${mpError.message}`,
        });
        continue;
      }

      // Publish flip: pending → published, only now that the
      // listing exists. Skipped entirely in legacy mode (no status
      // column — the row is already public as before). If the flip
      // itself fails, the just-inserted row is removed so a
      // half-published orphan can never sit invisible and
      // un-approvable (a re-approve would hit the slug unique
      // violation); the admin re-approves the batch to retry.
      if (!legacyColumns) {
        const { error: publishError } = await service
          .from('products')
          .update({ status: 'published' })
          .eq('id', productId);
        if (publishError) {
          await service.from('products').delete().eq('id', productId);
          skipped.push({
            row: plan.rowNumber,
            reason: `Publish failed for "${plan.product.slug}" — row removed, re-approve to retry: ${publishError.message}`,
          });
          continue;
        }
      }

      inserted.push(plan.product.slug);
      insertedIds.push(productId);
    }

    // Section 18, item 33 — invalidate the product/price cache
    // keys for every approved product on THIS instance, so the new
    // product is visible immediately instead of serving a stale
    // (or absent) cached copy for up to 5 minutes. Other Vercel
    // instances keep their own copies until TTL expiry — the
    // per-instance staleness window is documented on
    // invalidateProductCaches (lib/cache/index.ts). Invalidation is
    // best-effort and never fails the approve.
    for (let i = 0; i < inserted.length; i++) {
      try {
        invalidateProductCaches(insertedIds[i], inserted[i]);
      } catch {
        // A cache failure must never fail an approved batch.
      }
    }

    // Provenance for the batch: products/merchant_products have no
    // `source` column, so the origin is recorded here — 'manual-intake'
    // for CSV batches, 'ebay-browse-api' for eBay preview batches.
    // Section 20, §12 #98 — audited via recordAdminAction (uniform
    // schema + IP capture) instead of the old direct insert. The
    // helper never throws and logs an insert failure via
    // logger.warn, so audit loss stays visible without failing
    // the batch that was already approved.
    await recordAdminAction(
      service,
      auth.userId,
      'catalog_intake_approve',
      'products',
      null,
      {
        source,
        inserted,
        skipped,
        reviewed: review.summary,
        // Section 17, Stage C item 15: every row went through
        // pending → published — unless legacyMode, where migration
        // 045 is unapplied and the status column does not exist.
        publication: legacyMode ? 'legacy-no-status-column' : 'pending-then-published',
      },
      getClientIp(request)
    );

    return apiSuccess({
      source,
      inserted,
      skipped,
      summary: review.summary,
      publication: legacyMode ? 'legacy-no-status-column' : 'pending-then-published',
      // Section 20, #6: only present when a model number was
      // dropped — the admin re-enters it after applying 055.
      ...(modelNumberUnsupported ? { modelNumberUnsupported: true } : {}),
      ...(source === EBAY_INTAKE_SOURCE
        ? {
            priceNote:
              `Live eBay asking prices, checked ${approvedAt}. No price history, no Deal Score and no alerts were created from these listings.`,
          }
        : {}),
    });
  }

  return badRequest('Unknown action — expected "preview" or "approve"');
}
