/**
 * Shared helpers for the /api/v1/agent/* routes (S5#1).
 *
 * - Row → domain mappers for the migration-027 tables.
 * - Missing-table detection: until migration 027 is run, every
 *   query against `agent_memory` / `agent_rules` fails with
 *   Postgres 42P01. Callers treat that as "not set up yet" and
 *   return an honest empty state / setupRequired flag — never a
 *   crash, never fake data.
 */

import type { AgentMemory, AgentRule, AgentRuleChannel } from '@/lib/agent-memory';

/** True when a Supabase error means "this table does not exist yet". */
export function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === '42P01') return true;
  return typeof e.message === 'string' && /does not exist/i.test(e.message);
}

type Row = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function mapMemoryRow(row: Row): AgentMemory {
  const prefs = (row.preferences ?? {}) as Record<string, unknown>;
  const seen = Array.isArray(row.seen_product_slugs)
    ? (row.seen_product_slugs as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  return {
    userId: asString(row.user_id) ?? '',
    preferences: {
      maxBudgetUsd: asNumber(prefs.maxBudgetUsd) ?? undefined,
      categories: Array.isArray(prefs.categories)
        ? (prefs.categories as unknown[]).filter((c): c is string => typeof c === 'string')
        : undefined,
      preferredBrands: Array.isArray(prefs.preferredBrands)
        ? (prefs.preferredBrands as unknown[]).filter((b): b is string => typeof b === 'string')
        : undefined,
      lightweightOnly: typeof prefs.lightweightOnly === 'boolean' ? prefs.lightweightOnly : undefined,
    },
    seenProductSlugs: seen,
    consentGrantedAt: asString(row.consent_granted_at),
    createdAt: asString(row.created_at) ?? '',
    updatedAt: asString(row.updated_at) ?? '',
  };
}

export function mapRuleRow(row: Row): AgentRule {
  const channel = asString(row.channel);
  const safeChannel: AgentRuleChannel =
    channel === 'email' || channel === 'push' || channel === 'both' ? channel : 'email';
  return {
    id: asString(row.id) ?? '',
    userId: asString(row.user_id),
    productId: asString(row.product_id),
    productSlug: asString(row.product_slug) ?? '',
    productName: asString(row.product_name),
    targetPriceUsd: asNumber(row.target_price_usd) ?? 0,
    channel: safeChannel,
    alertId: asString(row.alert_id),
    active: row.active === true,
    lastTriggeredAt: asString(row.last_triggered_at),
    triggerCount: typeof row.trigger_count === 'number' ? row.trigger_count : 0,
    createdAt: asString(row.created_at) ?? '',
    updatedAt: asString(row.updated_at) ?? '',
  };
}
