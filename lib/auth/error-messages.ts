/**
 * Sign-up error mapping — Section 18, Phase 2, item 5 (audit §1 #55).
 *
 * Finding: `signUp` returned Supabase's `error.message` verbatim,
 * and Supabase returns "User already registered" for an existing
 * email — so an attacker could enumerate registered emails by
 * trying sign-ups. The password-reset flow does NOT leak (it always
 * shows "Check your email") and is left alone.
 *
 * Fix: an "already registered" error is mapped to the same generic
 * "check your email" wording a fresh sign-up shows, and reported
 * as a success-with-message (exactly like the no-session
 * confirmation path in `features/auth/auth-provider.tsx`), so the
 * response is indistinguishable from a new account creation.
 * Every other sign-up error passes through unchanged.
 */

/** Shown instead of Supabase's "User already registered". */
export const SIGNUP_ALREADY_REGISTERED_MESSAGE =
  "If this email is registered, you'll receive a confirmation link";

/**
 * Returns the generic message when `message` is Supabase's
 * already-registered error (matched case-insensitively, since the
 * exact wording is Supabase's and could vary in case), else null.
 */
export function mapSignUpErrorMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  if (message.toLowerCase().includes('already registered')) {
    return SIGNUP_ALREADY_REGISTERED_MESSAGE;
  }
  return null;
}
