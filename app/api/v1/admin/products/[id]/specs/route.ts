/**
 * API v1 admin product-specs endpoint (Section 21–25, Stage C — B1 + K12).
 * GET / PATCH /api/v1/admin/products/[id]/specs — admin only
 * (requireAdmin + lib/admin-role.ts, never a new guard).
 *
 * - GET: the product's stored specs with per-spec attribution,
 *   plus the category's template keys (so the UI can show which
 *   specs are still unknown — never pre-filled).
 * - PATCH: verify/correct specs. Body: { entries: [{ key, value,
 *   unit? }], deleteKeys?: string[], source?: string }. Entries
 *   are validated against the category spec template in
 *   services/admin-products.ts (`validateSpecCorrection`) and
 *   replaced by key; deleteKeys removes stored specs. Nothing is
 *   invented: an unknown value stays unknown until an admin
 *   records a real value against its source. The correction is
 *   recorded in admin_audit_logs via recordAdminAction (best
 *   effort, never fails the edit).
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  apiSuccess,
  badRequest,
  internalError,
  notFound,
  validationError,
} from '@/lib/api/responses';
import {
  logApiRequest,
  requireAdmin,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import {
  correctProductSpecsForAdmin,
  getAdminProductById,
  listProductSpecsForAdmin,
  validateSpecCorrection,
} from '@/services/admin-products';
import { recordAdminAction } from '@/services/admin';
import { logApiError } from '@/lib/api/error-logging';
import {
  adminProductSpecsPatchSchema,
  invalidBodyResponse,
  validateBody,
} from '@/lib/api/validation';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'admin.products.specs.get', id: params.id });
  const limited = await rateLimitResponse(`admin-products-specs-get:${getClientIp(request)}`, 60);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Admin products unavailable: service client not configured');
  }

  try {
    const { product, columnsMissing } = await getAdminProductById(service, params.id);
    if (!product) return notFound('Product not found');
    const view = await listProductSpecsForAdmin(service, params.id, product.category);
    if (view.error) return internalError(view.error);
    return apiSuccess({ ...view, columnsMissing });
  } catch (err) {
    logApiError(err, { request, route: 'admin.products.specs.get', status: 500 });
    return internalError('Failed to fetch product specs');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'admin.products.specs.patch', id: params.id });
  const limited = await rateLimitResponse(`admin-products-specs-patch:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Admin products unavailable: service client not configured');
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return badRequest('A JSON object body is required.');
    }
    const { product } = await getAdminProductById(service, params.id);
    if (!product) return notFound('Product not found');
    // Sections 21–25, Stage G, G-P2-1 — shared Zod shape gate
    // (type/shape only; runs after the 404 so an unknown product
    // still 404s). The ORIGINAL body goes to
    // validateSpecCorrection below, so its template rules and
    // 422 messages are preserved.
    const invalid = invalidBodyResponse(
      validateBody(adminProductSpecsPatchSchema, body),
    );
    if (invalid) return invalid;
    const validated = validateSpecCorrection(product.category, body);
    if (validated.correction === null) return validationError(validated.error ?? 'Invalid spec correction.');

    const result = await correctProductSpecsForAdmin(
      service,
      params.id,
      product.category,
      validated.correction,
      auth.userId
    );
    if (result.error) return internalError(result.error);
    await recordAdminAction(
      service,
      auth.userId,
      'product_specs_update',
      'product',
      params.id,
      {
        replacedKeys: result.replacedKeys,
        removedKeys: result.removedKeys,
        source: validated.correction.source ?? 'manual-intake',
      },
      getClientIp(request)
    );
    return apiSuccess(result);
  } catch (err) {
    logApiError(err, { request, route: 'admin.products.specs.patch', status: 500 });
    return internalError('Failed to update product specs');
  }
}
