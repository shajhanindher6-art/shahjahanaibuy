/**
 * Sections 21–25, Stage K (K6) — product image host allowlist.
 *
 * The image pipeline is URL-only today and `validateImageUrl`
 * (lib/image-url.ts) accepts any public https host, because no
 * merchant image host list exists. This module is the allowlist
 * itself, so the upload path has something fail-closed to check
 * against once hosts are known:
 *
 * - FAIL-CLOSED: an empty list rejects EVERYTHING. The host list
 *   is owner-gated — no merchant image host is known yet — so
 *   until the owner supplies hosts via `IMAGE_ALLOWED_HOSTS`
 *   (comma-separated, e.g. `cdn.example.com,images.merchant.com`),
 *   no host is allowed.
 * - Exact-host match only (case-insensitive, port-insensitive —
 *   the URL's hostname is compared, so `https://host:8443/x.jpg`
 *   matches a listed `host`). Subdomains do NOT match: a listed
 *   `example.com` does not allow `evil.example.com`; the owner
 *   lists each host explicitly.
 * - Pure function, no DB, no network: `isAllowedImageHost` takes
 *   the list as an argument (defaulting to the env list) so
 *   callers and tests never depend on ambient env.
 *
 * NOT wired into `validateImageUrl` / `processImages` yet, on
 * purpose: wiring a fail-closed empty list into the live path
 * would reject every image today. The integration point is the
 * upload path (`uploadToStorage` in
 * services/pipeline/image-processing.ts, itself a placeholder —
 * K7): when a real upload lands, it must accept only URLs whose
 * host passes `isAllowedImageHost`, and the owner must supply
 * `IMAGE_ALLOWED_HOSTS` first.
 */

/** Hosts from `IMAGE_ALLOWED_HOSTS` (comma-separated), lower-cased, deduped. Empty when unset. */
export function getAllowedImageHosts(): string[] {
  const raw = process.env.IMAGE_ALLOWED_HOSTS ?? '';
  const hosts = raw
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
  return [...new Set(hosts)];
}

/**
 * True only when the URL's hostname is exactly one of the allowed
 * hosts. Fail-closed on every side: an empty/missing list rejects
 * everything, an unparseable or non-http(s) value rejects, and a
 * host that is merely a subdomain of a listed host rejects.
 */
export function isAllowedImageHost(
  value: unknown,
  allowedHosts: string[] = getAllowedImageHosts()
): boolean {
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) return false;
  const allowed = new Set(
    allowedHosts
      .map((host) => (typeof host === 'string' ? host.trim().toLowerCase() : ''))
      .filter((host) => host.length > 0)
  );
  if (allowed.size === 0) return false;
  if (typeof value !== 'string' || value.trim() === '') return false;
  let hostname: string;
  try {
    hostname = new URL(value.trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!hostname) return false;
  return allowed.has(hostname);
}
