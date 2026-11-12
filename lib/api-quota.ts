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
 * Storage: quota state is checked AND incremented per request.
 * The default store is durable-first (Section 15 P2-6): it tries
 * the `api_key_usage` ledger (migration 035,
 * supabase/migrations/20261110150000_035_api_key_quotas.sql) via
 * the service-role client, and fails open to the in-memory daily
 * store on ANY database error — including the table not existing
 * yet, because migration 035 is NOT applied and is NOT required
 * for the paywall to function. Once the owner applies 035 the
 * same code becomes durable across instances with no code change.
 * The in-memory store is the same pattern as the in-memory
 * fallback in lib/api/middleware.ts — a limiter outage never
 * blocks legitimate traffic, and a missing store never fails
 * open: when the store is unavailable the request is allowed,
 * never counted as over quota. Buckets are keyed by the SHA-256
 * hash of the bucket key (the ledger stores hashes only, never
 * raw key prefixes or IPs).
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { rateLimited } from '@/lib/api/responses';
import { getClientIp } from '@/lib/api/middleware';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/config/logger';
import type { ValidatedApiKey } from '@/lib/api-keys';
import { getTier, normalizeTierId, type TierId } from '@/lib/tiers';

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
 * The legacy Stripe plan key 'pro' maps onto the matching tier
 * (see normalizeTierId in lib/tiers.ts, Section 15 P2-2).
 */
export function resolveTierFromSubscription(
  plan: string | null,
  status: string | null
): TierId {
  if (status !== 'active') return 'free';
  return normalizeTierId(plan);
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
   * increments — including calls that end up over quota. Async
   * (Section 15 P2-6) so the durable store can hit the database;
   * the in-memory store resolves immediately.
   */
  checkAndIncrement(bucketKey: string, limit: number, tier: TierId, now?: Date): Promise<QuotaDecision>;
}

/**
 * In-memory daily store. Buckets are keyed `bucketKey:YYYY-MM-DD`
 * (UTC) and reset when the day rolls over; stale buckets are
 * dropped on access so the map cannot grow without bound.
 */
