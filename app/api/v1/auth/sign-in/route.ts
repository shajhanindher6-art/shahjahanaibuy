/**
 * Sign-in proxy — Section 21–25, Stage J, J-P1-1.
 *
 * Finding: sign-in went browser → Supabase directly, with no
 * server-side rate limit and no captcha; brute-force protection
 * depended entirely on Supabase dashboard settings (status
 * maloom nahi from the repo). This route is the thin server half,
 * following the reset-password proxy pattern:
 *
 *   - Rate limit: 5 attempts/min per IP (same as reset-password).
 *   - The actual sign-in runs here with the server (cookie)
 *     client, so the session cookies are set server-side AND the
 *     session tokens are returned for the browser client to
 *     `setSession()` with — the AuthProvider flow is unchanged
 *     (same success shapes, same profile fetch, same guest merge).
 *   - Anti-enumeration: a failed sign-in always answers the same
 *     generic 401 ("Invalid email or password.") — never whether
 *     the account exists.
 *   - Captcha: enforced ONLY when Turnstile is configured (see
 *     `lib/auth/captcha.ts`); while unconfigured the check is
 *     skipped and the rate limit is the active backstop.
 *
 * The browser client still calls Supabase directly ONLY as a
 * fallback when this proxy is unreachable (network error) — the
 * proxy is same-origin, so that path should never trigger in
 * production; it exists so a proxy outage cannot lock every user
 * out of sign-in. A 429/401 from the proxy is honoured, never
 * bypassed.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, serviceUnavailable, unauthorized } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import { validateBody } from '@/lib/api/validation';
import {
  verifyCaptchaToken,
  isCaptchaConfigured,
  isCaptchaRequired,
  CAPTCHA_REQUIRED_NOT_CONFIGURED_MESSAGE,
} from '@/lib/auth/captcha';

const signInSchema = z.object({
  email: z.string().email('A valid email address is required'),
  password: z.string().min(1, 'Password is required'),
  captchaToken: z.string().optional(),
});

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'auth.sign-in' });
  const limited = await rateLimitResponse(`auth.sign-in:${getClientIp(request)}`, 5);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const validation = validateBody(signInSchema, body ?? {});
  if (!validation.success) {
    const firstError = Object.values(validation.errors).flat()[0];
    return badRequest(firstError ?? 'Invalid request body');
  }
  const { email, password, captchaToken } = validation.data;

  // Final 100%, F-P1-63 — fail CLOSED when captcha is required but
  // Turnstile is unconfigured: never silently pass. (REQUIRE_CAPTCHA
  // defaults OFF, so this branch is inert until the owner sets both
  // the flag and the Turnstile keys.)
  if (isCaptchaRequired() && !isCaptchaConfigured()) {
    return serviceUnavailable(CAPTCHA_REQUIRED_NOT_CONFIGURED_MESSAGE);
  }

  if (isCaptchaConfigured()) {
    const captcha = await verifyCaptchaToken(captchaToken, getClientIp(request));
    if (!captcha.verified) {
      return badRequest('Captcha verification failed. Please try again.');
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    // Final 100%, F-P2-55 — log the failure server-side (message
    // only; the password is never logged). The response stays
    // generic on purpose — never reveal whether the account exists.
    logApiError(error ?? new Error('Sign-in returned no session'), {
      request,
      route: 'auth.sign-in',
      status: 401,
    });
    return unauthorized('Invalid email or password.');
  }

  return apiSuccess({
    user: { id: data.user?.id ?? null, email: data.user?.email ?? email },
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  });
}
