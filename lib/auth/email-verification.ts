/**
 * Email-verification dashboard gate — Section 18, Phase 2, item 6
 * (audit §1 #56).
 *
 * Finding: no code read `email_confirmed_at` for gating (only a
 * display badge), and `/verify-email` offered a "Skip for now"
 * link straight to /dashboard.
 *
 * This item was OPTIONAL per the audit, and it is implemented
 * only under the safe distinction below. The redirect applies
 * ONLY to accounts created via email/password:
 * `user.app_metadata.provider === 'email'` (falling back to the
 * `identities` list) AND `email_confirmed_at` is null. OAuth
 * users (Google, `provider === 'google'`) have confirmed emails
 * and are NEVER redirected. When the provider cannot be
 * determined, the check fails open (no redirect) rather than
 * risk locking a legitimate user out.
 *
 * Escape hatch (no lock-out): "Skip for now" on /verify-email
 * sets a 7-day `sb_verify_skipped` cookie, which the dashboard
 * layout honours. Without it, an email user whose confirmation
 * mail never arrives would bounce /dashboard → /verify-email
 * forever. The gate is a UX nudge toward confirming, not a
 * security boundary — the APIs never depended on it.
 */

/** Cookie set by "Skip for now" on /verify-email; honoured for 7 days. */
export const VERIFY_SKIP_COOKIE = 'sb_verify_skipped';
export const VERIFY_SKIP_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type EmailVerificationUser = {
  email_confirmed_at?: string | null;
  app_metadata?: { provider?: string };
  identities?: Array<{ provider?: string }>;
} | null | undefined;

/**
 * True when this user should be sent to /verify-email instead of
 * the dashboard: an email/password account whose email is still
 * unconfirmed, and who has not just skipped verification.
 */
export function shouldRedirectToVerifyEmail(
  user: EmailVerificationUser,
  opts?: { skipped?: boolean }
): boolean {
  if (!user) return false;
  if (opts?.skipped) return false;
  if (user.email_confirmed_at) return false;

  const provider = user.app_metadata?.provider;
  if (provider) return provider === 'email';

  // Provider unknown from app_metadata: fall back to identities.
  // Redirect only when the account has an email identity and no
  // OAuth identity at all; anything else fails open.
  const identities = user.identities ?? [];
  if (identities.length === 0) return false;
  const providers = identities.map((i) => i.provider).filter(Boolean);
  return providers.length > 0 && providers.every((p) => p === 'email');
}

/** Client-side: record a "Skip for now" so the layout lets the user through. */
export function setVerifySkippedCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie =
    `${VERIFY_SKIP_COOKIE}=1; path=/; max-age=${VERIFY_SKIP_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}
