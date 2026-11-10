/**
 * GA4 + Meta Pixel configuration (Section 3 item 16).
 *
 * Pure helpers, no React: the provider
 * (components/providers/analytics-provider.tsx) reads these, and
 * lib/csp.ts reads the same env vars to allow the vendor hosts.
 *
 * DORMANT BY DEFAULT: both IDs come from env vars
 * (NEXT_PUBLIC_GA4_ID, NEXT_PUBLIC_META_PIXEL_ID). With no ID set —
 * the state on every environment today — nothing loads, no request
 * is made, and the CSP stays unchanged. No ID is ever hardcoded.
 *
 * Validation is deliberately strict: a malformed value is treated
 * as unset (dormant), never injected into a script tag.
 */

/** GA4 measurement IDs look like `G-XXXXXXXXXX` (G + alphanumerics). */
export function isValidGa4Id(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^G-[A-Z0-9]{4,}$/.test(value);
}

/** Meta Pixel IDs are numeric (typically 15–16 digits). */
export function isValidMetaPixelId(
  value: string | null | undefined
): value is string {
  return typeof value === 'string' && /^\d{10,20}$/.test(value);
}

/** Valid GA4 ID from env, or null when unset/invalid (dormant). */
export function getGa4Id(): string | null {
  const id = process.env.NEXT_PUBLIC_GA4_ID;
  return isValidGa4Id(id) ? id : null;
}

/** Valid Meta Pixel ID from env, or null when unset/invalid (dormant). */
export function getMetaPixelId(): string | null {
  const id = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  return isValidMetaPixelId(id) ? id : null;
}
