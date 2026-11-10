/**
 * AI Smart Home Reorder Agent (Section 7, item 19).
 *
 * IoT webhook triggers + reorder rules, built on the existing
 * pieces: the generic webhook signing in lib/generic-webhook.ts
 * and the vault reorder derivation in lib/vault-reorder.ts
 * (nextReorderDate — a reorder is a suggestion, never an order).
 *
 * HARD RULE — the agent NEVER places an order or charges anything
 * by itself. A matching trigger creates a PENDING CONFIRMATION:
 * shown in the UI and in the webhook response, and nothing moves
 * until the user explicitly confirms. "Auto-order with user
 * permission" means the agent prepares the reorder and asks for
 * confirmation; every order requires explicit user confirmation,
 * and the handoff is a retailer link (the product page) — no
 * purchase is ever executed by SmartBuy.
 *
 * Webhook authentication: the receiver verifies the
 * `x-smartbuy-signature` header the same way lib/generic-webhook
 * signs — HMAC-SHA256 over the exact raw body, keyed by the
 * SHA-256 hash of the shared secret (signGenericWebhookPayload).
 * The shared secret lives in the SMART_HOME_WEBHOOK_SECRET env
 * var (owner step); when it is not configured the receiver
 * answers 503 and accepts NOTHING — fail closed, never fail open.
 *
 * Pending confirmations are recorded best-effort in the optional
 * `smart_home_confirmations` table; when that table does not exist
 * the confirmation is still returned in the webhook response and
 * the GET list simply shows none recorded — the trigger is never
 * lost silently, and nothing is ever claimed as stored when it
 * was not.
 *
 * All DB reads are fail-safe: a missing table/column (42P01 /
 * PGRST205 / 42703) returns an empty honest state, never a throw.
 */

import { timingSafeEqual } from 'node:crypto';
import { logger } from '@/lib/config/logger';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import {
  GENERIC_WEBHOOK_SIGNATURE_HEADER,
  hashGenericWebhookSecret,
  signGenericWebhookPayload,
} from '@/lib/generic-webhook';

export { GENERIC_WEBHOOK_SIGNATURE_HEADER, hashGenericWebhookSecret };

export const SMART_HOME_WEBHOOK_SECRET_MIN_LENGTH = 16;

/** A trigger label is free-form device language, kept short and safe. */
export function isValidTrigger(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= 1 &&
    value.trim().length <= 80 &&
    /^[a-zA-Z0-9 _-]+$/.test(value.trim())
  );
}

export function isValidDeviceLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 100;
}

export function isValidProductSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= 1 &&
    value.trim().length <= 200 &&
    /^[a-z0-9-]+$/.test(value.trim())
  );
}

/**
 * Verify an inbound webhook signature: recompute the HMAC-SHA256
 * hex over the exact raw body (keyed by the stored secret hash,
 * exactly as signGenericWebhookPayload does) and compare in
 * constant time. A missing, malformed or mismatched signature is
 * false — never an exception.
 */
