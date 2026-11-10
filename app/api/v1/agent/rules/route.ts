/**
 * API v1 agent rules endpoint (S5#1).
 * GET  /api/v1/agent/rules — the signed-in user's autonomous rules.
 * POST /api/v1/agent/rules — create a rule ("alert me under $800").
 *
 * A rule triggers through the EXISTING alert chain, not a new one:
 * creating a rule also creates a `price_drop` alert with the same
 * target (services/alerts.ts createAlert), and the rule row keeps
 * the alert id. If the alert cannot be created, the rule is still
 * saved with alert_id NULL and the response honestly reports
 * alertLinked: false — the rule never pretends to notify.
 *
 * Fail-safe: until migration 027 is run, GET returns
 * { rules: [], setupRequired: true } and POST returns an honest
 * "not set up yet" error.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, conflict, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import { ruleToAlertInput, validateRuleInput } from '@/lib/agent-memory';
import { createAlert } from '@/services/alerts';
import { getCachedProductBySlug } from '@/services/products';
import { isMissingTableError, mapRuleRow } from '../shared';

export const dynamic = 'force-dynamic';

const RULE_COLUMNS =
  'id, user_id, product_id, product_slug, product_name, target_price_usd, channel, alert_id, active, last_triggered_at, trigger_count, created_at, updated_at';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'agent.rules' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`agent-rules:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('agent_rules')
      .select(RULE_COLUMNS)
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false });

    if (error) {
      if (isMissingTableError(error)) {
        return apiSuccess({ rules: [], setupRequired: true });
      }
      return internalError('Failed to fetch agent rules');
    }
    return apiSuccess({
      rules: (data ?? []).map((row) => mapRuleRow(row as Record<string, unknown>)),
      setupRequired: false,
    });
  } catch {
    return internalError('Failed to fetch agent rules');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'agent.rules.create' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`agent-rules:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const channel =
      body?.channel === 'email' || body?.channel === 'push' || body?.channel === 'both'
        ? body.channel
        : 'email';
    const validation = validateRuleInput({
      productId: body?.productId,
      productSlug: body?.productSlug,
      productName: body?.productName,
      targetPriceUsd: body?.targetPriceUsd,
      channel,
    });
    if (!validation.ok) {
      return badRequest(validation.errors.join(' '));
    }

    const supabase = await createSupabaseServerClient();

    // Resolve the product — a rule must point at a real catalog
    // product, never a free-text name. Slug wins; a bare id is
    // verified against the products table.
    let productId: string | null = null;
    let productSlug: string | null = null;
    let productName: string | null =
      typeof body?.productName === 'string' ? body.productName : null;

    if (typeof body?.productSlug === 'string' && body.productSlug.trim() !== '') {
      const product = await getCachedProductBySlug(supabase, body.productSlug.trim());
      if (product) {
        productId = product.id;
        productSlug = product.slug;
        productName = product.name;
      }
    } else if (typeof body?.productId === 'string' && body.productId.trim() !== '') {
      const { data } = await supabase
        .from('products')
        .select('id, slug, name')
        .eq('id', body.productId.trim())
        .is('deleted_at', null)
        .maybeSingle();
      if (data) {
        productId = (data as Record<string, unknown>).id as string;
        productSlug = (data as Record<string, unknown>).slug as string;
        productName = (data as Record<string, unknown>).name as string;
      }
    }

    if (!productSlug) {
      return badRequest('Product not found — check the product slug.');
    }

    const { data: inserted, error: insertError } = await supabase
      .from('agent_rules')
      .insert({
        user_id: auth.userId,
        product_id: productId,
        product_slug: productSlug,
        product_name: productName,
        target_price_usd: body.targetPriceUsd,
        channel,
        alert_id: null,
        active: true,
      })
      .select(RULE_COLUMNS)
      .maybeSingle();

    if (insertError || !inserted) {
      if (insertError && isMissingTableError(insertError)) {
        return internalError('Agent rules are not set up yet — migration 027 has not been run');
      }
      if (insertError && (insertError as { code?: string }).code === '23505') {
        return conflict('A rule with this target price already exists for this product.');
      }
      return internalError('Failed to create agent rule');
    }

    const rule = mapRuleRow(inserted as Record<string, unknown>);

    // Link the rule into the existing alert chain: one price_drop
    // alert with the rule's target as its condition. The 6-hour
    // cron check is what fires it — nothing new is scheduled here.
    let alertLinked = false;
    const alertInput = ruleToAlertInput(rule);
    if (alertInput) {
      const alert = await createAlert(supabase, auth.userId, alertInput);
      if (alert) {
        alertLinked = true;
        const { data: updated } = await supabase
          .from('agent_rules')
          .update({ alert_id: alert.id })
          .eq('id', rule.id)
          .eq('user_id', auth.userId)
          .select(RULE_COLUMNS)
          .maybeSingle();
        if (updated) {
          const linkedRule = mapRuleRow(updated as Record<string, unknown>);
          return apiSuccess(
            {
              rule: linkedRule,
              alertLinked: true,
              note: 'Rule created and linked to a price-drop alert — the existing alert chain will notify you.',
            },
            201
          );
        }
      }
    }

    return apiSuccess(
      {
        rule,
        alertLinked,
        note:
          'Rule saved, but the price-drop alert could not be created — this rule will not notify you until the alert is linked. Try deleting and re-creating it.',
      },
      201
    );
  } catch {
    return internalError('Failed to create agent rule');
  }
}
