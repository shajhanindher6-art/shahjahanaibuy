/**
 * Geo-Targeted Affiliate Engine — Phase 3 Prep.
 *
 * SERVER-ONLY: never import from client components. Tag values live
 * in server env vars and are never served from a config endpoint
 * (they appear in link hrefs, which is inherent to affiliate links).
 *
 * THIS MODULE IS DELIBERATELY SEPARATE from services/affiliate.ts:
 * the older module used to hardcode retailer tag values, which the
 * owner confirmed (2026-11-05) were placeholder / dummy test IDs —
 * that config and its buildAffiliateUrl were removed the same day.
 * NOTHING here reuses those values. Real tags belong in env vars —
 * never hardcoded.
 *
 * HONESTY RULES (do not weaken them):
 * - ENV-GATED, OFF BY DEFAULT: when no tag / publisher id is
 *   configured, buildGeoAffiliateUrl returns the input URL
 *   byte-for-byte, so links stay exactly today's plain retailer
 *   search links. A tag appears ONLY after the owner configures a
 *   real account in the hosting dashboard.
 * - NO tag is ever invented here: there are no hardcoded tags, and
 *   docs use placeholder text, not usable values.
 * - Amazon tags are LOCALE-SCOPED: a tag applies only to its own
 *   locale. The base tag (AMAZON_ASSOC_TAG) applies to US visitors
 *   only; any other visitor country needs its own override
 *   (AMAZON_ASSOC_TAG_GB, _DE, _JP, ...). A US tag is never stamped
 *   on a link that the client will rewrite to amazon.co.uk/.de,
 *   because it would not earn there and would misrepresent the link.
 * - The Skimlinks redirect format below must be confirmed against
 *   the owner's Skimlinks dashboard before enabling; it is the
 *   widely documented go.skimresources.com pattern, not a verified
 *   fact about an account that does not exist yet.
 * - Geo routing NEVER invents a local store: when no regional tag
 *   exists, the universal fallback is the plain US/global link,
 *   unchanged. Regional domain rewriting stays in
 *   lib/region.ts:localizeAmazonUrl (client-side, query preserved),
 *   which composes with the server-side tag below.
 * - Click tracking (see /api/v1/affiliate/geo-click) stores NO IP
 *   address, NO user agent, and NO user id — only the Vercel geo
 *   country (or the saved region cookie), the product, the retailer
 *   name, and the clicked merchant URL.
 */

import { getRegionByCountry } from '@/lib/region';

/** Server env names. All optional; unset = feature off for that path. */
const AMAZON_TAG_BASE = 'AMAZON_ASSOC_TAG';
const SKIMLINKS_PUBLISHER_ID = 'SKIMLINKS_PUBLISHER_ID';

/** Fallback country when no geo signal resolves. */
export const GEO_FALLBACK_COUNTRY = 'US';

