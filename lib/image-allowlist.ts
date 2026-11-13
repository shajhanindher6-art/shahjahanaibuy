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
 *
 * FINAL 100%, F-P2-25 — this exact-host rule is the CANONICAL
 * allowlist. `services/pipeline/image-processing.ts` used to allow
 * subdomains via `endsWith('.' + host)`; it now delegates here, so
 * the two implementations can no longer disagree. Exact-host is
 * the stricter rule: a listed `example.com` must never silently
 * authorize `evil.example.com` — the owner lists each host
 * explicitly.
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

export interface ImageAllowlistConfig {
  /** Lower-cased, deduped hosts from IMAGE_ALLOWED_HOSTS. */
  hosts: string[];
  /** True only when at least one host is configured. */
  configured: boolean;
  /**
   * Honest status line for admin/docs. When unconfigured it says
   * plainly that no merchant image host is known yet (F-P1-41,
   * owner-gated) — the allowlist is fail-closed, never "all hosts".
   */
  status: string;
}

/**
 * FINAL 100%, F-P1-08 — allowlist configuration as data: the
 * configured hosts, whether anything is configured at all, and
 * the honest status line. The actual host list is owner-gated
 * (F-P1-41): no merchant image host is known yet, so `hosts` is
 * empty until the owner supplies IMAGE_ALLOWED_HOSTS.
 */
export function getImageAllowlistConfig(): ImageAllowlistConfig {
  const hosts = getAllowedImageHosts();
  return {
    hosts,
    configured: hosts.length > 0,
    status:
      hosts.length > 0
        ? `${hosts.length} image host(s) allowlisted`
        : 'No image host allowlisted — IMAGE_ALLOWED_HOSTS is unset and no merchant image host is known yet (owner-gated, F-P1-41). Image storage upload is disabled until hosts are supplied.',
  };
}
