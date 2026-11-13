/**
 * Section 21–25, Stage J, J-P1-1 — captcha PREPARATION (server).
 *
 * No captcha is enforced today: no provider is configured and no
 * widget exists in the UI, so there is nothing to verify against.
 * This module is the config + verification hook the auth proxies
 * (`app/api/v1/auth/sign-in`, `sign-up`) call, so turning captcha
 * on is a config change, not a code change:
 *
 *   1. Owner picks Cloudflare Turnstile (free tier) and sets in
 *      Vercel (both required — one without the other does nothing):
 *        NEXT_PUBLIC_TURNSTILE_SITE_KEY — public, rendered by the
 *          sign-in/sign-up widget (owner-gated: the widget itself
 *          is not built yet; see `lib/auth/captcha-client.ts`).
 *        TURNSTILE_SECRET_KEY — server-only, never exposed.
 *   2. The widget posts its token as `captchaToken` in the proxy
 *      body; the proxies call `verifyCaptchaToken()` below.
 *   3. While either key is unset, `verifyCaptchaToken()` returns
 *      `{ verified: false, reason: 'not-configured' }` and the
 *      proxies SKIP the check (documented fail-open — the
 *      server-side rate limit is the active backstop until then).
 *
 * No keys live in this repo. The Turnstile siteverify call uses
 * the standard Cloudflare endpoint and sends only the token + the
 * caller's IP (for Turnstile's own checks); no user data.
 */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface CaptchaConfig {
  /** Public site key (rendered by the widget); null when unset. */
  siteKey: string | null;
  /** True only when BOTH keys are set (the only state that enforces). */
  configured: boolean;
}

export function getCaptchaConfig(): CaptchaConfig {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim() || null;
  return { siteKey, configured: siteKey !== null && secretKey !== null };
}

/** True only when captcha enforcement is possible (both keys set). */
export function isCaptchaConfigured(): boolean {
  return getCaptchaConfig().configured;
}

export type CaptchaVerifyResult =
  | { verified: true }
  | { verified: false; reason: 'not-configured' | 'missing-token' | 'invalid-token' | 'verify-error' };

/**
 * Verify a Turnstile token against Cloudflare. Returns
 * `not-configured` (not an error) when captcha is not set up —
 * callers treat that as "skip the check".
 */
export async function verifyCaptchaToken(
  token: string | null | undefined,
  remoteIp?: string | null
): Promise<CaptchaVerifyResult> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim() || null;
  if (!getCaptchaConfig().configured || !secretKey) {
    return { verified: false, reason: 'not-configured' };
  }
  if (!token || token.trim() === '') {
    return { verified: false, reason: 'missing-token' };
  }
  try {
    const body = new URLSearchParams({
      secret: secretKey,
      response: token.trim(),
      ...(remoteIp ? { remoteip: remoteIp } : {}),
    });
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { verified: false, reason: 'verify-error' };
    const data = (await res.json()) as { success?: boolean };
    return data.success === true
      ? { verified: true }
      : { verified: false, reason: 'invalid-token' };
  } catch {
    return { verified: false, reason: 'verify-error' };
  }
}
