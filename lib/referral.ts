/**
 * Referral links (S3#10) — share + referral.
 *
 * A referral link is `${site}/?ref=<code>` (or any page URL with the
 * same `ref` query param). The code is random (`sb-` + 10 lowercase
 * alphanumerics) — it never contains a user id, email, or any personal
 * data, and click tracking stores no IP address or user agent (see
 * migration 026). Signed-in users get one link each (dedupe by
 * user_id); guests get one link per browser token.
 *
 * Pure helpers (isValidReferralCode / buildReferralUrl /
 * parseReferralCode) are unit-tested; the fetch helpers below are
 * thin client wrappers around /api/v1/referrals and degrade to a
 * failed result instead of throwing.
 */

export const REFERRAL_QUERY_PARAM = 'ref';
export const GUEST_REFERRAL_TOKEN_KEY = 'sb-guest-referral-token';
/**
 * Section 15, B13 — a `?ref=` code seen on the sign-up page is
 * kept here until a session exists: email-confirmation signups
 * have no session at sign-up time, so the code must survive the
 * redirect to /auth/callback, which attempts attribution once the
 * user is signed in. Cleared once attribution answers
 * definitively (attributed or ignored); kept for a later attempt
 * when the request could not reach the server.
 */
export const PENDING_REFERRAL_CODE_KEY = 'sb-pending-referral-code';

/** Remember a valid ref code seen on the sign-up page. Never throws. */
export function storePendingReferralCode(code: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!isValidReferralCode(code)) return;
    window.localStorage.setItem(PENDING_REFERRAL_CODE_KEY, code);
  } catch {
    // Storage unavailable — attribution is best-effort only.
  }
}

/** Read the stored ref code without consuming it. Never throws. */
export function peekPendingReferralCode(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return parseReferralCode(window.localStorage.getItem(PENDING_REFERRAL_CODE_KEY));
  } catch {
    return null;
  }
}

/** Drop the stored ref code. Never throws. */
export function clearPendingReferralCode(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
  } catch {
    // Nothing to do.
  }
}

export type ReferralAttributionOutcome = 'attributed' | 'ignored' | 'retry';

/**
 * Submit a signup for referral attribution (POST
 * /api/v1/referrals/attribute). Never throws.
 *   - 'attributed': the signup was recorded for the referrer.
 *   - 'ignored': the server answered definitively that this code
 *     does not attribute (invalid, unknown, guest-owned,
 *     self-referral, already attributed, or not signed in yet is
 *     NOT ignored — see below).
 *   - 'retry': the request never reached a definitive answer
 *     (network failure, 401/no session yet, attribution
 *     unavailable because migration 038 has not run) — the caller
 *     should keep the code for a later attempt.
 */
export async function submitReferralAttribution(
  code: string
): Promise<ReferralAttributionOutcome> {
  if (!isValidReferralCode(code)) return 'ignored';
  try {
    const res = await fetch('/api/v1/referrals/attribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    // 401 (no session yet — e.g. email confirmation pending):
    // keep the code; the auth callback retries after sign-in.
    if (res.status === 401) return 'retry';
    if (!res.ok) return 'retry';
    const data: unknown = await res.json().catch(() => null);
    const payload =
      data && typeof data === 'object'
        ? (data as { data?: { attributed?: unknown; reason?: unknown } }).data
        : null;
    if (!payload || typeof payload !== 'object') return 'retry';
    if (payload.attributed === true) return 'attributed';
    // 'not-available' (migration 038 unapplied) is a retry: the
    // signup may still be attributed once the migration runs and
    // the user signs in again.
    if (payload.reason === 'not-available') return 'retry';
    return 'ignored';
  } catch {
    return 'retry';
  }
}

const REFERRAL_CODE_RE = /^sb-[a-z0-9]{10}$/;

/** True for codes our API issues (`sb-` + 10 lowercase alphanumerics). */
export function isValidReferralCode(code: unknown): code is string {
  return typeof code === 'string' && REFERRAL_CODE_RE.test(code);
}

/** Normalise a raw query-param value: trimmed, lowercased, or null. */
export function parseReferralCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase();
  return isValidReferralCode(code) ? code : null;
}

/** Parse a `ref` code out of a query string (`?ref=sb-…`) or full URL. */
export function parseReferralCodeFromSearch(search: string): string | null {
  try {
    const params = new URLSearchParams(
      search.startsWith('?') ? search.slice(1) : search
    );
    return parseReferralCode(params.get(REFERRAL_QUERY_PARAM));
  } catch {
    return null;
  }
}

/**
 * Build a shareable referral URL. `baseUrl` defaults to the current
 * origin in the browser; callers pass the site URL server-side.
 */
export function buildReferralUrl(code: string, baseUrl?: string): string {
  const base =
    baseUrl ??
    (typeof window !== 'undefined' ? window.location.origin : '');
  const clean = base.replace(/\/+$/, '');
  return `${clean}/?${REFERRAL_QUERY_PARAM}=${encodeURIComponent(code)}`;
}

/** The browser's random guest token for referral ownership (localStorage). */
export function getGuestReferralToken(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    let token = window.localStorage.getItem(GUEST_REFERRAL_TOKEN_KEY);
    if (!token) {
      token =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(GUEST_REFERRAL_TOKEN_KEY, token);
    }
    return token;
  } catch {
    return null;
  }
}

export type CreateReferralLinkResult =
  | { ok: true; code: string; url: string; clicks: number }
  | { ok: false; error: string };

/**
 * Create (or fetch the existing) referral link for this visitor.
 * Signed-in users are linked by account server-side; guests by the
 * browser token above. Never throws.
 */
export async function createReferralLink(): Promise<CreateReferralLinkResult> {
  try {
    const res = await fetch('/api/v1/referrals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestToken: getGuestReferralToken() }),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data !== 'object') {
      return { ok: false, error: 'Could not create a referral link. Please try again.' };
    }
    const payload = (data as { data?: { code?: unknown; url?: unknown; clicks?: unknown } }).data ?? {};
    if (!isValidReferralCode(payload.code) || typeof payload.url !== 'string') {
      return { ok: false, error: 'Could not create a referral link. Please try again.' };
    }
    return {
      ok: true,
      code: payload.code,
      url: payload.url,
      clicks: typeof payload.clicks === 'number' ? payload.clicks : 0,
    };
  } catch {
    return { ok: false, error: 'Could not create a referral link. Please try again.' };
  }
}

/**
 * Record one referral click (called once per page load when the URL
 * carries `?ref=`). Fire-and-forget: failures are swallowed — a
 * missed click must never break the page. Never throws.
 */
export async function recordReferralClick(
  code: string,
  productId?: string
): Promise<boolean> {
  if (!isValidReferralCode(code)) return false;
  try {
    const res = await fetch('/api/v1/referrals/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, productId: productId ?? null }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
