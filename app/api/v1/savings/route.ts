/**
 * API v1 savings ledger — Section 6, item 15.
 * GET  /api/v1/savings — the signed-in user's savings events plus
 *        derived totals: totalSavedUsd, eventCount, streakWeeks
 *        (consecutive weeks with ≥1 event, derived from the ledger),
 *        and saver badge (derived at read time, never stored).
 * POST /api/v1/savings — record a savings event, ONLY when the user
 *        confirms a purchase. The amount must be > 0 and must equal
 *        compare_at_price minus the lowest recorded in-stock merchant
 *        price for the product (verified against merchant_products
 *        when product_id is given); anything else is rejected — a
 *        claimed saving that does not match the recorded data is
 *        never recorded. There is no points currency for buyers.
 *
 * Fail-safe: until migration 033 is run, GET returns
 * { events: [], savingsEnabled: false } and POST returns 503.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  internalError,
  serviceUnavailable,
  validationError,
} from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import {
  computeSavingsAmount,
  deriveSavingsSummary,
  roundToCents,
  savingsAmountMatches,
  type SavingsBasis,
  type SavingsEvent,
} from '@/lib/savings';
import { isMissingTableError } from '@/lib/agent-hunt';

export const dynamic = 'force-dynamic';

const EVENT_COLUMNS = 'id, user_id, product_id, alert_id, amount_saved_usd, basis, recorded_at';

function mapEventRow(row: Record<string, unknown>): SavingsEvent {
  const amount =
    typeof row.amount_saved_usd === 'number'
      ? row.amount_saved_usd
      : parseFloat(String(row.amount_saved_usd));
  return {
    id: String(row.id),
    userId: String(row.user_id),
    productId: typeof row.product_id === 'string' ? row.product_id : null,
    alertId: typeof row.alert_id === 'string' ? row.alert_id : null,
    amountSavedUsd: Number.isFinite(amount) ? amount : 0,
    basis: row.basis === 'price_drop' ? 'price_drop' : 'alert_purchase',
    recordedAt: String(row.recorded_at),
  };
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'savings' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`savings:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('savings_events')
      .select(EVENT_COLUMNS)
      .eq('user_id', auth.userId)
      .order('recorded_at', { ascending: false })
      .limit(100);
    if (error) {
      if (isMissingTableError(error)) {
        return apiSuccess({
          events: [],
          totalSavedUsd: 0,
          eventCount: 0,
          streakWeeks: 0,
          badge: 'none',
          savingsEnabled: false,
        });
      }
      return internalError('Failed to fetch savings');
    }
    const events = (data ?? []).map((row) => mapEventRow(row as Record<string, unknown>));
    const summary = deriveSavingsSummary(events);
    return apiSuccess({ events, ...summary, savingsEnabled: true });
  } catch {
    return internalError('Failed to fetch savings');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'savings.create' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`savings:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const productId = typeof body?.product_id === 'string' ? body.product_id.trim() : null;
    const alertId = typeof body?.alert_id === 'string' ? body.alert_id.trim() : null;
    const amountSavedUsd = body?.amount_saved_usd;
    const basis: SavingsBasis | null =
      body?.basis === 'alert_purchase' || body?.basis === 'price_drop' ? body.basis : null;

    if (typeof amountSavedUsd !== 'number' || !Number.isFinite(amountSavedUsd) || amountSavedUsd <= 0) {
      return validationError('amount_saved_usd must be a number greater than 0.');
    }
    if (!basis) {
      return validationError("basis must be one of: 'alert_purchase', 'price_drop'.");
    }

    const supabase = await createSupabaseServerClient();

    // When a product is given, the saving MUST match the recorded
    // data: compare_at_price minus the lowest recorded in-stock
    // merchant price. No recorded compare-at / price → cannot be
    // verified → rejected, never recorded on trust.
    if (productId) {
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('id')
        .eq('id', productId)
        .maybeSingle();
      if (productError) {
        if (isMissingTableError(productError)) {
          return serviceUnavailable('Savings are not set up yet — the owner still needs to run migration 033 once.');
        }
        return internalError('Failed to record savings event');
      }
      if (!productData) return validationError('product_id does not match a catalog product.');

      const { data: listings, error: listingsError } = await supabase
        .from('merchant_products')
        .select('price, compare_at_price')
        .eq('product_id', productId)
        .is('deleted_at', null)
        .eq('in_stock', true)
        .order('price', { ascending: true });
      if (listingsError) return internalError('Failed to verify savings amount');
      let expected: number | null = null;
      for (const row of (listings ?? []) as Array<Record<string, unknown>>) {
        const price = typeof row.price === 'number' ? row.price : parseFloat(String(row.price));
        const compareAt =
          row.compare_at_price === null || row.compare_at_price === undefined
            ? null
            : typeof row.compare_at_price === 'number'
              ? row.compare_at_price
              : parseFloat(String(row.compare_at_price));
        const candidate = computeSavingsAmount(compareAt, price);
        if (candidate !== null) {
          expected = candidate;
          break;
        }
      }
      if (expected === null) {
        return validationError(
          'This saving cannot be verified: no recorded merchant listing has a compare-at price above its recorded price for this product.'
        );
      }
      if (!savingsAmountMatches(amountSavedUsd, expected)) {
        return validationError(
          `amount_saved_usd must equal the recorded saving for this product: $${roundToCents(expected).toFixed(2)} (compare-at price minus the lowest recorded in-stock merchant price).`
        );
      }
    }

    // When an alert is given, it must exist and belong to the caller.
    if (alertId) {
      const { data: alertData, error: alertError } = await supabase
        .from('alerts')
        .select('id, user_id')
        .eq('id', alertId)
        .maybeSingle();
      if (alertError) return validationError('alert_id could not be verified.');
      if (!alertData || (alertData as Record<string, unknown>).user_id !== auth.userId) {
        return validationError('alert_id does not match one of your alerts.');
      }
    }

    const { data, error } = await supabase
      .from('savings_events')
      .insert({
        user_id: auth.userId,
        product_id: productId,
        alert_id: alertId,
        amount_saved_usd: roundToCents(amountSavedUsd),
        basis,
        source: 'user_confirmed',
      })
      .select(EVENT_COLUMNS)
      .single();
    if (error) {
      if (isMissingTableError(error)) {
        return serviceUnavailable('Savings are not set up yet — the owner still needs to run migration 033 once.');
      }
      return internalError('Failed to record savings event');
    }
    return apiSuccess({ event: mapEventRow(data as Record<string, unknown>), savingsEnabled: true }, 201);
  } catch {
    return internalError('Failed to record savings event');
  }
}
