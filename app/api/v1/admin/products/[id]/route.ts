/**
 * API v1 admin single-product endpoint (Section 20, §12 #69).
 * GET / PATCH / DELETE /api/v1/admin/products/[id] — admin only
 * (requireAdmin + lib/admin-role.ts, never a new guard).
 *
 * - GET: one product, any status (pending / rejected included).
 * - PATCH: validated field list only (services/admin-products.ts
 *   `validateAdminProductPatch`) — name, description, brand,
 *   category, image_url (http(s) only), gtin, status. The edit is
 *   recorded in admin_audit_logs via recordAdminAction (best
 *   effort, never fails the edit).
 * - DELETE: SOFT delete (deleted_at). Catalog rows are never hard
 *   deleted, so a mistaken delete is reversible from the database.
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
  deleteAdminProduct,
  getAdminProductById,
  updateAdminProduct,
  validateAdminProductPatch,
} from '@/services/admin-products';
import { recordAdminAction } from '@/services/admin';
import { logApiError } from '@/lib/api/error-logging';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'admin.products.get', id: params.id });
  const limited = await rateLimitResponse(`admin-products-get:${getClientIp(request)}`, 60);
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
    return apiSuccess({ ...product, columnsMissing });
  } catch (err) {
    logApiError(err, { request, route: 'admin.products.get', status: 500 });
    return internalError('Failed to fetch product');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'admin.products.patch', id: params.id });
  const limited = await rateLimitResponse(`admin-products-patch:${getClientIp(request)}`, 30);
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
    const validated = validateAdminProductPatch(body);
    // Narrow on patch (not on error truthiness — `error: string`
    // includes '' so a truthiness check would not narrow the union).
    if (validated.patch === null) return validationError(validated.error);

    const { product, error } = await updateAdminProduct(service, params.id, validated.patch);
    if (!product) {
      if (error === 'Product not found.') return notFound(error);
      return internalError(error ?? 'Failed to update product');
    }
    await recordAdminAction(service, auth.userId, 'product_update', 'product', params.id, {
      fields: Object.keys(validated.patch),
    }, getClientIp(request));
    return apiSuccess(product);
  } catch (err) {
    logApiError(err, { request, route: 'admin.products.patch', status: 500 });
    return internalError('Failed to update product');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logApiRequest(request, { endpoint: 'admin.products.delete', id: params.id });
  const limited = await rateLimitResponse(`admin-products-delete:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const service = createSupabaseServiceClient();
  if (!service) {
    return internalError('Admin products unavailable: service client not configured');
  }

  try {
    const { ok, error } = await deleteAdminProduct(service, params.id);
    if (!ok) {
      if (error === 'Product not found.') return notFound(error);
      return internalError(error ?? 'Failed to delete product');
    }
    await recordAdminAction(service, auth.userId, 'product_delete', 'product', params.id, {
      softDelete: true,
    }, getClientIp(request));
    return apiSuccess({ deleted: true, id: params.id });
  } catch (err) {
    logApiError(err, { request, route: 'admin.products.delete', status: 500 });
    return internalError('Failed to delete product');
  }
}
