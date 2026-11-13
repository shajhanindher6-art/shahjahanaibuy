/**
 * API v1 native-app waitlist endpoint.
 * POST /api/v1/mobile-app/waitlist — { email, platform: 'ios' | 'android' }.
 *
 * There is no native app yet and no launch date is promised, so this
 * only records interest. No emails are sent. Dedupe is
 * UNIQUE(email, platform): joining twice returns 200 with
 * alreadyJoined:true, not an error. Missing table (migration 033
 * not run) → 503 with an honest message. Inserts use the
 * service-role client because app_waitlist has no client insert
 * policy by design.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, internalError, serviceUnavailable, validationError } from '@/lib/api/responses';
import { logger } from '@/lib/config/logger';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { joinAppWaitlist, validateWaitlistInput } from '@/lib/app-waitlist';

import { logApiError } from '@/lib/api/error-logging';
import { validateBody, invalidBodyResponse, mobileWaitlistSchema } from '@/lib/api/validation';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'mobile-app.waitlist' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`mobile-app-waitlist:${getClientIp(request)}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    // Final 100%, F-P1-60 — schema validation before the route's
    // own validateWaitlistInput (which keeps its messages).
    const schemaValidation = validateBody(mobileWaitlistSchema, body ?? {});
    const schemaInvalid = invalidBodyResponse(schemaValidation);
    if (schemaInvalid) return schemaInvalid;
    const validated = validateWaitlistInput({
      email: typeof body?.email === 'string' ? body.email : '',
      platform: typeof body?.platform === 'string' ? body.platform : '',
    });
    if (!validated.ok) {
      return validationError(validated.error ?? 'Invalid waitlist details.');
    }

    const service = createSupabaseServiceClient();
    if (!service) {
      return serviceUnavailable(
        'The waitlist is not available right now — the server is missing its database configuration.'
      );
    }

    const result = await joinAppWaitlist(service, {
      email: validated.email as string,
      platform: validated.platform as string,
    });
    if (result.status === 'unavailable') {
      return serviceUnavailable(
        'The waitlist is not set up yet — the owner still needs to run migration 033 in Supabase once.'
      );
    }
    if (result.status === 'already_joined') {
      return apiSuccess({ joined: true, alreadyJoined: true }, 200);
    }
    return apiSuccess({ joined: true, alreadyJoined: false }, 201);
  } catch (err) {
    logApiError(err, { request, route: 'mobile-app.waitlist', status: 500 });
    logger.error('[mobile-app.waitlist] unexpected error', { error: err instanceof Error ? err.message : err });
    return internalError('Failed to join the waitlist');
  }
}
