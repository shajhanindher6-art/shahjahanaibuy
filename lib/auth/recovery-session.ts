/**
 * Password-reset link validity — Section 18, Phase 2, item 4
 * (audit §1 #54).
 *
 * Finding: `/auth/callback` showed the reset form for any
 * `?type=recovery` without checking a recovery session exists,
 * so an expired/invalid link only surfaced as the generic
 * "Failed to reset password" from `updateUser`.
 *
 * Fix: the callback page checks the recovery session (via the
 * AuthProvider's user/isLoading — Supabase exchanges the link's
 * token into a session on load) before showing the form. No
 * valid session → the expired-link message below + a link to
 * /forgot-password, instead of a form that can only fail.
 */

/** Shown when a recovery link has expired or is invalid. */
export const RECOVERY_LINK_EXPIRED_MESSAGE =
  'This reset link has expired or is invalid — request a new one';

export type RecoverySessionState = 'loading' | 'valid' | 'expired';

/**
 * Pure state derivation (tested): while auth is still loading
 * the session cannot be judged; afterwards a user means the
 * recovery session exists, and no user means the link is
 * expired/invalid (or was never a recovery link).
 */
export function getRecoverySessionState(args: {
  isLoading: boolean;
  user: { id: string } | null | undefined;
}): RecoverySessionState {
  if (args.isLoading) return 'loading';
  return args.user ? 'valid' : 'expired';
}
