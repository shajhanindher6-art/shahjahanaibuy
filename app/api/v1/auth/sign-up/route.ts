/**
 * Sign-up proxy — Section 21–25, Stage J, J-P1-1.
 *
 * Same pattern as the sign-in proxy: 5 attempts/min per IP, the
 * actual sign-up runs here with the server client, captcha is
 * enforced only when Turnstile is configured (see
 * `lib/auth/captcha.ts`).
 *
 * Anti-enumeration: Supabase answers "User already registered"
 * for an existing email — that must never reach the client as a
 * distinguishing signal. An existing email gets the SAME success
 * shape as a fresh sign-up ("Account created! Check your email
 * to confirm your account.") — indistinguishable from a new
 * account, exactly as the AuthProvider's client-side mapper did
 * before this proxy existed. Other failures answer a generic
 * 400; the password floor (8 chars) is validated here, matching
 * the sign-up page.
 *
 * Response shapes (unchanged from the client flow, so the
 * sign-up page branches exactly as before):
 *   - session present → { user, session } (auto-confirmed);
 *     the client `setSession()`s and proceeds signed in.
 *   - no session → { message } (confirm-by-email); the client
 *     shows the message as a success-with-message.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, serviceUnavailable } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import { validateBody } from '@/lib/api/validation';
import {
  verifyCaptchaToken,
  isCaptchaConfigured,
  isCaptchaRequired,
  CAPTCHA_REQUIRED_NOT_CONFIGURED_MESSAGE,
} from '@/lib/auth/captcha';

const signUpSchema = z.object({
  email: z.string().email('A valid email address is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().max(200).optional(),
  captchaToken: z.string().optional(),
});

const VERIFY_EMAIL_MESSAGE = 'Account created! Check your email to confirm your account.';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'auth.sign-up' });
  const limited = await rateLimitResponse(`auth.sign-up:${getClientIp(request)}`, 5);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const validation = validateBody(signUpSchema, body ?? {});
  if (!validation.success) {
    const firstError = Object.values(validation.errors).flat()[0];
    return badRequest(firstError ?? 'Invalid request body');
  }
  const { email, password, fullName, captchaToken } = validation.data;

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
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName ?? '' },
      emailRedirectTo: `${new URL(request.url).origin}/auth/callback`,
    },
  });

  if (error) {
    // Final 100%, F-P2-55 — log the failure server-side (message
    // only). The response stays anti-enumeration (see header).
    logApiError(error, { request, route: 'auth.sign-up', status: 400 });
    // Anti-enumeration: an already-registered email gets the
    // same success shape as a fresh sign-up (see header).
    if (/already registered|already exists/i.test(error.message)) {
      return apiSuccess({ message: VERIFY_EMAIL_MESSAGE });
    }
    return badRequest('Failed to create your account. Check your connection and try again.');
  }

  if (!data.session) {
    return apiSuccess({ message: VERIFY_EMAIL_MESSAGE });
  }

  return apiSuccess({
    user: { id: data.user?.id ?? null, email: data.user?.email ?? email },
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  });
}
