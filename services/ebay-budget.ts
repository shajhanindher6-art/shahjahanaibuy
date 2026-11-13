/**
 * Section 15, P3-5 — eBay daily-budget guard (SERVER-ONLY).
 *
 * The public search route's 30/min/IP limit does NOT protect the
 * 5,000/day free tier: one IP burns it in ~167 minutes, ten IPs in
 * ~17. Every eBay Browse call — public search, admin preview,
 * refresh — must reserve one call from a GLOBAL daily counter
 * first. The cap is 4,500 (90% of the 5,000 free tier): a deliberate
 * design choice, labelled here so the headroom is visible — the
 * remaining 500 absorb the check-then-reserve race (two callers
 * reading the same count at the same instant) and denied-call
 * retries. At the cap every caller answers honestly ("eBay daily
 * budget used — try tomorrow") and falls back to the catalog +
 * search links; no caller ever retries past the cap.
 *
 * Backends, in order:
 *   1. Upstash Redis (when UPSTASH_REDIS_REST_URL + TOKEN are set —
 *      the same client lib/api/rate-limit.ts already uses): INCR a
 *      per-UTC-date key, TTL to UTC midnight on first use.
 *   2. DB counter (migration 041, table ebay_daily_usage — one row
 *      per UTC date, service-role writes only, NO anon policy):
 *      used only when Redis is not configured, or when a Redis call
 *      throws. One row per call is NOT stored; the row's `calls`
 *      counter is incremented with an optimistic-concurrency retry
 *      (update … where calls = <read value>, retry on no rows).
 *   3. Fail-open (no Redis, no DB — table unapplied or service
 *      client unavailable): the call is ALLOWED and a warning is
 *      logged. The budget guard must never block the product when
 *      its own storage is down; the per-IP rate limit still applies.
 *      This matches the repo's rate-limit fail-open precedent.
 *
 * Check-then-reserve: the current count is read first, and a call
 * at/over the cap is denied WITHOUT incrementing, so denied calls
 * never consume budget. A reservation is spent when the call is
 * made — and REFUNDED when the call ultimately fails
 * (`refundEbayDailyCall`, Sections 21–25 Stage D): a failed eBay
 * call must not consume daily budget. The refund is best-effort
 * (a failed refund only logs); a call that reached eBay and then
 * failed server-side may still have been counted by eBay, so the
 * refund can under-count against eBay's own meter — the cap's
 * 500-call headroom absorbs that, and refunding a known failure
 * is strictly more honest than charging for it.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { getRedisClient } from '@/lib/api/rate-limit';

/** 90% of the 5,000/day free tier — see the header comment. */
export const EBAY_DAILY_BUDGET_CAP = 4_500;

export const EBAY_BUDGET_REDIS_PREFIX = 'sb-ebay-daily';

const DB_TABLE = 'ebay_daily_usage';

/** Minimal Redis surface this module uses (injectable for tests). */
export interface EbayBudgetRedis {
  get(key: string): Promise<string | number | null>;
  incr(key: string): Promise<number>;
  expireat(key: string, unixSeconds: number): Promise<unknown>;
  /**
   * Sections 21–25, Stage D — decrement for the failure refund
   * (`refundEbayDailyCall`). Optional: older fakes / minimal
   * clients without it report the refund as unsupported instead
   * of failing. The real Upstash client has DECR.
   */
  decr?(key: string): Promise<number>;
}

export type EbayBudgetBackend = 'redis' | 'db' | 'unavailable';

export interface EbayBudgetResult {
  /** False only when the daily cap is already reached. */
  allowed: boolean;
  /** Calls already spent today, or null when the counter is unavailable. */
  used: number | null;
  /** Calls left today, or null when the counter is unavailable. */
  remaining: number | null;
  limit: number;
  backend: EbayBudgetBackend;
  /** UTC date the counter belongs to (`YYYY-MM-DD`). */
  dateKey: string;
}

/** UTC date key for the counter (`YYYY-MM-DD`). */
export function getEbayBudgetDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Seconds from `now` until the next UTC midnight (for the Redis TTL). */
export function getSecondsUntilUtcMidnight(now: Date): number {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  );
  return Math.max(1, Math.floor((midnight - now.getTime()) / 1000));
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205';
}

