/**
 * Referral click dedupe (Section 18, Phase 2 — item 12, audit
 * §1 #59).
 *
 * POST /api/v1/referrals/click is public with only a 60/min/IP
 * bucket, so one browser could inflate a link's `click_count`
 * by re-hitting it. Counts feed no money today, so this is a
 * cheap best-effort dedupe, not fraud proof: a repeat click from
 * the same browser (dedupe cookie for that code) or the same
 * code+IP inside a short window does not increment again.
 *
 * Storage is in-memory, like the rate-limit fallback buckets:
 * it resets on deploy/restart and is per-instance. That is the
 * accepted trade-off for a counter that feeds no money — the
 * `referral_clicks` rows stay the source of truth, and a missed
 * dedupe only ever over-counts a vanity metric, never money.
 * No IP address, user agent, or user id is stored here (the
 * window map keys on code+IP only in memory; nothing is
 * persisted).
 */

/** A repeat click inside this window does not count again. */
export const REFERRAL_CLICK_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

/** Cookie set on the first counted click for a code. */
export function referralClickCookieName(code: string): string {
  return `sb_ref_click_${code}`;
}

/** True when the request carries the counted-click cookie for this code. */
export function hasReferralClickCookie(
  cookieValue: string | null | undefined
): boolean {
  return cookieValue === '1';
}

// code + IP → timestamp (ms) of the last counted click.
const recentClicks = new Map<string, number>();

function dedupeKey(code: string, ip: string): string {
  return `${code}:${ip}`;
}

function prune(now: number): void {
  for (const [key, at] of recentClicks) {
    if (now - at > REFERRAL_CLICK_DEDUPE_WINDOW_MS) recentClicks.delete(key);
  }
}

/**
 * True when this click must NOT increment: the browser already
 * has the counted-click cookie for this code, or the same code
 * was counted from this IP inside the window.
 */
export function isDuplicateReferralClick(
  code: string,
  ip: string,
  hasCookie: boolean,
  now: number = Date.now()
): boolean {
  if (hasCookie) return true;
  const at = recentClicks.get(dedupeKey(code, ip));
  return at !== undefined && now - at < REFERRAL_CLICK_DEDUPE_WINDOW_MS;
}

/** Record a counted click so repeats inside the window dedupe. */
export function recordReferralClickDedupe(
  code: string,
  ip: string,
  now: number = Date.now()
): void {
  prune(now);
  recentClicks.set(dedupeKey(code, ip), now);
}

/** Test-only reset for the in-memory window. */
export function clearReferralClickDedupe(): void {
  recentClicks.clear();
}
