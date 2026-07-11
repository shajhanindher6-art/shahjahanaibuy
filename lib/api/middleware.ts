/**
 * API middleware utilities for route handlers.
 * Provides authentication checking, logging, and rate-limiting architecture.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logger } from '@/lib/config/logger';
import { unauthorized, internalError, rateLimited } from './responses';
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
 * Logs API requests with structured metadata.
 * In production, this would forward to a logging service.
 */
export function logApiRequest(request: NextRequest, metadata?: Record<string, unknown>) {
  logger.info('API request', {
    method: request.method,
    path: request.nextUrl.pathname,
    ...metadata,
  });
}

/**
 * Rate limiting architecture.
 * Phase 1: in-memory token bucket per IP address.
 * Future: Redis-backed distributed rate limiting.
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

export function rateLimitResponse(identifier: string, limit = 100, windowMs = 60_000) {
  const result = checkRateLimit(identifier, limit, windowMs);
  if (!result.allowed) {
    return rateLimited('Too many requests. Please try again later.', {
      resetAt: new Date(result.resetAt).toISOString(),
    });
  }
  return null;
}