async function reserveViaRedis(
  redis: EbayBudgetRedis,
  dateKey: string,
  now: Date
): Promise<{ used: number; spent: boolean } | null> {
  const key = `${EBAY_BUDGET_REDIS_PREFIX}:${dateKey}`;
  const currentRaw = await redis.get(key);
  const current =
    typeof currentRaw === 'string'
      ? Number.parseInt(currentRaw, 10)
      : typeof currentRaw === 'number'
        ? currentRaw
        : 0;
  if (Number.isFinite(current) && current >= EBAY_DAILY_BUDGET_CAP) {
    // At the cap: deny WITHOUT spending — a denied call must
    // never consume budget.
    return { used: current, spent: false };
  }
  const used = await redis.incr(key);
  if (used === 1) {
    // First call of the day: expire the key at UTC midnight so
    // tomorrow starts at zero without a cleanup job.
    const ttl = getSecondsUntilUtcMidnight(now);
    await redis.expireat(
      key,
      Math.floor(now.getTime() / 1000) + ttl
    );
  }
  return { used, spent: true };
}

async function readViaRedis(
  redis: EbayBudgetRedis,
  dateKey: string
): Promise<number | null> {
  const raw = await redis.get(
    `${EBAY_BUDGET_REDIS_PREFIX}:${dateKey}`
  );
  if (raw === null || raw === undefined) return 0;
  const used = typeof raw === 'number' ? raw : Number.parseInt(raw, 10);
  return Number.isFinite(used) ? used : null;
}

async function reserveViaDb(
  supabase: AnySupabaseClient,
  dateKey: string,
  now: Date
): Promise<{ used: number; spent: boolean } | null> {
  // Optimistic-concurrency increment, up to 3 attempts: read the
  // row, then update only where `calls` still equals the read
  // value. A concurrent increment makes the update match zero
  // rows, and the retry re-reads. An insert race (two callers
  // creating the first row of the day) surfaces as 23505 and is
  // retried the same way.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from(DB_TABLE)
      .select('calls')
      .eq('usage_date', dateKey)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) {
        logger.warn(
          'ebay-budget: ebay_daily_usage missing (migration 041 not applied) — budget counter unavailable'
        );
      } else {
        logger.warn('ebay-budget: DB counter read failed', {
          error: error.message,
        });
      }
      return null;
    }
    const row = data as { calls?: number } | null;
    if (!row) {
      const { error: insertError } = await supabase
        .from(DB_TABLE)
        .insert({ usage_date: dateKey, calls: 1 });
      if (!insertError) return { used: 1, spent: true };
      if (insertError.code === '23505') continue;
      if (isMissingTableError(insertError)) {
        logger.warn(
          'ebay-budget: ebay_daily_usage missing (migration 041 not applied) — budget counter unavailable'
        );
      } else {
        logger.warn('ebay-budget: DB counter insert failed', {
          error: insertError.message,
        });
      }
      return null;
    }
    const current = typeof row.calls === 'number' ? row.calls : 0;
    if (current >= EBAY_DAILY_BUDGET_CAP) return { used: current, spent: false };
    const { data: updated, error: updateError } = await supabase
      .from(DB_TABLE)
      .update({ calls: current + 1, updated_at: now.toISOString() })
      .eq('usage_date', dateKey)
      .eq('calls', current)
      .select('calls');
    if (updateError) {
      logger.warn('ebay-budget: DB counter update failed', {
        error: updateError.message,
      });
      return null;
    }
    if (Array.isArray(updated) && updated.length > 0) {
      return { used: current + 1, spent: true };
    }
    // Zero rows updated: another caller incremented first. Retry.
  }
  logger.warn('ebay-budget: DB counter increment raced 3 times — allowing call');
  return null;
}

async function readViaDb(
  supabase: AnySupabaseClient,
  dateKey: string
): Promise<number | null> {
  const { data, error } = await supabase
    .from(DB_TABLE)
    .select('calls')
    .eq('usage_date', dateKey)
    .maybeSingle();
  if (error || !data) return error ? null : 0;
  const calls = (data as { calls?: number }).calls;
  return typeof calls === 'number' ? calls : null;
}

/**
 * Reserve one eBay Browse call from the global daily budget.
 * Returns `allowed: false` (without spending) when the cap is
 * reached. Never throws: on any storage failure it fails open
 * with backend 'unavailable' and logs a warning.
 */