export function createMemoryQuotaStore(): QuotaStore {
  const counts = new Map<string, { count: number; resetAt: Date }>();

  return {
    async checkAndIncrement(bucketKey, limit, tier, now = new Date()) {
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
export const defaultQuotaStore = createDurableQuotaStore();

export interface DurableQuotaStoreOptions {
  /**
   * In-memory fallback used when the database write fails (or the
   * service client / table is unavailable). Defaults to a fresh
   * in-memory store — the pre-P2-6 behaviour, preserved exactly.
   */
  fallback?: QuotaStore;
  /**
   * Service-role client override. Defaults to
   * createSupabaseServiceClient(); pass `null` explicitly to force
   * the memory fallback (tests). When omitted AND no service key
   * is configured, the store is memory-only.
   */
  serviceClient?: SupabaseClient | null;
}

/**
 * Durable quota store (Section 15 P2-6, CODE part only — applying
 * migration 035 is owner-gated, never apply it here).
 *
 * Counts one request in the `api_key_usage` ledger (one row per
 * bucket-key hash per UTC day) via the service-role client — the
 * table has no RLS policy for anon/authenticated, so only the
 * service client can write it. Section 18, item 20: the increment
 * first tries the atomic RPC `increment_api_key_usage` (migration
 * 053, single-statement INSERT … ON CONFLICT DO UPDATE); when
 * the function is not applied yet the code falls back to the
 * read-then-write path below with a single conflict retry: a
 * concurrent first-write for the same bucket surfaces as a
 * primary-key conflict (23505) on insert, which retries as an
 * update.
 *
 * FAIL-OPEN: any database error — no service key, table missing
 * (035 not applied yet), network error — falls back to the
 * in-memory store for that call, so quota enforcement degrades to
 * today's behaviour instead of blocking traffic. The fallback is
 * logged once per process to avoid log spam.
 */
export function createDurableQuotaStore(
  options: DurableQuotaStoreOptions = {}
): QuotaStore {
  const fallback = options.fallback ?? createMemoryQuotaStore();
  let warned = false;

  function warnOnce(message: string, error?: unknown) {
    if (warned) return;
    warned = true;
    logger.warn(message, error !== undefined ? { error: String(error) } : undefined);
  }

  return {
    async checkAndIncrement(bucketKey, limit, tier, now = new Date()) {
      const service =
        options.serviceClient !== undefined
          ? options.serviceClient
          : createSupabaseServiceClient();
      if (!service) {
        warnOnce('Durable quota store unavailable (no service-role client); using in-memory quota store');
        return fallback.checkAndIncrement(bucketKey, limit, tier, now);
      }

      const day = quotaDayStart(now);
      const dayKey = day.toISOString().slice(0, 10);
      const resetAt = new Date(day.getTime() + 24 * 60 * 60 * 1000);
      // The ledger stores hashes only — never the raw key prefix/IP.
      const keyHash = createHash('sha256').update(bucketKey).digest('hex');

      try {
        // Section 18, item 20 — atomic increment (migration 053):
        // one INSERT … ON CONFLICT DO UPDATE inside Postgres, so
        // concurrent increments serialize instead of lost-updating
        // (both read N, both write N + 1). The RPC is called only
        // when the function exists: a missing function (053 not
        // applied yet — 42883 / PGRST202), a client without .rpc,
        // or any other RPC error falls through to the legacy
        // read-modify-write path below, never to the memory
        // fallback directly. The legacy path is the pre-Section-18
        // behaviour, preserved exactly.
        if (typeof service.rpc === 'function') {
          const { data: rpcCount, error: rpcError } = await service.rpc(
            'increment_api_key_usage',
            { p_key_hash: keyHash, p_window_date: dayKey, p_tier: tier }
          );
          if (!rpcError && typeof rpcCount === 'number') {
            return checkQuotaDecision(rpcCount, limit, tier, resetAt);
          }
        }

        const { data, error: readError } = await service
          .from('api_key_usage')
          .select('request_count')
          .eq('key_hash', keyHash)
          .eq('window_date', dayKey)
          .maybeSingle();
        if (readError) throw readError;

        const existing = data as { request_count?: number | null } | null;
        let count: number;
        if (existing) {
          count = (existing.request_count ?? 0) + 1;
          const { error: updateError } = await service
            .from('api_key_usage')
            .update({ request_count: count, tier, updated_at: new Date().toISOString() })
            .eq('key_hash', keyHash)
            .eq('window_date', dayKey);
          if (updateError) throw updateError;
        } else {
          count = 1;
          const { error: insertError } = await service.from('api_key_usage').insert({
            key_hash: keyHash,
            window_date: dayKey,
            request_count: 1,
            tier,
          });
          if (insertError) {
            // Concurrent first write for this bucket: the row now
            // exists — retry once as an update instead of failing.
            if ((insertError as { code?: string }).code === '23505') {
              const { data: retry, error: retryReadError } = await service
                .from('api_key_usage')
                .select('request_count')
                .eq('key_hash', keyHash)
                .eq('window_date', dayKey)
                .maybeSingle();
              if (retryReadError) throw retryReadError;
              const retryRow = retry as { request_count?: number | null } | null;
              count = (retryRow?.request_count ?? 0) + 1;
              const { error: retryUpdateError } = await service
                .from('api_key_usage')
                .update({ request_count: count, tier, updated_at: new Date().toISOString() })
                .eq('key_hash', keyHash)
                .eq('window_date', dayKey);
              if (retryUpdateError) throw retryUpdateError;
            } else {
              throw insertError;
            }
          }
        }
        return checkQuotaDecision(count, limit, tier, resetAt);
      } catch (err) {
        warnOnce(
          'Durable quota write failed (migration 035 may not be applied yet); using in-memory quota store',
          err
        );
        return fallback.checkAndIncrement(bucketKey, limit, tier, now);
      }
    },
  };
}

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
    const decision = await store.checkAndIncrement(
      `key:${keyInfo.keyPrefix}`,
      getQuotaForTier(tier),
      tier,
      options.now
    );
    if (!decision.allowed) return quotaExceededResponse(decision);
    return null;
  }

  const decision = await store.checkAndIncrement(
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
