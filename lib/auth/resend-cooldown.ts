/**
 * Client-side resend cooldown — Section 18, Phase 2, item 2
 * (audit §1 #11).
 *
 * Finding: no app-level rate limiting on auth endpoints — auth
 * goes browser → Supabase directly, with no server route, no
 * client throttle, and no captcha. This module is the client half
 * of the minimal safe layer: after a verification/reset email is
 * sent, the send/resend button is disabled for
 * `RESEND_COOLDOWN_SECONDS` with a visible countdown, so a user
 * (or a script driving the UI) cannot hammer Supabase's email
 * endpoints from the browser. The server half is the rate-limited
 * proxy route `POST /api/v1/auth/reset-password` (same item) —
 * the cooldown is UX/abuse friction, the proxy rate limit is the
 * enforcement.
 *
 * Pure helpers (tested) + one small hook (wired into the
 * sign-up / forgot-password / verify-email pages; the sign-in
 * page's resend path is the /verify-email page, where the
 * cooldown applies).
 */
import { useCallback, useEffect, useState } from 'react';

/** Seconds a send/resend button stays disabled after a send. */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Whole seconds left of the cooldown, given the timestamp (ms)
 * of the last send and "now" (ms). 0 when no send happened or
 * the window has elapsed; clamped to [0, RESEND_COOLDOWN_SECONDS]
 * so a clock skew can never produce a negative or huge value.
 */
export function cooldownRemainingSeconds(lastSentAtMs: number | null, nowMs: number): number {
  if (lastSentAtMs === null) return 0;
  const elapsed = Math.floor((nowMs - lastSentAtMs) / 1000);
  return Math.max(0, Math.min(RESEND_COOLDOWN_SECONDS, RESEND_COOLDOWN_SECONDS - elapsed));
}

/** "0:45" style label for the disabled-button countdown. */
export function formatCooldownSeconds(remainingSeconds: number): string {
  const s = Math.max(0, Math.floor(remainingSeconds));
  return `0:${String(s).padStart(2, '0')}`;
}

/**
 * Tracks one send/resend cooldown. Call `startCooldown()` right
 * after a send succeeds; `canSend` is false and
 * `remainingSeconds` counts down until the window elapses.
 */
export function useResendCooldown() {
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const remainingSeconds = cooldownRemainingSeconds(lastSentAt, now);

  useEffect(() => {
    if (lastSentAt === null || remainingSeconds <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lastSentAt, remainingSeconds]);

  const startCooldown = useCallback(() => {
    const at = Date.now();
    setLastSentAt(at);
    setNow(at);
  }, []);

  return { remainingSeconds, canSend: remainingSeconds <= 0, startCooldown };
}