export function verifySmartHomeWebhookSignature(
  secretHash: string,
  rawBody: string,
  signature: string | null | undefined
): boolean {
  try {
    if (!secretHash || typeof signature !== 'string' || signature.trim() === '') return false;
    const expected = signGenericWebhookPayload(secretHash, rawBody);
    const given = signature.trim().toLowerCase();
    if (given.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

export interface SmartHomeRule {
  id: string;
  user_id: string;
  device_label: string;
  product_slug: string;
  trigger: string;
  auto_order: boolean;
  requires_confirmation: boolean;
  is_active: boolean;
  created_at: string;
}

const RULE_SELECT =
  'id, user_id, device_label, product_slug, trigger, auto_order, requires_confirmation, is_active, created_at';

export function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export function isMissingColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703';
}

/**
 * Find the active rule matching a device trigger. Matching is on
 * the normalized device label + trigger (case-insensitive, trimmed).
 * Pure — no I/O.
 */
export function matchSmartHomeRule(
  rules: SmartHomeRule[],
  deviceLabel: string,
  trigger: string
): SmartHomeRule | null {
  const device = deviceLabel.trim().toLowerCase();
  const trig = trigger.trim().toLowerCase();
  for (const rule of rules) {
    if (!rule.is_active) continue;
    if (
      rule.device_label.trim().toLowerCase() === device &&
      rule.trigger.trim().toLowerCase() === trig
    ) {
      return rule;
    }
  }
  return null;
}

export interface PendingConfirmation {
  /** Present only when the confirmation was persisted. */
  id: string | null;
  ruleId: string | null;
  userId: string;
  deviceLabel: string;
  productSlug: string;
  trigger: string;
  status: 'pending_confirmation';
  /** True when the confirmation row was stored; false when the optional table is missing. */
  persisted: boolean;
  receivedAt: string;
  /** The handoff: the product page, where the user confirms and follows the retailer link. */
  productUrl: string;
  note: string;
}

/**
 * Build the pending confirmation for a matched rule. Pure — no I/O.
 * Nothing here places an order: the status stays
 * 'pending_confirmation' until the user confirms explicitly.
 */
export function buildPendingConfirmation(input: {
  rule: SmartHomeRule;
  trigger: string;
  receivedAt?: Date;
}): PendingConfirmation {
  const receivedAt = (input.receivedAt ?? new Date()).toISOString();
  return {
    id: null,
    ruleId: input.rule.id,
    userId: input.rule.user_id,
    deviceLabel: input.rule.device_label,
    productSlug: input.rule.product_slug,
    trigger: input.trigger.trim(),
    status: 'pending_confirmation',
    persisted: false,
    receivedAt,
    productUrl: `/products/${input.rule.product_slug}`,
    note: input.rule.auto_order
      ? `Auto-order is ON for this rule, so the reorder was prepared — but no order was placed. Confirm here first; SmartBuy never charges anything by itself.`
      : `Reorder suggestion ready — no order was placed. Confirm on the product page if you want to buy; SmartBuy never orders by itself.`,
  };
}

/**
 * The user's smart-home rules. [] + enabled false when the
 * smart_home_rules table does not exist yet. Never throws.
 */
export async function getSmartHomeRules(
  supabase: AnySupabaseClient,
  userId: string
): Promise<{ rules: SmartHomeRule[]; enabled: boolean }> {
  try {
    const { data, error } = await supabase
      .from('smart_home_rules')
      .select(RULE_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      if (isMissingTableError(error) || isMissingColumnError(error)) {
        return { rules: [], enabled: false };
      }
      logger.warn('getSmartHomeRules: query failed', { error: error.message });
      return { rules: [], enabled: true };
    }
    return { rules: (data ?? []) as SmartHomeRule[], enabled: true };
  } catch (err) {
    logger.warn('getSmartHomeRules: unexpected error', { error: String(err) });
    return { rules: [], enabled: true };
  }
}

export interface CreateRuleInput {
  deviceLabel: string;
  productSlug: string;
  trigger: string;
  autoOrder?: boolean;
}

/**
 * Create a reorder rule. requires_confirmation is ALWAYS true —
 * any caller value is ignored, because every order needs explicit
 * user confirmation. A second create for the same
 * (user, device, product) returns the existing rule instead of
 * duplicating it. Returns missingTable when the migration has not
 * been run. Never throws.
 */
export async function createSmartHomeRule(
  supabase: AnySupabaseClient,
  userId: string,
  input: CreateRuleInput
): Promise<
  | { rule: SmartHomeRule; deduped: boolean }
  | { error: { code?: string; message: string }; missingTable?: boolean }
> {
  try {
    const { data: existing, error: existingError } = await supabase
      .from('smart_home_rules')
      .select(RULE_SELECT)
      .eq('user_id', userId)
      .eq('device_label', input.deviceLabel.trim())
      .eq('product_slug', input.productSlug.trim())
      .maybeSingle();
    if (existingError) {
      if (isMissingTableError(existingError) || isMissingColumnError(existingError)) {
        return { error: { code: existingError.code, message: 'Smart-home rules are not set up yet.' }, missingTable: true };
      }
      return { error: { code: existingError.code, message: 'Failed to read smart-home rules' } };
    }
    if (existing) return { rule: existing as SmartHomeRule, deduped: true };

    const { data, error } = await supabase
      .from('smart_home_rules')
      .insert({
        user_id: userId,
        device_label: input.deviceLabel.trim(),
        product_slug: input.productSlug.trim(),
        trigger: input.trigger.trim(),
        auto_order: input.autoOrder === true,
        requires_confirmation: true,
        is_active: true,
      })
      .select(RULE_SELECT)
      .single();
    if (error || !data) {
      if (isMissingTableError(error) || isMissingColumnError(error)) {
        return { error: { code: error?.code, message: 'Smart-home rules are not set up yet.' }, missingTable: true };
      }
      return { error: { code: error?.code, message: 'Failed to create the smart-home rule' } };
    }
    return { rule: data as SmartHomeRule, deduped: false };
  } catch (err) {
    logger.warn('createSmartHomeRule: unexpected error', { error: String(err) });
    return { error: { message: 'Failed to create the smart-home rule' } };
  }
}

/**
 * Pending confirmations for the user, newest first. The
 * smart_home_confirmations table is OPTIONAL — when it does not
 * exist, [] is the honest state (confirmations are still returned
 * in the webhook response that created them). Never throws.
 */
export async function getPendingConfirmations(
  supabase: AnySupabaseClient,
  userId: string
): Promise<PendingConfirmation[]> {
  try {
    const { data, error } = await supabase
      .from('smart_home_confirmations')
      .select('id, rule_id, user_id, device_label, product_slug, trigger, status, created_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      if (isMissingTableError(error) || isMissingColumnError(error)) return [];
      logger.warn('getPendingConfirmations: query failed', { error: error.message });
      return [];
    }
    return ((data ?? []) as Array<{
      id: string;
      rule_id: string | null;
      user_id: string;
      device_label: string;
      product_slug: string;
      trigger: string;
      status: string;
      created_at: string;
    }>).map((row) => ({
      id: row.id,
      ruleId: row.rule_id,
      userId: row.user_id,
      deviceLabel: row.device_label,
      productSlug: row.product_slug,
      trigger: row.trigger,
      status: 'pending_confirmation' as const,
      persisted: true,
      receivedAt: row.created_at,
      productUrl: `/products/${row.product_slug}`,
      note: 'Reorder suggestion ready — no order was placed. Confirm on the product page if you want to buy; SmartBuy never orders by itself.',
    }));
  } catch (err) {
    logger.warn('getPendingConfirmations: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Best-effort persist of a pending confirmation. The confirmation
 * object is returned either way — `persisted` says whether the
 * optional table actually stored it. Never throws.
 */
export async function recordPendingConfirmation(
  supabase: AnySupabaseClient,
  confirmation: PendingConfirmation
): Promise<PendingConfirmation> {
  try {
    const { data, error } = await supabase
      .from('smart_home_confirmations')
      .insert({
        user_id: confirmation.userId,
        rule_id: confirmation.ruleId,
        device_label: confirmation.deviceLabel,
        product_slug: confirmation.productSlug,
        trigger: confirmation.trigger,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error || !data) return confirmation;
    return { ...confirmation, id: (data as { id: string }).id, persisted: true };
  } catch {
    return confirmation;
  }
}
