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
  | 'search-links-only';

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
      status: amazonLocales.length > 0 ? 'configured' : 'search-links-only',
      coverage:
        amazonLocales.length > 0
          ? `Affiliate tag configured for: ${amazonLocales.join(', ')}`
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
      status: 'live',
      coverage: 'US / CA priced rows',
      whatYouGet:
        'Recorded prices with price history and Deal Score; outbound links are plain retailer links.',
    },
    {
      id: 'ebay',
      name: 'eBay',
      kind: 'live-api',
      status: ebayConfigured ? 'configured' : 'not-configured',
      coverage: ebayConfigured
        ? 'Live active listings via the official Browse API'
        : 'Search links in the stores directory (no live listings yet)',
      whatYouGet: ebayConfigured
        ? 'Live active listings — asking prices, condition, and a link to the listing. No sold history, no price history, no Deal Score on live listings.'
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
      status: 'live',
      coverage: `${LOCAL_STORES.length} stores in ${countCountriesWithLocalStores()} countries / ${REGIONS.length} regions`,
      whatYouGet:
        'Your country\u2019s stores first, then international retailers — always as search links to the store\u2019s own results. No local price, stock, deal, or partnership is ever claimed; stores are added only after their search pattern is verified.',
    },
    {
      id: 'global-fallback',
      name: 'International retailers',
      kind: 'directory',
      status: 'live',
      coverage: `${GLOBAL_STORES.map((s) => s.name).join(', ')}`,
      whatYouGet:
        'Worldwide retailers shown separately after your local stores, so a visitor always sees international options too — as search links, never as SmartBuy prices.',
    },
  ];
}
