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
 *    `source: 'manual-intake'`.
 *
 * Prices entered here are MANUAL prices — typed in by an admin, never
 * fetched live and never presented as live prices. `products` /
 * `merchant_products` have no `source` column in the schema (none is
 * invented); provenance lives in the audit-log details JSONB.
 *
 * Admin-only (migration 017: catalog writes are admin-only at the RLS
 * level too). Writes go through the service-role client after
 * requireAdmin; the session client is never used for writes.
 */

import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
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
import {
  INTAKE_SOURCE,
  parseIntakeCsv,
  reviewIntakeRows,
  planIntakeInsert,
  intakeNameBrandKey,
  normalizeIntakeKey,
  type IntakeCatalogContext,
  type IntakeRowInput,
  type IntakeReviewedRow,
} from '@/services/catalog-intake';

export const dynamic = 'force-dynamic';

const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MB — intake files are small by design
const MAX_ROWS = 1000;

/**
 * Loads the live catalog context used for validation: existing product
 * slugs + name/brand keys, merchants by normalized slug/name, and
 * currencies by code. Read-only.
 */
async function loadCatalogContext(
  service: SupabaseClient,
): Promise<IntakeCatalogContext> {
  const [productsRes, merchantsRes, currenciesRes] = await Promise.all([
    service.from('products').select('slug, name, brand').limit(5000),
    service.from('merchants').select('id, slug, name'),
    service.from('currencies').select('id, code'),
  ]);

  const existingSlugs = new Set<string>();
  const existingNameBrands = new Map<string, string>();
  for (const p of (productsRes.data ?? []) as Array<{
    slug: string;
    name: string | null;
    brand: string | null;
  }>) {
    existingSlugs.add(p.slug.toLowerCase());
    if (p.name && p.brand) {
      existingNameBrands.set(intakeNameBrandKey(p.name, p.brand), p.slug);
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

  return { existingSlugs, existingNameBrands, knownMerchants, knownCurrencies };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.intake' });
  const limited = await rateLimitResponse(
    `admin.intake:${getClientIp(request)}`,
    30,
  );
  if (limited) return limited;

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
      action = typeof body.action === 'string' ? body.action : undefined;
      if (typeof body.csv === 'string') csv = body.csv;
      if (Array.isArray(body.rows)) {
        rows = body.rows as IntakeRowInput[];
      }
      if (Array.isArray(body.includeRowNumbers)) {
        includeRowNumbers = (body.includeRowNumbers as unknown[]).filter(
          (n): n is number => typeof n === 'number',
        );
      }
    }
  } catch {
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
    } catch {
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
    } catch {
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
    const skipped: Array<{ row: number; reason: string }> = [];

    for (const plan of plans) {
      const { data: product, error: productError } = await service
        .from('products')
        .insert({
          name: plan.product.name,
          slug: plan.product.slug,
          brand: plan.product.brand,
          category: plan.product.category,
          ...(plan.product.description
            ? { description: plan.product.description }
            : {}),
          ...(plan.product.image_url ? { image_url: plan.product.image_url } : {}),
          ...(plan.product.gtin ? { gtin: plan.product.gtin } : {}),
        })
        .select('id')
        .single();

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

      const { error: mpError } = await service.from('merchant_products').insert({
        product_id: (product as { id: string }).id,
        merchant_id: plan.merchantProduct.merchantId,
        price: plan.merchantProduct.price,
        currency_id: plan.merchantProduct.currencyId,
        availability: 'in_stock',
        in_stock: true,
        ...(plan.merchantProduct.merchantSku
          ? { merchant_sku: plan.merchantProduct.merchantSku }
          : {}),
      });

      if (mpError) {
        // Product exists but has no merchant listing; report it rather
        // than silently leaving a half-inserted row unflagged.
        skipped.push({
          row: plan.rowNumber,
          reason: `Merchant listing failed for "${plan.product.slug}": ${mpError.message}`,
        });
        continue;
      }

      inserted.push(plan.product.slug);
    }

    // Provenance for the batch: products/merchant_products have no
    // `source` column, so the manual-intake origin is recorded here.
    const { error: auditError } = await service.from('admin_audit_logs').insert({
      admin_id: auth.userId,
      action: 'catalog_intake_approve',
      target_type: 'products',
      target_id: null,
      details: {
        source: INTAKE_SOURCE,
        inserted,
        skipped,
        reviewed: review.summary,
      },
    });
    if (auditError) {
      // Best-effort: the inserts already happened; do not fail the
      // request over the audit row, but do not hide the failure either.
      console.error('catalog intake: audit log insert failed', auditError.message);
    }

    return apiSuccess({
      source: INTAKE_SOURCE,
      inserted,
      skipped,
      summary: review.summary,
    });
  }

  return badRequest('Unknown action — expected "preview" or "approve"');
}
