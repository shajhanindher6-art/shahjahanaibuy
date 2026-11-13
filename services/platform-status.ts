/**
 * Section 8 — honest platform status for the /platforms hub and
 * the /api/v1/platforms endpoint (SERVER-ONLY: reads env vars).
 *
 * Every status here is a BOOLEAN or a count derived from real
 * configuration — never a secret value, never a claim about a
 * platform that is not configured. A platform with no configured
 * account is reported as `not-configured` / `search-links-only`,
 * never as "connected". The UI renders exactly these statuses.
 */

import {
  describeAffiliateCoverage,
  getConfiguredAmazonLocales,
} from '@/services/affiliate-geo';
import { isEbayConfigured } from '@/services/ebay-browse';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import { GLOBAL_STORES, LOCAL_STORES } from '@/lib/stores';
import { REGIONS } from '@/lib/region';

export type PlatformKind =
  | 'priced-merchant'
  | 'live-api'
  | 'search-link'
  | 'aggregator'
  | 'directory';

export type PlatformStatus =
  | 'live'
  | 'configured'
  | 'not-configured'
  | 'search-links-only'
  /**
   * Section 20, §12 #51 — two honest statuses that replace the
   * overstated ones. 'recorded-prices-only' means the merchant has
   * recorded price rows in our database and NO live integration
   * (no adapter, no credential, no verified call) — it must never
   * read as 'live'. 'tag-only' means only an affiliate tag env var
   * is set — no price/stock integration works behind it.
   */
  | 'recorded-prices-only'
  | 'tag-only';

export interface PlatformStatusEntry {
  id: string;
  name: string;
  kind: PlatformKind;
  status: PlatformStatus;
  /** Countries/regions this entry covers, as a plain count or label. */
  coverage: string;
  /** What the visitor actually gets from this platform today. */
  whatYouGet: string;
}

/**
 * FINAL 100% (F-P2-07) — the eBay "configured" gate. The
 * configured-state copy ("Live active listings…") was untested
 * against reality: keys alone do not make eBay live. eBay is
 * `configured` ONLY when all three gates hold — keys set
 * (EBAY_CLIENT_ID + EBAY_CLIENT_SECRET), the `merchants` row
 * `slug='ebay'` exists, AND EPN + Growth Check approval is
 * confirmed (owner dashboard only — no code can check it, so
 * the caller must pass the owner's confirmation in). Anything
 * less is `not-configured`, with the missing gates named in the
 * copy so the page never promises live listings it cannot show.
 * `merchantRowExists: null` means "not checked against the DB
 * yet" — the copy says so instead of assuming either way.
 */
export interface EbayConfiguredCheck {
  keysConfigured: boolean;
  merchantRowExists: boolean | null;
  approvalConfirmed: boolean;
}

export function describeEbayPlatformStatus(check: EbayConfiguredCheck): {
  status: 'configured' | 'not-configured';
  coverage: string;
  whatYouGet: string;
} {
  const missing: string[] = [];
  if (!check.keysConfigured) missing.push('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET in Vercel');
  if (check.merchantRowExists === false) missing.push('the eBay merchants row (slug=\'ebay\', owner SQL)');
  if (check.merchantRowExists === null) missing.push('a database check that the eBay merchants row exists');
  if (!check.approvalConfirmed) missing.push('eBay Partner Network + Growth Check approval (owner dashboard)');
  if (missing.length === 0) {
    return {
      status: 'configured',
      coverage: 'Live active listings via the official Browse API',
      whatYouGet:
        'Live active listings — asking prices, condition, and a link to the listing. No sold history, no price history, no Deal Score on live listings. Verified against keys, the merchants row, and EPN + Growth Check approval.',
    };
  }
  return {
    status: 'not-configured',
    coverage: 'Search links in the stores directory (no live listings yet)',
    whatYouGet:
      `eBay live search is not configured — still missing: ${missing.join('; ')}. ` +
      `Until all three are in place, eBay appears only as a search link.`,
  };
}

/**
 * Async live check of the eBay gates that CAN be checked from
 * code (keys + merchants row). Approval is never checkable from
 * code — the caller passes the owner's confirmation, or leaves
 * it false (honest default: unconfirmed).
 */
export async function describeEbayPlatformStatusLive(
  supabase: AnySupabaseClient,
  approvalConfirmed = false
): Promise<ReturnType<typeof describeEbayPlatformStatus>> {
  const keysConfigured = isEbayConfigured();
  let merchantRowExists: boolean | null = null;
  try {
    const { data, error } = await supabase
      .from('merchants')
      .select('id')
      .eq('slug', 'ebay')
      .maybeSingle();
    if (!error) merchantRowExists = Boolean(data);
  } catch {
    merchantRowExists = null;
  }
  return describeEbayPlatformStatus({ keysConfigured, merchantRowExists, approvalConfirmed });
}

function countCountriesWithLocalStores(): number {
  return new Set(LOCAL_STORES.map((store) => store.countryCode)).size;
}

/**
 * The full platform list, in the order the /platforms hub renders
 * it: priced merchants first, then the live API, then search-link
 * retailers, then the aggregator, then the local-stores directory.
 */