export async function reserveEbayDailyCall(
  supabase: AnySupabaseClient | null,
  options?: { redis?: EbayBudgetRedis | null; now?: Date }
): Promise<EbayBudgetResult> {
  const now = options?.now ?? new Date();
  const dateKey = getEbayBudgetDateKey(now);
  const limit = EBAY_DAILY_BUDGET_CAP;

  const injected = options?.redis;
  const redis =
    injected !== undefined
      ? injected
      : (() => {
          try {
            return getRedisClient() as EbayBudgetRedis | null;
          } catch {
            return null;
          }
        })();

  if (redis) {
    try {
      const reserved = await reserveViaRedis(redis, dateKey, now);
      if (reserved) {
        const used = reserved.used;
        // A spent reservation is allowed while the count stays
        // within the cap; a reservation refused at the cap
        // (spent: false) is denied even though used === cap.
        const allowed = reserved.spent ? used <= limit : false;
        return {
          allowed,
          used,
          remaining: Math.max(0, limit - used),
          limit,
          backend: 'redis',
          dateKey,
        };
      }
    } catch (err) {
      logger.warn('ebay-budget: Redis reserve failed — falling back to DB counter', {
        error: String(err),
      });
    }
  }

  if (supabase) {
    const reserved = await reserveViaDb(supabase, dateKey, now);
    if (reserved) {
      const used = reserved.used;
      const allowed = reserved.spent ? used <= limit : false;
      return {
        allowed,
        used,
        remaining: Math.max(0, limit - used),
        limit,
        backend: 'db',
        dateKey,
      };
    }
  }

  // No counter available (Redis unconfigured + DB table unapplied
  // or unreachable): fail open, never block the call.
  logger.warn(
    'ebay-budget: no daily counter available — allowing eBay call uncounted'
  );
  return {
    allowed: true,
    used: null,
    remaining: null,
    limit,
    backend: 'unavailable',
    dateKey,
  };
}

export interface EbayBudgetRefundResult {
  /** True when the counter was actually decremented. */
  refunded: boolean;
  /** Calls spent today after the refund (null when the counter is unavailable). */
  used: number | null;
  /** Why a refund did not happen. */
  reason?: 'no-reservation' | 'unsupported' | 'unavailable' | 'failed';
  backend: EbayBudgetBackend;
  dateKey: string;
}

async function refundViaRedis(
  redis: EbayBudgetRedis,
  dateKey: string,
  units: number
): Promise<{ used: number | null; refunded: boolean; reason?: 'unsupported' | 'failed' }> {
  if (typeof redis.decr !== 'function') {
    return { used: null, refunded: false, reason: 'unsupported' };
  }
  const key = `${EBAY_BUDGET_REDIS_PREFIX}:${dateKey}`;
  try {
    const currentRaw = await redis.get(key);
    const current =
      typeof currentRaw === 'string'
        ? Number.parseInt(currentRaw, 10)
        : typeof currentRaw === 'number'
          ? currentRaw
          : 0;
    if (!Number.isFinite(current) || current <= 0) {
      return { used: Number.isFinite(current) ? current : 0, refunded: false };
    }
    let used = current;
    for (let i = 0; i < units; i++) {
      used = await redis.decr(key);
      if (used < 0) {
        // Never let a refund drive the counter below zero.
        await redis.incr(key);
        used = 0;
        break;
      }
    }
    return { used, refunded: true };
  } catch (err) {
    logger.warn('ebay-budget: Redis refund failed', { error: String(err) });
    return { used: null, refunded: false, reason: 'failed' };
  }
}

async function refundViaDb(
  supabase: AnySupabaseClient,
  dateKey: string,
  units: number
): Promise<{ used: number | null; refunded: boolean; reason?: 'failed' }> {
  // Optimistic-concurrency decrement with a floor of 0, mirroring
  // reserveViaDb's retry shape (3 attempts, update where calls
  // still equals the read value).
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from(DB_TABLE)
      .select('calls')
      .eq('usage_date', dateKey)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) {
        logger.warn(
          'ebay-budget: ebay_daily_usage missing (migration 041 not applied) — budget refund unavailable'
        );
      } else {
        logger.warn('ebay-budget: DB refund read failed', { error: error.message });
      }
      return { used: null, refunded: false, reason: 'failed' };
    }
    const row = data as { calls?: number } | null;
    const current = row && typeof row.calls === 'number' ? row.calls : 0;
    if (current <= 0) return { used: 0, refunded: false };
    const next = Math.max(0, current - units);
    const { data: updated, error: updateError } = await supabase
      .from(DB_TABLE)
      .update({ calls: next, updated_at: new Date().toISOString() })
      .eq('usage_date', dateKey)
      .eq('calls', current)
      .select('calls');
    if (updateError) {
      logger.warn('ebay-budget: DB refund update failed', { error: updateError.message });
      return { used: null, refunded: false, reason: 'failed' };
    }
    if (Array.isArray(updated) && updated.length > 0) {
      return { used: next, refunded: true };
    }
    // Zero rows updated: another caller moved the counter. Retry.
  }
  logger.warn('ebay-budget: DB refund raced 3 times — refund not applied');
  return { used: null, refunded: false, reason: 'failed' };
}

