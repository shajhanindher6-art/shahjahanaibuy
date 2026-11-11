/**
 * Public API paywall — per-key daily quotas + tier gating
 * (Section 9, chunk 3). SERVER ONLY — never import from a client
 * component.
 *
 * Quotas (requests per API key, per UTC day):
 *   - Anonymous (no key): 100/day per IP. Low-volume, key-optional
 *     read-only access stays exactly as-is — no key is required and
 *     nothing about the anonymous path changes except that
 *     high-volume anonymous use is now gated at this daily cap.
 *   - Free tier key:    1,000/day
 *   - Premium tier key: 10,000/day (Premium is $9.99/month — see
 *     lib/tiers.ts; no price is set or changed here)
 *   - Family tier key:  10,000/day (same as Premium: Family is
 *     Premium for up to 5 members — see lib/tiers.ts)
 *   - Team tier key:    100,000/day
 *
 * Tier gating: a key's tier comes from its owner's `subscriptions`
 * row (`plan` + `status = 'active'`). A key whose owner has no
 * active paid subscription stays on the free quota. No key is ever
 * blocked outright for being free — it is only capped.
 *
 * Billing link: the 429 body points at `/pricing` — the canonical
 * pricing page (Section 12). No new billing URL is invented;
 * Stripe stays in TEST mode and no checkout flow is touched here.
 *
 * Storage: quota state is checked AND incremented per request in
 * an in-memory daily store (same pattern as the in-memory fallback
 * in lib/api/middleware.ts — a limiter outage never blocks
 * legitimate traffic, and a missing store never fails open: when
 * the store is unavailable the request is allowed, never counted
 * as over quota). A durable cross-instance counter table
 * (`api_key_usage`) is defined in migration 035
 * (supabase/migrations/20261110150000_035_api_key_quotas.sql) for
 * future use — that migration is NOT applied and is NOT required
 * for this module to work.
 */

import type { NextRequest } from 'next/server';
import { rateLimited } from '@/lib/api/responses';
import { getClientIp } from '@/lib/api/middleware';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { ValidatedApiKey } from '@/lib/api-keys';
import { getTier, type TierId } from '@/lib/tiers';

/** Canonical pricing page — the billing link used in 429 bodies. */
export const BILLING_URL = '/pricing';

/** Daily cap for anonymous (key-less) callers, per IP. */
export const ANONYMOUS_DAILY_QUOTA = 100;

/** Daily cap per API key, by the key owner's tier. */
export const API_QUOTAS: Record<TierId, number> = {
  free: 1_000,
  premium: 10_000,
  family: 10_000,
  team: 100_000,
};

export function getQuotaForTier(tier: TierId): number {
  return API_QUOTAS[tier];
}

/** Next tier that allows more quota, or null when already highest. */
export function getUpgradeTier(tier: TierId): TierId | null {
  if (tier === 'free') return 'premium';
  if (tier === 'premium' || tier === 'family') return 'team';
  return null;
}

/**
 * Map a `subscriptions` row to a tier. Only an `active` subscription
 * counts — canceled / trialing / past-due rows fall back to free, and
 * unknown plan values fail closed to free (never to a paid tier).
 * Stripe's own plan keys ('pro') map onto the matching tier.
 */
export function resolveTierFromSubscription(
  plan: string | null,
  status: string | null
): TierId {
  if (status !== 'active') return 'free';
  if (plan === 'premium' || plan === 'pro') return 'premium';
  if (plan === 'family') return 'family';
  if (plan === 'team') return 'team';
  return 'free';
}

/**
 * Look up the tier for an API-key owner from their `subscriptions`
 * row. Fail-safe: any error, missing client, or missing row returns
 * 'free' — a lookup failure must never block a request or grant a
 * paid quota.
 */
export async function getTierForUserId(userId: string): Promise<TierId> {
  const service = createSupabaseServiceClient();
  if (!service) return 'free';
  try {
    const { data } = await service
      .from('subscriptions')
      .select('plan, status')
      .eq('user_id', userId)
      .maybeSingle();
    const row = data as { plan?: string | null; status?: string | null } | null;
    if (!row) return 'free';
    return resolveTierFromSubscription(row.plan ?? null, row.status ?? null);
  } catch {
    return 'free';
  }
}

export interface QuotaDecision {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  /** UTC midnight ending the current quota day. */
  resetAt: Date;
  tier: TierId;
}

/** Pure decision from an already-counted usage figure. */
export function checkQuotaDecision(
  used: number,
  limit: number,
  tier: TierId,
  resetAt: Date
): QuotaDecision {
  return {
    allowed: used <= limit,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt,
    tier,
  };
}

