/**
 * Timing-safe CRON_SECRET comparison (Section 17, Stage G, audit §4 #11).
 *
 * The six CRON_SECRET-protected cron routes used to compare the
 * `Authorization` header with a plain `!==` string compare. A plain
 * compare leaks the first differing byte position through timing;
 * the smart-home webhook already uses `timingSafeEqual`
 * (lib/smart-home-agent.ts:80-92) and these routes now follow the
 * same pattern: an equal-length guard (timingSafeEqual throws on
 * unequal lengths) plus a constant-time compare of the full
 * `Bearer <secret>` value.
 *
 * Fail-closed throughout: an unset/empty secret never authorizes,
 * and a missing or non-string header never authorizes.
 */

import { timingSafeEqual } from 'node:crypto';

/** Minimal shape of what the routes pass in — a NextRequest satisfies this. */
export interface CronAuthorizedRequest {
  headers: {
    get(name: string): string | null;
  };
}

/**
 * Constant-time check of one `Authorization` header value against
 * one CRON_SECRET value. Returns false (never throws) for a missing
 * secret, a missing/non-string header, or any mismatch — including
 * a length mismatch, which is rejected before timingSafeEqual.
 */
export function isValidCronAuthorization(
  authorization: string | null | undefined,
  cronSecret: string | null | undefined
): boolean {
  try {
    if (!cronSecret || typeof authorization !== 'string' || authorization === '') return false;
    const expected = `Bearer ${cronSecret}`;
    if (authorization.length !== expected.length) return false;
    return timingSafeEqual(
      Buffer.from(authorization, 'utf8'),
      Buffer.from(expected, 'utf8')
    );
  } catch {
    return false;
  }
}

/**
 * Cron authorization for a route request: reads CRON_SECRET from
 * the environment and timing-safe-compares it against the request's
 * `Authorization` header. False when the secret is unset.
 */
export function isCronAuthorized(request: CronAuthorizedRequest): boolean {
  return isValidCronAuthorization(
    request.headers.get('authorization'),
    process.env.CRON_SECRET
  );
}
