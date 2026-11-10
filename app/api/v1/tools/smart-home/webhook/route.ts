/**
 * Smart-home webhook receiver (Section 7, item 19).
 * POST /api/v1/tools/smart-home/webhook — an IoT device (or hub)
 * reports a trigger, e.g. {"device_label": "Office Printer",
 * "trigger": "ink_low"}. A matching ACTIVE rule creates a PENDING
 * CONFIRMATION — nothing is ordered, nothing is charged, and the
 * user must confirm explicitly on the product page.
 *
 * Authentication is the HMAC signature, verified exactly the way
 * lib/generic-webhook.ts signs: HMAC-SHA256 hex over the exact raw
 * body, keyed by the SHA-256 hash of the shared secret, sent as
 * the `x-smartbuy-signature` header. The shared secret is the
 * SMART_HOME_WEBHOOK_SECRET env var (owner step, minimum 16
 * characters). When it is not configured the receiver answers 503
 * and accepts NOTHING — fail closed, never fail open. No session
 * is needed (devices have none); the signature IS the auth.
 *
 * The secret is one shared household secret, so the device label
 * must be unique per household: if the same device + trigger
 * matches rules of more than one user, the request is rejected
 * (409) rather than guessing an owner.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  apiSuccess,
  badRequest,
  internalError,
  notFound,
  serviceUnavailable,
  unauthorized,
  conflict,
} from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  GENERIC_WEBHOOK_SIGNATURE_HEADER,
  buildPendingConfirmation,
  hashGenericWebhookSecret,
  isValidDeviceLabel,
  isValidTrigger,
  matchSmartHomeRule,
  recordPendingConfirmation,
  verifySmartHomeWebhookSignature,
  SMART_HOME_WEBHOOK_SECRET_MIN_LENGTH,
  type SmartHomeRule,
} from '@/lib/smart-home-agent';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.smart-home.webhook' });
  const limited = await rateLimitResponse(`tools.smart-home.webhook:${getClientIp(request)}`, 30);
  if (limited) return limited;

  // The HMAC is over the EXACT raw body — read it as text first.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return badRequest('Request body could not be read');
  }

  const secret = process.env.SMART_HOME_WEBHOOK_SECRET;
  if (!secret || secret.length < SMART_HOME_WEBHOOK_SECRET_MIN_LENGTH) {
    return serviceUnavailable(
      'Smart-home webhook is not configured — the owner still needs to set SMART_HOME_WEBHOOK_SECRET (minimum 16 characters). No trigger was accepted.'
    );
  }
  const signature = request.headers.get(GENERIC_WEBHOOK_SIGNATURE_HEADER);
  const secretHash = hashGenericWebhookSecret(secret);
  if (!verifySmartHomeWebhookSignature(secretHash, rawBody, signature)) {
    return unauthorized('Invalid webhook signature');
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return badRequest('Request body must be JSON');
  }
  const payload = body as Record<string, unknown>;
  if (!isValidDeviceLabel(payload?.device_label)) {
    return badRequest('device_label is required (1–100 characters).');
  }
  if (!isValidTrigger(payload?.trigger)) {
    return badRequest('trigger is required (1–80 characters, letters, numbers, spaces, _ or -).');
  }
  const deviceLabel = (payload.device_label as string).trim();
  const trigger = (payload.trigger as string).trim();

  try {
    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      return internalError('Smart-home webhook is unavailable');
    }
    // Service client: the device has no user session, and the
    // signature is the auth. Match across owners, then reject an
    // ambiguous match instead of guessing.
    const { data, error } = await supabase
      .from('smart_home_rules')
      .select('id, user_id, device_label, product_slug, trigger, auto_order, requires_confirmation, is_active, created_at')
      .eq('is_active', true);
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703') {
        return serviceUnavailable(
          'Smart-home rules are not set up yet — the owner still needs to run the Section 7 migration (smart_home_rules table) once.'
        );
      }
      return internalError('Failed to read smart-home rules');
    }
    const rules = (data ?? []) as SmartHomeRule[];
    const matched = rules.filter(
      (r) =>
        r.device_label.trim().toLowerCase() === deviceLabel.toLowerCase() &&
        r.trigger.trim().toLowerCase() === trigger.toLowerCase()
    );
    if (matched.length === 0) {
      return notFound('No active smart-home rule matches this device and trigger.');
    }
    const owners = [...new Set(matched.map((r) => r.user_id))];
    if (owners.length > 1) {
      return conflict(
        'This device and trigger match rules of more than one user — give the device a unique label per household and try again.'
      );
    }
    const rule = matchSmartHomeRule(matched, deviceLabel, trigger);
    if (!rule) return notFound('No active smart-home rule matches this device and trigger.');

    // A body product_slug must agree with the rule; otherwise the
    // rule's product is the reorder.
    if (
      typeof payload?.product_slug === 'string' &&
      payload.product_slug.trim() !== '' &&
      payload.product_slug.trim() !== rule.product_slug
    ) {
      return badRequest('product_slug does not match the rule for this device and trigger.');
    }

    const confirmation = await recordPendingConfirmation(
      supabase,
      buildPendingConfirmation({ rule, trigger })
    );
    return apiSuccess({
      matched: true,
      pendingConfirmation: confirmation,
      requiresConfirmation: true,
      orderPlaced: false,
      detail:
        'Trigger accepted. A reorder was prepared as a pending confirmation — no order was placed and nothing was charged. The user must confirm explicitly on the product page.',
    });
  } catch (err) {
    console.error('[tools.smart-home.webhook] unexpected error', err);
    return internalError('Failed to handle the smart-home trigger');
  }
}
