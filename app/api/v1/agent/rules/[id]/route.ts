/**
 * API v1 single agent rule endpoint (S5#1).
 * PATCH  /api/v1/agent/rules/[id] — toggle active, change the
 *        target price, or change the channel. A target/active
 *        change is mirrored onto the linked `alerts` row (the
 *        existing alert chain), best-effort — the response reports
 *        alertUpdated so the UI never claims a sync that failed.
 * DELETE /api/v1/agent/rules/[id] — delete the rule and deactivate
 *        its linked alert (the alert is deactivated, not deleted,
 *        so alert history stays intact).
 *
 * Ownership is verified server-side (rule.user_id === caller) on
 * every operation; RLS is the second layer, never the only one.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError, notFound } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import { validateRuleInput } from '@/lib/agent-memory';
import { updateAlert } from '@/services/alerts';
import { isMissingTableError, mapRuleRow } from '../../shared';

export const dynamic = 'force-dynamic';

const RULE_COLUMNS =
  'id, user_id, product_id, product_slug, product_name, target_price_usd, channel, alert_id, active, last_triggered_at, trigger_count, created_at, updated_at';

async function loadOwnedRule(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, id: string, userId: string) {
  const { data, error } = await supabase
    .from('agent_rules')
    .select(RULE_COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { error };
  if (!data) return { rule: null };
  return { rule: mapRuleRow(data as Record<string, unknown>) };
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  logApiRequest(request, { endpoint: 'agent.rules.update' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`agent-rules:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const patch: Record<string, unknown> = {};

    if (body?.active !== undefined) {
      if (typeof body.active !== 'boolean') return badRequest('active must be a boolean.');
      patch.active = body.active;
    }
    if (body?.targetPriceUsd !== undefined) {
      const validation = validateRuleInput({
        productSlug: 'x',
        targetPriceUsd: body.targetPriceUsd,
      });
      if (!validation.ok) return badRequest(validation.errors.join(' '));
      patch.target_price_usd = body.targetPriceUsd;
    }
    if (body?.channel !== undefined) {
      if (body.channel !== 'email' && body.channel !== 'push' && body.channel !== 'both') {
        return badRequest("channel must be one of: email, push, both.");
      }
      patch.channel = body.channel;
    }
    if (Object.keys(patch).length === 0) {
      return badRequest('Nothing to update — pass active, targetPriceUsd, or channel.');
    }

    const supabase = await createSupabaseServerClient();
    const loaded = await loadOwnedRule(supabase, params.id, auth.userId);
    if ('error' in loaded && loaded.error) {
      if (isMissingTableError(loaded.error)) {
        return internalError('Agent rules are not set up yet — migration 027 has not been run');
      }
      return internalError('Failed to update agent rule');
    }
    if (!loaded.rule) return notFound('Rule not found');

    const { data, error } = await supabase
      .from('agent_rules')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('user_id', auth.userId)
      .select(RULE_COLUMNS)
      .maybeSingle();
    if (error || !data) return internalError('Failed to update agent rule');
    const rule = mapRuleRow(data as Record<string, unknown>);

    // Mirror the change onto the linked alert (existing chain).
    // Best-effort: a failed mirror is reported, never hidden.
    let alertUpdated = true;
    if (rule.alertId) {
      const alertPatch: { conditionValue?: number; channel?: 'email' | 'push' | 'both'; active?: boolean } = {};
      if (typeof patch.target_price_usd === 'number') alertPatch.conditionValue = patch.target_price_usd;
      if (typeof patch.channel === 'string') alertPatch.channel = patch.channel as 'email' | 'push' | 'both';
      if (typeof patch.active === 'boolean') alertPatch.active = patch.active;
      if (Object.keys(alertPatch).length > 0) {
        const updatedAlert = await updateAlert(supabase, rule.alertId, auth.userId, alertPatch);
        alertUpdated = updatedAlert !== null;
      }
    }

    return apiSuccess({
      rule,
      alertUpdated,
      note: alertUpdated
        ? undefined
        : 'Rule updated, but the linked price-drop alert could not be updated — delete and re-create the rule to re-link it.',
    });
  } catch {
    return internalError('Failed to update agent rule');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  logApiRequest(request, { endpoint: 'agent.rules.delete' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(`agent-rules:${auth.userId}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const loaded = await loadOwnedRule(supabase, params.id, auth.userId);
    if ('error' in loaded && loaded.error) {
      if (isMissingTableError(loaded.error)) {
        return internalError('Agent rules are not set up yet — migration 027 has not been run');
      }
      return internalError('Failed to delete agent rule');
    }
    if (!loaded.rule) return notFound('Rule not found');

    const { error } = await supabase
      .from('agent_rules')
      .delete()
      .eq('id', params.id)
      .eq('user_id', auth.userId);
    if (error) return internalError('Failed to delete agent rule');

    // Deactivate (not delete) the linked alert so alert history
    // stays intact. Best-effort — the rule itself is gone either way.
    if (loaded.rule.alertId) {
      await updateAlert(supabase, loaded.rule.alertId, auth.userId, { active: false });
    }
    return apiSuccess({ deleted: true });
  } catch {
    return internalError('Failed to delete agent rule');
  }
}
