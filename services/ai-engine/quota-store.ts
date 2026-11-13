/**
 * Section 21–25, Stage J, J-P2-6 — shared AI quota counters.
 *
 * The problem: the AI quotas in `services/ai-engine/usage.ts`
 * (300 AI calls/day/user, SerpAPI 5/day, HF 50/day) are
 * per-instance in-memory Maps. Vercel spreads requests across
 * instances, so the same user (or the same global provider
 * budget) gets a fresh counter on every instance — the quotas
 * are bypassable by fanning requests across instances.
 *
 * The fix, in two layers:
 *   1. THIS module — a shared counter backend on Upstash Redis
 *      (the same client `lib/api/rate-limit.ts` already uses;
 *      INCR a per-UTC-date key, TTL to UTC midnight on first
 *      use — the same pattern as `services/ebay-budget.ts`).
 *      It activates ONLY when Upstash is confirmed configured
 *      (`isSharedAiQuotaConfigured()`); until then every function
 *      here returns null and the caller falls back to the
 *      in-memory counters. A Redis error at request time also
 *      returns null — fail-open to memory, never fail-closed.
 *   2. The async wrappers in `usage.ts`
 *      (`checkAiUserQuotaAsync`, `spendProviderBudgetAsync`,
 *      `isProviderBudgetExhaustedAsync`,
 *      `getProviderBudgetStateAsync`, `getAiUsageSummaryAsync`)
 *      try the shared counter first and fall back to memory.
 *      All AI routes/services call the async wrappers.
 *
 * Honest status: the bypass is CLOSED only when Upstash is
 * confirmed configured in Vercel (owner-gated — the repo cannot
 * verify the live env vars). Until then the in-memory counters
 * stay, with this documented limitation. No caller may claim the
 * quotas are shared while `isSharedAiQuotaConfigured()` is false.
 *
 * Check-then-reserve: a call at/over the cap is denied WITHOUT
 * incrementing, so denied calls never consume budget. (The
 * read-then-INCR race can overshoot the cap by the number of
 * concurrent callers in the same instant — the same accepted race
 * as the eBay budget; the caps are guardrails, not hard billing
 * limits.)
 */

import { logger } from '@/lib/config/logger';
import { getRedisClient } from '@/lib/api/rate-limit';

/** Minimal Redis surface this module uses (injectable for tests). */
export interface AiQuotaRedis {
  get(key: string): Promise<string | number | null>;
  incr(key: string): Promise<number>;
  expireat(key: string, unixSeconds: number): Promise<unknown>;
}

export const AI_QUOTA_REDIS_PREFIX = 'sb-ai-quota';

/** True only when Upstash is confirmed configured. */
export function isSharedAiQuotaConfigured(redis?: AiQuotaRedis | null): boolean {
  return (redis ?? getRedisClient()) !== null;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.floor((midnight - now.getTime()) / 1000));
}

function userKey(userId: string, day: string): string {
  return `${AI_QUOTA_REDIS_PREFIX}:user:${userId}:${day}`;
}

function providerKey(providerKey: string, day: string): string {
  return `${AI_QUOTA_REDIS_PREFIX}:provider:${providerKey}:${day}`;
}

async function readCount(redis: AiQuotaRedis, key: string): Promise<number | null> {
  const raw = await redis.get(key);
  if (raw === null || raw === undefined) return 0;
  const used = typeof raw === 'number' ? raw : Number.parseInt(raw, 10);
  return Number.isFinite(used) ? used : null;
}

async function incrWithMidnightExpiry(
  redis: AiQuotaRedis,
  key: string,
  now: Date
): Promise<number> {
  const used = await redis.incr(key);
  if (used === 1) {
    await redis.expireat(key, Math.floor(now.getTime() / 1000) + secondsUntilUtcMidnight(now));
  }
  return used;
}

export interface SharedQuotaCheck {
  allowed: boolean;
  used: number;
  remaining: number;
}

/**
 * Shared per-user daily quota check-and-increment. Returns null
 * when Upstash is unconfigured or Redis errors (caller falls back
 * to the in-memory counter). Denied calls do NOT increment.
 */
export async function checkSharedUserQuota(
  userId: string,
  dailyQuota: number,
  redis?: AiQuotaRedis | null,
  now: Date = new Date()
): Promise<SharedQuotaCheck | null> {
  const client = redis ?? getRedisClient();
  if (!client) return null;
  try {
    const key = userKey(userId, utcDay());
    const used = await readCount(client as AiQuotaRedis, key);
    if (used === null) return null;
    if (used >= dailyQuota) {
      return { allowed: false, used, remaining: 0 };
    }
    const after = await incrWithMidnightExpiry(client as AiQuotaRedis, key, now);
    return { allowed: true, used: after, remaining: Math.max(0, dailyQuota - after) };
  } catch (err) {
    logger.warn('ai-quota: shared user-quota check failed, falling back to in-memory', {
      error: String(err),
    });
    return null;
  }
}

export interface SharedProviderBudget {
  used: number;
  budget: number;
  remaining: number;
  exhausted: boolean;
}

/**
 * Read the shared daily spend for one provider. Returns null when
 * Upstash is unconfigured or Redis errors (caller falls back to
 * the in-memory counter).
 */
export async function readSharedProviderBudget(
  providerKeyName: string,
  budget: number,
  redis?: AiQuotaRedis | null
): Promise<SharedProviderBudget | null> {
  const client = redis ?? getRedisClient();
  if (!client) return null;
  try {
    const used = await readCount(client as AiQuotaRedis, providerKey(providerKeyName, utcDay()));
    if (used === null) return null;
    return {
      used,
      budget,
      remaining: Math.max(0, budget - used),
      exhausted: used >= budget,
    };
  } catch (err) {
    logger.warn('ai-quota: shared provider-budget read failed, falling back to in-memory', {
      error: String(err),
    });
    return null;
  }
}

/**
 * Spend one unit of a provider's shared daily budget. Returns
 * false (spending nothing) when the budget is already exhausted,
 * true when the unit was spent, null when Upstash is unconfigured
 * or Redis errors (caller falls back to the in-memory counter).
 */
export async function spendSharedProviderBudget(
  providerKeyName: string,
  budget: number,
  redis?: AiQuotaRedis | null,
  now: Date = new Date()
): Promise<boolean | null> {
  const client = redis ?? getRedisClient();
  if (!client) return null;
  try {
    const key = providerKey(providerKeyName, utcDay());
    const used = await readCount(client as AiQuotaRedis, key);
    if (used === null) return null;
    if (used >= budget) return false;
    await incrWithMidnightExpiry(client as AiQuotaRedis, key, now);
    return true;
  } catch (err) {
    logger.warn('ai-quota: shared provider-budget spend failed, falling back to in-memory', {
      error: String(err),
    });
    return null;
  }
}
