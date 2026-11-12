/**
 * API middleware utilities for route handlers.
 * Provides authentication checking, logging, and rate-limiting architecture.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/config/logger';
import { getRequestId } from './request-id';
import { isAdminRoleRow, PROFILE_ROLE_SELECT } from '@/lib/admin-role';
import { unauthorized, forbidden, internalError, rateLimited } from './responses';
import { checkRateLimitDistributed } from './rate-limit';
import type { NextRequest } from 'next/server';

/**
 * Requires an authenticated session for a route handler.
 * Returns the user ID on success, or an error response on failure.
 */
export async function requireAuth(request: NextRequest): Promise<
  { userId: string } | { error: ReturnType<typeof unauthorized> }
> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: unauthorized('Authentication required') };
    }

    return { userId: user.id };
  } catch {
    logger.error('requireAuth failed', { path: request.nextUrl.pathname });
    return { error: internalError('Authentication check failed') };
  }
}

/**
 * Requires an authenticated session AND role === 'admin'.
 * The role is resolved via `role_id → roles.name` (see
 * `lib/admin-role.ts`) — the `profiles` table has NO `role` column
 * in the migration chain (only `role_id` FK), so selecting `role`
 * errored and every admin route failed closed (Section 17, Stage H,
 * item 7; audit §4 #1). The lookup runs via the service-role client
 * (RLS would otherwise hide other users' rows but must never be the
 * only enforcement). Fail closed: no session, no service client, no
 * profile, or a non-admin role all return an error response — never
 * the user ID.
 */
export async function requireAdmin(request: NextRequest): Promise<
  { userId: string } | { error: ReturnType<typeof unauthorized> | ReturnType<typeof forbidden> | ReturnType<typeof internalError> }
> {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth;

  const service = createSupabaseServiceClient();
  if (!service) {
    logger.error('requireAdmin failed: service client unavailable', { path: request.nextUrl.pathname });
    return { error: internalError('Admin check unavailable') };
  }

  const { data: profile } = await service
    .from('profiles')
    .select(PROFILE_ROLE_SELECT)
    .eq('id', auth.userId)
    .single();
  if (!isAdminRoleRow(profile as { roles?: { name?: string | null } } | null)) {
    return { error: forbidden('Admin access required') };
  }

  return { userId: auth.userId };
}

/**
 * Best-effort client IP for rate-limit buckets. Prefer `x-real-ip`:
 * Vercel sets it to the true connecting client IP. The first
 * `x-forwarded-for` entry must NOT be trusted — any client can forge
 * it (e.g. `X-Forwarded-For: 1.2.3.4`), which let an attacker rotate
 * a fresh rate-limit bucket per request. It is only a fallback for
 * non-Vercel environments (local dev). Either way this is a bucket
 * key for abuse control, never an identity proof.
 */
export function getClientIp(request: NextRequest): string {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim();
  return ip || 'unknown';
}

/**
 * Logs API requests with structured metadata.
 * In production, this would forward to a logging service.
 */
export function logApiRequest(request: NextRequest, metadata?: Record<string, unknown>) {
  logger.info('API request', {
    method: request.method,
    path: request.nextUrl.pathname,
    requestId: getRequestId(request),
    ...metadata,
  });
}

/**
 * Rate limiting: in-memory token bucket per IP address.
 * This is the FALLBACK. The shared path is Redis (Upstash, see
 * lib/api/rate-limit.ts): when configured, all server instances
 * share one sliding-window counter; otherwise — or on a Redis
 * error — requests fall back to this bucket.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

export function checkRateLimit(
  identifier: string,
  maxRequests: number = 100,
  windowMs: number = 60_000
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);

  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(identifier, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

/**
 * Shared entry point for route rate limiting. Distributed first:
 * when Upstash Redis is configured, all server instances share one
 * sliding-window counter. Otherwise — or when Redis errors at
 * request time — it falls back to the in-memory bucket, so a limiter
 * outage never blocks legitimate traffic. Returns a 429 response
 * when the caller is over the limit, else null.
 */
export async function rateLimitResponse(identifier: string, limit = 100, windowMs = 60_000) {
  try {
    const distributed = await checkRateLimitDistributed(identifier, limit, windowMs);
    if (distributed) {
      if (!distributed.allowed) {
        return rateLimited('Too many requests. Please try again later.', {
          resetAt: new Date(distributed.resetAt).toISOString(),
        });
      }
      return null;
    }
  } catch (err) {
    logger.warn('Redis rate limit failed, using in-memory fallback', { error: String(err) });
  }

  const result = checkRateLimit(identifier, limit, windowMs);
  if (!result.allowed) {
    return rateLimited('Too many requests. Please try again later.', {
      resetAt: new Date(result.resetAt).toISOString(),
    });
  }
  return null;
}