export function describePlatformStatus(): PlatformStatusEntry[] {
  const affiliate = describeAffiliateCoverage();
  const amazonLocales = getConfiguredAmazonLocales();
  const ebayConfigured = isEbayConfigured();

  return [
    {
      id: 'amazon',
      name: 'Amazon',
      kind: 'priced-merchant',
      // Section 20, §12 #51 — was 'configured': a set affiliate tag
      // is not an integration. 'tag-only' says exactly what exists
      // (a tag env var); there is no Amazon price/stock API behind it.
      status: amazonLocales.length > 0 ? 'tag-only' : 'search-links-only',
      coverage:
        amazonLocales.length > 0
          ? `Affiliate tag set for: ${amazonLocales.join(', ')}`
          : 'Search links in every region; priced rows from recorded listings',
      whatYouGet:
        amazonLocales.length > 0
          ? 'Recorded prices with price history and Deal Score; outbound links carry the configured locale tag only.'
          : 'Recorded prices with price history and Deal Score; outbound links are plain retailer links (no tag). Live Amazon catalog needs the Creators API, which requires 10 qualifying sales in the last 30 days.',
    },
    {
      id: 'best-buy',
      name: 'Best Buy',
      kind: 'priced-merchant',
      // Section 20, §12 #51 — was 'live': there is no Best Buy
      // adapter, credential, or verified call. 'recorded-prices-only'
      // says the truth — seeded recorded price rows exist, nothing live.
      status: 'recorded-prices-only',
      coverage: 'US / CA recorded price rows',
      whatYouGet:
        'Recorded prices with price history and Deal Score; outbound links are plain retailer links. No live Best Buy integration exists — prices are recorded rows, not live checks.',
    },
    {
      id: 'ebay',
      name: 'eBay',
      kind: 'live-api',
      // FINAL 100% (F-P2-07): keys alone do not prove a working
      // integration — the merchants row + EPN/Growth Check
      // approval are separate gates (see
      // describeEbayPlatformStatus). This sync entry can only
      // see the keys, so its copy says exactly that and names
      // the unchecked gates instead of promising live listings.
      status: ebayConfigured ? 'configured' : 'not-configured',
      coverage: ebayConfigured
        ? 'Keys set — live listings need the merchants row + approval too (see below)'
        : 'Search links in the stores directory (no live listings yet)',
      whatYouGet: ebayConfigured
        ? 'Keys are set, but live listings also need the eBay merchants row (slug=\'ebay\') and EPN + Growth Check approval — neither is verified by this page. Until both are confirmed, treat eBay as not yet live; the gated check is describeEbayPlatformStatus (services/platform-status.ts).'
        : 'eBay live search is not configured. Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in Vercel to turn it on (free developer account; production also needs the eBay Partner Network + Growth Check). Until then, eBay appears only as a search link.',
    },
    {
      id: 'aliexpress',
      name: 'AliExpress',
      kind: 'search-link',
      status: 'search-links-only',
      coverage: 'Worldwide search link',
      whatYouGet:
        'A link to AliExpress search results for the product. SmartBuy shows no AliExpress price, stock, or deal.',
    },
    {
      id: 'google-shopping',
      name: 'Google Shopping',
      kind: 'search-link',
      status: 'search-links-only',
      coverage: 'Worldwide search link',
      whatYouGet:
        'A link to Google Shopping results for the product. SmartBuy shows no Google Shopping price or deal.',
    },
    {
      id: 'skimlinks',
      name: 'Skimlinks',
      kind: 'aggregator',
      status: affiliate.skimlinksConfigured
        ? 'configured'
        : 'not-configured',
      coverage: affiliate.skimlinksConfigured
        ? 'Aggregator configured — merchant links may be wrapped'
        : 'Not applied yet — one approval would cover 48,500+ merchants',
      whatYouGet: affiliate.skimlinksConfigured
        ? 'Outbound merchant links may be wrapped in the Skimlinks redirect so qualifying purchases earn commission.'
        : 'No Skimlinks account yet. Applying is the owner\u2019s decision: a rejected application blocks reapplying for 90 days, so it is only submitted on the owner\u2019s explicit go-ahead.',
    },
    {
      id: 'local-stores',
      name: 'Local stores directory',
      kind: 'directory',
      // Sections 21–25, Stage B (B7) — was 'live': a static
      // search-link directory is not a live integration. It is
      // search links only — the same honesty as every other
      // directory entry.
      status: 'search-links-only',
      coverage: `${LOCAL_STORES.length} stores in ${countCountriesWithLocalStores()} countries / ${REGIONS.length} regions`,
      whatYouGet:
        'Your country\u2019s stores first, then international retailers — always as search links to the store\u2019s own results. No local price, stock, deal, or partnership is ever claimed; stores are added only after their search pattern is verified.',
    },
    {
      id: 'global-fallback',
      name: 'International retailers',
      kind: 'directory',
      // Sections 21–25, Stage B (B7) — was 'live': same static
      // search-link directory, same honest status.
      status: 'search-links-only',
      coverage: `${GLOBAL_STORES.map((s) => s.name).join(', ')}`,
      whatYouGet:
        'Worldwide retailers shown separately after your local stores, so a visitor always sees international options too — as search links, never as SmartBuy prices.',
    },
  ];
}
