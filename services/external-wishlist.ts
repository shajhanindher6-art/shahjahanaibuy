/**
 * External wishlist items (Option 8, Feature 5) — URL helpers.
 *
 * Architecture honesty: true automatic one-click sync from every store
 * would require per-store integrations + sign-in + (for many stores)
 * scraping, which is blocked. What is delivered: universal add-by-URL
 * (user pastes any store URL), extension-local save, and an external-item
 * model future per-store integrations can build on. External items NEVER
 * claim price tracking — they are labeled "External item — price tracking
 * unavailable" unless the user explicitly links a catalog product (by slug,
 * validated server-side). A catalog match is never applied automatically:
 * an automatic name match could silently attach the wrong product.
 */

/** Store domain from a pasted URL, or null when the URL is not parseable. */
export function storeDomainFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function isValidExternalUrl(rawUrl: string): boolean {
  return storeDomainFromUrl(rawUrl) !== null;
}
