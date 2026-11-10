/**
 * API v1 Receipt Vault endpoints (Option 8, Feature 3).
 * GET  /api/v1/vault — the signed-in user's vault items.
 * POST /api/v1/vault — add a vault item (auth required).
 *
 * HONESTY: receipt_file_* fields store client-captured FILE METADATA only
 * (name, type, size) plus an optional user-pasted receipt URL. No storage
 * bucket is configured, so no file bytes are ever uploaded — the API never
 * pretends otherwise. extracted_text is user-entered text only; automatic
 * OCR is a future provider integration, not an active capability.
 * Warranty expiry surfacing is computed on view; no background/email
 * warranty alerts are wired.
 *
 * Graceful degradation: if supabase/add-receipt-vault.sql has not been
 * run yet, GET returns { items: [], vaultEnabled: false } and POST
 * returns 503 with an honest message.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
  serviceUnavailable,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';

function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01';
}

const SELECT =
  'id, title, store, product_id, purchase_date, amount, currency, warranty_months, receipt_file_name, receipt_file_type, receipt_file_size, receipt_url, extracted_text, created_at';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'vault' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`vault:${getClientIp(request)}`, 120);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('vault_items')
      .select(SELECT)
      .eq('user_id', auth.userId)
      .order('purchase_date', { ascending: false });
    if (error) {
      if (isMissingTable(error)) return apiSuccess([], 200, { vaultEnabled: false });
      return internalError('Failed to fetch vault items');
    }
    return apiSuccess(data ?? [], 200, { vaultEnabled: true });
  } catch {
    return internalError('Failed to fetch vault items');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'vault.create' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`vault:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const purchaseDate = typeof body?.purchaseDate === 'string' ? body.purchaseDate : '';
    if (!title) return badRequest('title is required');
    if (!purchaseDate || Number.isNaN(new Date(purchaseDate).getTime())) {
      return badRequest('a valid purchaseDate is required');
    }
    const warrantyMonths = Math.max(0, Math.floor(Number(body?.warrantyMonths) || 0));
    const amount =
      body?.amount === null || body?.amount === undefined || body?.amount === ''
        ? null
        : Number(body.amount);
    if (amount !== null && !Number.isFinite(amount)) return badRequest('amount must be a number');

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('vault_items')
      .insert({
        user_id: auth.userId,
        title,
        store: typeof body?.store === 'string' ? body.store.trim() || null : null,
        product_id: typeof body?.productId === 'string' ? body.productId : null,
        purchase_date: purchaseDate,
        amount,
        currency:
          typeof body?.currency === 'string' && body.currency.trim()
            ? body.currency.trim().toUpperCase()
            : 'USD',
        warranty_months: warrantyMonths,
        receipt_file_name: typeof body?.receiptFileName === 'string' ? body.receiptFileName : null,
        receipt_file_type: typeof body?.receiptFileType === 'string' ? body.receiptFileType : null,
        receipt_file_size:
          typeof body?.receiptFileSize === 'number' ? Math.floor(body.receiptFileSize) : null,
        receipt_url: typeof body?.receiptUrl === 'string' ? body.receiptUrl.trim() || null : null,
        extracted_text: typeof body?.extractedText === 'string' ? body.extractedText : null,
      })
      .select(SELECT)
      .single();
    if (error || !data) {
      if (isMissingTable(error)) {
        return serviceUnavailable(
          'The Receipt Vault is not live yet — the owner still needs to run supabase/add-receipt-vault.sql.'
        );
      }
      return internalError('Failed to save vault item');
    }
    return apiSuccess(data, 201);
  } catch {
    return internalError('Failed to save vault item');
  }
}
