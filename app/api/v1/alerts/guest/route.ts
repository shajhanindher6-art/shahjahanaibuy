/**
 * Guest email alerts (S3#7).
 * POST /api/v1/alerts/guest — opt an email into server-side alerts.
 * No sign-in required. The email is stored with an unsubscribe token
 * (guest_email_alerts, migration 026) and checked by the scheduled
 * price refresh; delivery itself happens only when Resend is
 * configured — this endpoint stores + queues honestly and never
 * claims an email was sent.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  conflict,
  internalError,
} from '@/lib/api/responses';
import {
  logApiRequest,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { isValidEmail } from '@/lib/local-alerts';

const VALID_TYPES = ['price_drop', 'back_in_stock', 'deal'] as const;

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'alerts.guest.create' });

  const limited = await rateLimitResponse(
    `alerts-guest:${getClientIp(request)}`,
    30,
    60_000
  );
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const { email, productId, alertType, targetPrice, guestToken } = body ?? {};

    if (!isValidEmail(email)) {
      return badRequest('A valid email address is required');
    }
    if (typeof productId !== 'string' || productId.trim() === '') {
      return badRequest('productId is required');
    }
    if (!VALID_TYPES.includes(alertType)) {
      return badRequest('alertType must be one of: price_drop, back_in_stock, deal');
    }
    if (
      alertType === 'price_drop' &&
      (typeof targetPrice !== 'number' ||
        !Number.isFinite(targetPrice) ||
        targetPrice <= 0)
    ) {
      return badRequest('A target price above $0 is required for price_drop alerts');
    }

    const supabase = await createSupabaseServerClient();

    // The product must exist — never store an alert for a made-up id.
    const { data: product } = await supabase
      .from('products')
      .select('id')
      .eq('id', productId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!product) {
      return badRequest('Unknown product');
    }

    const { error } = await supabase.from('guest_email_alerts').insert({
      email: email.trim().toLowerCase(),
      product_id: productId,
      alert_type: alertType,
      target_price:
        alertType === 'price_drop' ? targetPrice : null,
      guest_token:
        typeof guestToken === 'string' && guestToken.trim() !== ''
          ? guestToken.trim()
          : null,
    });

    if (error) {
      // Dedupe: one live alert of each type per email+product.
      if ((error as { code?: string }).code === '23505') {
        return conflict('An alert of this type is already active for this email and product');
      }
      // Migration not run yet (or any other DB error): fail honestly
      // instead of pretending the alert was saved.
      return internalError('Could not save the email alert');
    }

    return apiSuccess(
      {
        subscribed: true,
        email: email.trim().toLowerCase(),
        productId,
        alertType,
        // Honest delivery note: the alert is stored; an email is sent
        // only when the scheduled price check runs and finds the
        // trigger AND email delivery is configured by the site owner.
        delivery:
          'Stored. You will be emailed when the scheduled price check finds this trigger (email delivery depends on the site owner having email configured). Unsubscribe anytime from the link in any alert email.',
      },
      201
    );
  } catch {
    return internalError('Failed to save the email alert');
  }
}