function envNonEmpty(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Amazon Associates tag for a visitor country, or null.
 * US visitors use the base tag; every other country needs its own
 * AMAZON_ASSOC_TAG_<CC> override. No override = no tag (passthrough),
 * never a US tag stamped on a non-US link.
 */
export function getAmazonTag(countryCode: string): string | null {
  const cc = countryCode.toUpperCase();
  if (cc === 'US') return envNonEmpty(AMAZON_TAG_BASE);
  return envNonEmpty(`${AMAZON_TAG_BASE}_${cc}`);
}

/** Skimlinks publisher id, or null when unconfigured. */
export function getSkimlinksPublisherId(): string | null {
  return envNonEmpty(SKIMLINKS_PUBLISHER_ID);
}

/**
 * True when ANY affiliate path is configured (any AMAZON_ASSOC_TAG*
 * var, or a Skimlinks publisher id). Drives the on-page affiliate
 * disclosure note: no config = no note, no tags, no claims.
 */
export function isGeoAffiliateEnabled(): boolean {
  if (getSkimlinksPublisherId() !== null) return true;
  return Object.keys(process.env).some(
    (key) => key.startsWith(AMAZON_TAG_BASE) && envNonEmpty(key) !== null
  );
}

/**
 * Resolve the visitor's country for affiliate routing, in precedence
 * order (mirrors the site's region rules):
 *   1. Vercel geo header (x-vercel-ip-country) — server truth on
 *      Vercel, validated against the region registry.
 *   2. Saved region cookie (sb-country) — the visitor's own switcher
 *      choice, which always wins over detection elsewhere.
 *   3. Universal fallback: US.
 * Invalid/unknown codes never propagate; they fall through.
 */
export function resolveGeoCountry(
  headerCountry: string | null | undefined,
  cookieCountry: string | null | undefined
): string {
  return (
    resolveGeoCountryOrNull(headerCountry, cookieCountry) ?? GEO_FALLBACK_COUNTRY
  );
}

/**
 * Same precedence as resolveGeoCountry, but null when NO signal
 * resolves. Used for click tracking only: an unknown country must be
 * stored as unknown, never guessed as US.
 */
export function resolveGeoCountryOrNull(
  headerCountry: string | null | undefined,
  cookieCountry: string | null | undefined
): string | null {
  const header = (headerCountry ?? '').trim().toUpperCase();
  if (header && getRegionByCountry(header)) return header;
  const cookie = (cookieCountry ?? '').trim().toUpperCase();
  if (cookie && getRegionByCountry(cookie)) return cookie;
  return null;
}

/**
 * Amazon's real host shape only: amazon.<tld> (com, de, fr, ...),
 * amazon.co.<cc> (co.uk, co.jp), or amazon.com.<cc> (com.au, com.mx).
 * The loose pattern amazon.<anything>.<anything> would also match a
 * phishing host such as amazon.evil.com, so it is deliberately NOT
 * used here (fixed 2026-11-05 after an allowlist test caught it).
 */
function isAmazonHostname(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'amazon.com' ||
    h.endsWith('.amazon.com') ||
    /^amazon\.([a-z]{2,3}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(h)
  );
}

/**
 * Whether a hostname may be affiliate-transformed by the batch
 * transform endpoint (Step B, client-rendered store links).
 * Allowed: the big-retailer families (Amazon, Best Buy, eBay,
 * AliExpress) OR any hostname in the stores directory (the caller
 * passes the directory's websiteUrl hosts). Anything else returns
 * false, so the endpoint can never become an open redirector or a
 * wrapper for arbitrary URLs. `www.` is ignored on both sides.
 */
export function isTransformableHost(hostname: string, knownHosts: Set<string>): boolean {
  const bare = hostname.toLowerCase().replace(/^www\./, '');
  // Same tight host shapes as isAmazonHostname: a loose
  // amazon.<anything>.<anything> pattern would also match phishing
  // hosts such as amazon.evil.com (caught by an allowlist test).
  if (
    bare === 'amazon.com' ||
    bare.endsWith('.amazon.com') ||
    /^amazon\.([a-z]{2,3}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(bare) ||
    bare === 'bestbuy.com' ||
    bare.endsWith('.bestbuy.com') ||
    /^ebay\.([a-z]{2,3}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(bare) ||
    bare.endsWith('.ebay.com') ||
    /^aliexpress\.([a-z]{2,3}|com\.[a-z]{2})$/.test(bare)
  ) {
    return true;
  }
  for (const known of knownHosts) {
    const k = known.toLowerCase().replace(/^www\./, '');
    if (bare === k || bare.endsWith(`.${k}`)) return true;
  }
  return false;
}

/**
 * Whether a beacon click's target URL may be stored — Step C Stage 1
 * host validation. A click is trackable when its host is
 * transformable (same allowlist as the transform endpoint: the big
 * retailer families plus the stores directory, passed in by the
 * caller) OR when it is the Skimlinks redirect host
 * `go.skimresources.com`: a Skimlinks-wrapped link is a legitimate
 * beacon target once Skimlinks is configured, and without this host
 * in the list real clicks would be dropped. Anything else is a
 * garbage filter, not volume control — a spammer can still copy real
 * merchant URLs from the site, which is why burst flagging lives in
 * the reporting layer (services/affiliate-analytics.ts).
 */
export function isTrackableClickHost(hostname: string, knownHosts: Set<string>): boolean {
  const bare = hostname.toLowerCase().replace(/^www\./, '');
  if (bare === 'go.skimresources.com') return true;
  return isTransformableHost(hostname, knownHosts);
}

/**
 * Skimlinks wrapper (secondary fallback layer). Only used when a
 * publisher id is configured AND the retailer has no direct tag.
 * Format to confirm in the Skimlinks dashboard before enabling.
 */
export function buildSkimlinksUrl(rawUrl: string, publisherId: string): string {
  return `https://go.skimresources.com/?id=${encodeURIComponent(publisherId)}&url=${encodeURIComponent(rawUrl)}`;
}

/**
 * Transform one merchant link for a visitor country.
 *
 * Order (first match wins):
 *   1. Amazon host + configured locale tag → set/replace `tag`.
 *      Existing tags are REPLACED, never stacked.
 *   2. Any other host + configured Skimlinks id → wrapped URL.
 *      (eBay, Best Buy, and regional retailers have no direct-tag
 *      scheme in this batch; they use the aggregator fallback.)
 *   3. Nothing configured, or unparseable input → input unchanged.
 *
 * The input is a retailer SEARCH link today (never an invented
 * product-page URL); transformation preserves path and query except
 * for the tag param it sets.
 */
export function buildGeoAffiliateUrl(
  rawUrl: string | null | undefined,
  countryCode: string
): string | null {
  if (!rawUrl) return rawUrl ?? null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (isAmazonHostname(parsed.hostname)) {
    const tag = getAmazonTag(countryCode);
    if (tag) {
      parsed.searchParams.set('tag', tag);
      return parsed.toString();
    }
    return rawUrl;
  }

  const publisherId = getSkimlinksPublisherId();
  if (publisherId) {
    return buildSkimlinksUrl(parsed.toString(), publisherId);
  }
  return rawUrl;
}