/** Start (UTC midnight) of the quota day containing `now`. */
export function quotaDayStart(now: Date = new Date()): Date {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

export interface QuotaStore {
  /**
   * Atomically count one request against `bucketKey` for the quota
   * day containing `now`, then report the decision. Every call
   * increments — including calls that end up over quota.
   */
  checkAndIncrement(bucketKey: string, limit: number, tier: TierId, now?: Date): QuotaDecision;
}

/**
 * In-memory daily store. Buckets are keyed `bucketKey:YYYY-MM-DD`
 * (UTC) and reset when the day rolls over; stale buckets are
 * dropped on access so the map cannot grow without bound.
 */
export function createMemoryQuotaStore(): QuotaStore {
  const counts = new Map<string, { count: number; resetAt: Date }>();

  return {
    checkAndIncrement(bucketKey, limit, tier, now = new Date()) {
      const day = quotaDayStart(now);
      const dayKey = day.toISOString().slice(0, 10);
      const resetAt = new Date(day.getTime() + 24 * 60 * 60 * 1000);
      const mapKey = `${bucketKey}:${dayKey}`;

      let entry = counts.get(mapKey);
      if (!entry) {
        entry = { count: 0, resetAt };
        counts.set(mapKey, entry);
        // Drop yesterday's (and older) buckets for every bucket key.
        for (const key of counts.keys()) {
          if (key !== mapKey && !key.endsWith(dayKey)) counts.delete(key);
        }
      }

      entry.count += 1;
      return checkQuotaDecision(entry.count, limit, tier, entry.resetAt);
    },
  };
}

/** Process-wide store used by the route handlers. */
export const defaultQuotaStore = createMemoryQuotaStore();

/**
 * Honest 429 for a quota breach: names the current tier and limit,
 * the next tier that allows more (when one exists), and the existing
 * pricing page. Never invents a billing URL.
 */
export function quotaExceededResponse(
  decision: QuotaDecision,
  options?: { anonymous?: boolean }
) {
  const tier = getTier(decision.tier);
  const tierName = tier?.name ?? decision.tier;
  const upgradeTier = getUpgradeTier(decision.tier);
  const upgrade = upgradeTier ? getTier(upgradeTier) : null;

  const message = options?.anonymous
    ? `Anonymous API quota exceeded (${decision.limit} requests/day per IP). ` +
      `Create a free API key for ${API_QUOTAS.free.toLocaleString('en-US')} requests/day` +
      (upgrade
        ? `, or upgrade to ${upgrade.name} for ${API_QUOTAS[upgrade.id].toLocaleString('en-US')} requests/day`
        : '') +
      `. See ${BILLING_URL}.`
    : `API quota exceeded for the ${tierName} tier (${decision.limit.toLocaleString('en-US')} requests/day). ` +
      (upgrade
        ? `Upgrade to ${upgrade.name} for ${API_QUOTAS[upgrade.id].toLocaleString('en-US')} requests/day. `
        : `You are on the highest quota tier. `) +
      `See ${BILLING_URL}. Quota resets at ${decision.resetAt.toISOString()}.`;

  return rateLimited(message, {
    tier: decision.tier,
    limit: decision.limit,
    used: decision.used,
    resetAt: decision.resetAt.toISOString(),
    upgradeTier: upgradeTier ?? null,
    billingUrl: BILLING_URL,
  });
}

export interface EnforceApiQuotaOptions {
  /** Validated key from validateApiKey(), or null for anonymous. */
  keyInfo?: ValidatedApiKey | null;
  /** Override for tests; defaults to the process-wide store. */
  store?: QuotaStore;
  /** Override for tests; defaults to getTierForUserId(). */
  resolveTier?: (userId: string) => Promise<TierId>;
  now?: Date;
}

/**
 * Route-handler gate: check + increment the caller's daily quota.
 * Returns a 429 response when the quota is exceeded, else null
 * (request may proceed). Anonymous callers are bucketed per IP at
 * ANONYMOUS_DAILY_QUOTA; keyed callers are bucketed per key prefix
 * at their owner's tier quota. The per-minute rate limit in the
 * routes runs before this gate and is untouched.
 */
export async function enforceApiQuota(
  request: Pick<NextRequest, 'headers'>,
  options: EnforceApiQuotaOptions = {}
): Promise<ReturnType<typeof rateLimited> | null> {
  const store = options.store ?? defaultQuotaStore;
  const { keyInfo = null } = options;

  if (keyInfo) {
    const resolveTier = options.resolveTier ?? getTierForUserId;
    const tier = await resolveTier(keyInfo.userId);
    const decision = store.checkAndIncrement(
      `key:${keyInfo.keyPrefix}`,
      getQuotaForTier(tier),
      tier,
      options.now
    );
    if (!decision.allowed) return quotaExceededResponse(decision);
    return null;
  }

  const decision = store.checkAndIncrement(
    `anon:${getClientIp(request as NextRequest)}`,
    ANONYMOUS_DAILY_QUOTA,
    'free',
    options.now
  );
  if (!decision.allowed) {
    return quotaExceededResponse(decision, { anonymous: true });
  }
  return null;
}
