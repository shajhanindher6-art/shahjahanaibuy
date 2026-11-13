/**
 * Password-reset proxy — Section 18, Phase 2, item 2 (audit §1 #11).
 *
 * Finding: no app-level rate limiting on auth endpoints — auth goes
 * browser → Supabase directly, with no server route, no client
 * throttle, and no captcha. This is the thin server half of the
 * minimal safe layer: the forgot-password page sends the reset
 * request here instead of calling Supabase directly, and this
 * route rate-limits it (5/min per IP) before forwarding it to
 * Supabase's `resetPasswordForEmail` with the anon client.
 *
 * Deliberately narrow: ONLY the reset-request path is proxied
 * here. Sign-in / sign-up have their own proxies since Section
 * 21–25, Stage J, J-P1-1 (`app/api/v1/auth/sign-in` and
 * `sign-up`, same 5/min/IP limit + captcha hook) — the user
 * still receives Supabase's reset email and lands on
 * /auth/callback?type=recovery exactly as before.
 *
 * Anti-enumeration: the response is the same generic success
 * whether or not the email exists (Supabase itself returns no
 * distinguishing error for unknown emails, and any error here is
 * logged server-side, never surfaced). The redirect target is
 * always this site's own origin — never a caller-supplied URL.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { validateBody } from '@/lib/api/validation';
import { logger } from '@/lib/config/logger';

const resetPasswordSchema = z.object({
  email: z.string().email('A valid email address is required'),
});

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'auth.reset-password' });
  // Section 19, Phase 9 (§12 #92) — intentionally unwired: Supabase failures are logger.warn'd server-side and the response is deliberately the same generic success (anti-enumeration); the endpoint never returns a 5xx.
  // Rate limit: 5 reset requests/min per IP — reset emails are
  // cheap to abuse and Supabase's own limits are dashboard config
  // (audit §1 #11: status maloom nahi), so this is the app-level
  // backstop. No captcha (out of scope for this item).
  const limited = await rateLimitResponse(`auth.reset-password:${getClientIp(request)}`, 5);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const validation = validateBody(resetPasswordSchema, body ?? {});
  if (!validation.success) {
    const firstError = Object.values(validation.errors).flat()[0];
    return badRequest(firstError ?? 'Invalid request body');
  }
  const { email } = validation.data;

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${new URL(request.url).origin}/auth/callback?type=recovery`,
    });
    if (error) {
      // Logged server-side only; the client always sees the
      // generic success below (no account-enumeration signal).
      logger.warn('password-reset proxy: Supabase reset failed', {
        error: error.message,
      });
    }
  } catch (err) {
    logger.warn('password-reset proxy: reset request failed', {
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }

  return apiSuccess({
    message: 'If an account exists for this email, a password reset link has been sent.',
  });
}
