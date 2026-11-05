/**
 * Distributed rate limiting (Upstash Redis, REST).
 *
 * The in-memory bucket in lib/api/middleware.ts is per server
 * instance, and Vercel spreads requests across instances — a live
 * burst test proved it: 31 rapid calls, 0 × 429. Upstash Redis
 * (free tier, REST — no persistent connection, serverless-safe)
 * gives all instances ONE shared sliding-window counter.
 *
 * Behaviour is fail-open to the in-memory bucket, never fail-closed:
 * - Upstash env vars unset → this module reports "not configured"
 *   and the caller uses the in-memory bucket.
 * - Redis reachable → shared sliding-window check.
 * - Redis errors at request time → the caller catches and falls
 *   back to in-memory, so a limiter outage never blocks legitimate
 *   traffic.
 *
 * No request data is stored beyond the counter keys
 * (`sb-ratelimit:<identifier>`); no IPs are logged by this module.
 */

import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { env } from '@/lib/config/env';

let redisClient: Redis | null | undefined;
let redisChecked = false;

/** The shared Redis client, or null when Upstash is not configured. */
export function getRedisClient(): Redis | null {
  if (!redisChecked) {
    redisChecked = true;
    redisClient =
      env.upstashRedisRestUrl && env.upstashRedisRestToken
        ? new Redis({ url: env.upstashRedisRestUrl, token: env.upstashRedisRestToken })
        : null;
  }
  return redisClient ?? null;
}

export function isRedisRateLimitConfigured(): boolean {
  return getRedisClient() !== null;
}

/** Convert a window in milliseconds to an Upstash duration string. */
export function windowMsToDuration(windowMs: number): Duration {
  const seconds = Math.max(1, Math.round(windowMs / 1000));
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} m`;
  return `${seconds} s`;
}

const limiters = new Map<string, Ratelimit>();

function getLimiter(maxRequests: number, windowMs: number): Ratelimit | null {
  const redis = getRedisClient();
  if (!redis) return null;
  const key = `${maxRequests}:${windowMs}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(maxRequests, windowMsToDuration(windowMs)),
      analytics: false,
      prefix: 'sb-ratelimit',
    });
    limiters.set(key, limiter);
  }
  return limiter;
}

/**
 * Shared sliding-window check. Returns null when Upstash is not
 * configured (caller falls back to in-memory). Throws on a Redis
 * error — the caller must catch and fall back, never fail closed.
 */
export async function checkRateLimitDistributed(
  identifier: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number } | null> {
  const limiter = getLimiter(maxRequests, windowMs);
  if (!limiter) return null;
  const result = await limiter.limit(identifier);
  return {
    allowed: result.success,
    remaining: result.remaining,
    resetAt: result.reset,
  };
}
