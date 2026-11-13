/**
 * Section 21–25, Stage J, J-P1-1 — captcha hook point (client).
 *
 * The auth proxies accept an optional `captchaToken`, but no
 * captcha widget exists in the UI yet, so there is no token to
 * send: this returns null today and the proxies skip the check
 * (their rate limit is the active backstop).
 *
 * To enable captcha (owner-gated — needs a Turnstile site key):
 *   1. Set NEXT_PUBLIC_TURNSTILE_SITE_KEY in Vercel.
 *   2. Render the Turnstile widget on /sign-in and /sign-up and
 *      have it store its token where this function can read it
 *      (e.g. a module-level setter registered by the widget).
 *   3. `readCaptchaToken()` then returns the live token and the
 *      proxies enforce it via `lib/auth/captcha.ts`.
 *
 * This file deliberately holds no widget code and no keys — it is
 * the seam, so the provider wiring below never has to change when
 * the widget lands.
 */

let captchaTokenProvider: (() => string | null) | null = null;

/** Register the widget's token reader (called by the widget when it mounts). */
export function setCaptchaTokenProvider(provider: (() => string | null) | null): void {
  captchaTokenProvider = provider;
}

/** The current captcha token, or null when no widget is wired yet. */
export function readCaptchaToken(): string | null {
  try {
    return captchaTokenProvider?.() ?? null;
  } catch {
    return null;
  }
}
