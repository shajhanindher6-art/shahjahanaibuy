/**
 * Safe post-sign-in redirect validation (security fix 2026-11-05).
 *
 * The sign-in page used to `router.push()` whatever `?redirect=` said,
 * so `.../sign-in?redirect=https://evil.example` sent a freshly
 * signed-in user to an attacker's page — a classic phishing enabler.
 *
 * Only same-origin paths are allowed: must start with a single `/`
 * (so `https://…`, `//evil.com` and `/\evil.com` are all rejected).
 * Everything else falls back to `/dashboard` at the call site.
 */
export function isSafeRedirectPath(value: string | null | undefined): boolean {
  if (!value) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (value.startsWith('/\\')) return false;
  return true;
}