/**
 * Sections 21–25, Stage D — refund `units` reserved calls after
 * the eBay call(s) they paid for ultimately failed. A failed call
 * must not consume daily budget: before this fix every reservation
 * was spent even when the following eBay call failed. Best-effort
 * and never throwing: a refund that cannot be applied (no counter,
 * no DECR support, missing table) is reported, never retried past
 * the cap, and never blocks the caller. `units` is the number of
 * reservations spent on the failed attempts (up to 3 per product
 * in the refresh leg); it is clamped to the current count, so a
 * refund can never drive the counter below zero.
 */
export async function refundEbayDailyCall(
  supabase: AnySupabaseClient | null,
  options?: { redis?: EbayBudgetRedis | null; now?: Date; units?: number }
): Promise<EbayBudgetRefundResult> {
  const now = options?.now ?? new Date();
  const dateKey = getEbayBudgetDateKey(now);
  const units = Math.max(0, Math.floor(options?.units ?? 1));
  if (units === 0) {
    return { refunded: false, used: null, reason: 'no-reservation', backend: 'unavailable', dateKey };
  }

  const injected = options?.redis;
  const redis =
    injected !== undefined
      ? injected
      : (() => {
          try {
            return getRedisClient() as EbayBudgetRedis | null;
          } catch {
            return null;
          }
        })();

  if (redis) {
    try {
      const refunded = await refundViaRedis(redis, dateKey, units);
      if (refunded.refunded || refunded.reason === 'unsupported') {
        return {
          refunded: refunded.refunded,
          used: refunded.used,
          ...(refunded.reason ? { reason: refunded.reason } : {}),
          backend: 'redis',
          dateKey,
        };
      }
      // A failed Redis refund falls through to the DB counter
      // only when the Redis call itself errored (reason
      // 'failed'); an empty counter (used 0) is a final answer.
      if (refunded.used !== null) {
        return {
          refunded: false,
          used: refunded.used,
          reason: 'no-reservation',
          backend: 'redis',
          dateKey,
        };
      }
    } catch (err) {
      logger.warn('ebay-budget: Redis refund failed — falling back to DB counter', {
        error: String(err),
      });
    }
  }

  if (supabase) {
    try {
      const refunded = await refundViaDb(supabase, dateKey, units);
      return {
        refunded: refunded.refunded,
        used: refunded.used,
        ...(refunded.reason ? { reason: refunded.reason } : {}),
        backend: 'db',
        dateKey,
      };
    } catch (err) {
      // A refund must never throw: the caller already failed, and
      // a throwing refund would turn a counted failure into a crash.
      logger.warn('ebay-budget: DB refund threw', { error: String(err) });
      return { refunded: false, used: null, reason: 'failed', backend: 'db', dateKey };
    }
  }

  return { refunded: false, used: null, reason: 'unavailable', backend: 'unavailable', dateKey };
}

/**
 * Read-only remaining budget (for the admin UI). Never reserves,
 * never throws: `used`/`remaining` are null when the counter is
 * unavailable.
 */
export async function getEbayDailyBudget(
  supabase: AnySupabaseClient | null,
  options?: { redis?: EbayBudgetRedis | null; now?: Date }
): Promise<EbayBudgetResult> {
  const now = options?.now ?? new Date();
  const dateKey = getEbayBudgetDateKey(now);
  const limit = EBAY_DAILY_BUDGET_CAP;

  const injected = options?.redis;
  const redis =
    injected !== undefined
      ? injected
      : (() => {
          try {
            return getRedisClient() as EbayBudgetRedis | null;
          } catch {
            return null;
          }
        })();

  if (redis) {
    try {
      const used = await readViaRedis(redis, dateKey);
      if (used !== null) {
        return {
          allowed: used < limit,
          used,
          remaining: Math.max(0, limit - used),
          limit,
          backend: 'redis',
          dateKey,
        };
      }
    } catch (err) {
      logger.warn('ebay-budget: Redis read failed — falling back to DB counter', {
        error: String(err),
      });
    }
  }

  if (supabase) {
    const used = await readViaDb(supabase, dateKey);
    if (used !== null) {
      return {
        allowed: used < limit,
        used,
        remaining: Math.max(0, limit - used),
        limit,
        backend: 'db',
        dateKey,
      };
    }
  }

  return {
    allowed: true,
    used: null,
    remaining: null,
    limit,
    backend: 'unavailable',
    dateKey,
  };
}
