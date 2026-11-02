/**
 * Region registry for the Global website system.
 *
 * HONEST LIMITS (do not silently widen these):
 * - The only merchants in the catalog are Amazon and Best Buy. This
 *   registry does NOT invent merchants, platforms, or deals for any
 *   country — it only localises (a) the display currency and
 *   (b) the *domain* of an Amazon search link (Best Buy stays US/CA).
 * - Prices are stored in USD. Converted prices use the APPROXIMATE
 *   static FX rates in services/currency.ts (reviewed 2026-11-01),
 *   never a live rate, and are always shown with "≈" plus the USD
 *   value in small text.
 * - No per-country deal data exists: a visitor from any country
 *   sees the same catalog and deals, priced in their currency.
 */

import { USD_PER_UNIT, type CurrencyCode } from '@/services/currency';

export type Language = 'en' | 'ur';

export interface Region {
  /** ISO 3166-1 alpha-2 country code (also the sb-country value). */
  code: string;
  /** Display name in English. */
  name: string;
  currency: CurrencyCode;
  /** Amazon search domain for this country. */
  amazonDomain: string;
  /** Intl locale used to format prices for this region. */
  locale: string;
  /**
   * Language to *offer* a visitor from this region (never forced:
   * the UI language always defaults to English; see lib/i18n.ts).
   */
  suggestedLanguage: Language;
}

export const REGIONS: Region[] = [
  { code: 'US', name: 'United States', currency: 'USD', amazonDomain: 'amazon.com', locale: 'en-US', suggestedLanguage: 'en' },
  { code: 'PK', name: 'Pakistan', currency: 'PKR', amazonDomain: 'amazon.com', locale: 'en-PK', suggestedLanguage: 'ur' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', amazonDomain: 'amazon.co.uk', locale: 'en-GB', suggestedLanguage: 'en' },
  { code: 'DE', name: 'Germany', currency: 'EUR', amazonDomain: 'amazon.de', locale: 'de-DE', suggestedLanguage: 'en' },
  { code: 'FR', name: 'France', currency: 'EUR', amazonDomain: 'amazon.fr', locale: 'fr-FR', suggestedLanguage: 'en' },
  { code: 'IT', name: 'Italy', currency: 'EUR', amazonDomain: 'amazon.it', locale: 'it-IT', suggestedLanguage: 'en' },
  { code: 'ES', name: 'Spain', currency: 'EUR', amazonDomain: 'amazon.es', locale: 'es-ES', suggestedLanguage: 'en' },
  { code: 'IN', name: 'India', currency: 'INR', amazonDomain: 'amazon.in', locale: 'en-IN', suggestedLanguage: 'en' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', amazonDomain: 'amazon.ae', locale: 'en-AE', suggestedLanguage: 'en' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', amazonDomain: 'amazon.sa', locale: 'en-SA', suggestedLanguage: 'en' },
  { code: 'CA', name: 'Canada', currency: 'CAD', amazonDomain: 'amazon.ca', locale: 'en-CA', suggestedLanguage: 'en' },
  { code: 'AU', name: 'Australia', currency: 'AUD', amazonDomain: 'amazon.com.au', locale: 'en-AU', suggestedLanguage: 'en' },
];

/** Generic fallback for any country outside the registry. */
export const FALLBACK_REGION: Region = {
  code: 'US',
  name: 'United States',
  currency: 'USD',
  amazonDomain: 'amazon.com',
  locale: 'en-US',
  suggestedLanguage: 'en',
};

const BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));

/** Look up a region by ISO country code (case-insensitive); null when unknown. */
export function getRegionByCountry(code: string | null | undefined): Region | null {
  if (!code) return null;
  return BY_CODE.get(code.toUpperCase()) ?? null;
}

/** Region for a country code, falling back to US for anything unknown. */
export function resolveRegion(code: string | null | undefined): Region {
  return getRegionByCountry(code) ?? FALLBACK_REGION;
}

/** Currencies that are conventionally shown without decimals. */
const ZERO_DECIMAL = new Set<CurrencyCode>(['PKR', 'JPY', 'INR', 'BDT']);

/** Convert a USD amount into a region currency using the static rates. */
export function convertUsd(usd: number, currency: CurrencyCode): number {
  const perUnit = USD_PER_UNIT[currency];
  if (!perUnit || perUnit <= 0) return usd;
  return usd / perUnit;
}

/**
 * Format a USD price for a region. Returns the display string and
 * whether it is an approximate conversion (true for every currency
 * except USD itself).
 */
export function formatPriceForRegion(
  usd: number,
  region: Region
): { display: string; approximate: boolean } {
  if (region.currency === 'USD') {
    return {
      display: new Intl.NumberFormat(region.locale, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(usd),
      approximate: false,
    };
  }
  const converted = convertUsd(usd, region.currency);
  const digits = ZERO_DECIMAL.has(region.currency) ? 0 : 2;
  return {
    display: new Intl.NumberFormat(region.locale, {
      style: 'currency',
      currency: region.currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(converted),
    approximate: true,
  };
}

/** Format a plain USD amount (the small "original price" text). */
export function formatUsd(usd: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}

/**
 * Rewrite ONLY the domain of an Amazon search URL to the visitor
 * region's Amazon domain. Path, query and fragment are untouched,
 * and non-Amazon URLs (e.g. Best Buy, US/CA only) are returned
 * unchanged. This never invents a product-page URL: stored links
 * remain retailer search links (amazon.com/s?k=<name>).
 */
export function localizeAmazonUrl(url: string | null | undefined, region: Region): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'amazon.com' || host.endsWith('.amazon.com')) {
      parsed.hostname = region.amazonDomain;
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Best-effort country guess from browser timezone / language.
 * Used ONLY when the IP lookup fails. Returns a registry code or null.
 */
export function guessCountryFromBrowser(): string | null {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    const tzMap: Record<string, string> = {
      'Asia/Karachi': 'PK',
      'Europe/London': 'GB',
      'Europe/Berlin': 'DE',
      'Europe/Paris': 'FR',
      'Europe/Rome': 'IT',
      'Europe/Madrid': 'ES',
      'Asia/Kolkata': 'IN',
      'Asia/Dubai': 'AE',
      'Asia/Riyadh': 'SA',
      'America/Toronto': 'CA',
      'Australia/Sydney': 'AU',
      'Australia/Melbourne': 'AU',
    };
    if (tzMap[timeZone]) return tzMap[timeZone];
    if (timeZone.startsWith('Australia/')) return 'AU';
    if (timeZone.startsWith('America/') && timeZone !== 'America/New_York') {
      // Keep the US fallback for the Americas; only Toronto is
      // mapped explicitly above (no invented region data).
    }
    const lang =
      typeof navigator !== 'undefined' ? (navigator.language ?? '') : '';
    const langMap: Record<string, string> = {
      ur: 'PK',
      'en-gb': 'GB',
      de: 'DE',
      fr: 'FR',
      it: 'IT',
      es: 'ES',
      'en-in': 'IN',
      'en-ae': 'AE',
      'ar-sa': 'SA',
      'en-ca': 'CA',
      'en-au': 'AU',
    };
    const lower = lang.toLowerCase();
    if (langMap[lower]) return langMap[lower];
    const primary = lower.split('-')[0];
    if (langMap[primary]) return langMap[primary];
  } catch {
    // Never throw from a guess — the caller falls back to US.
  }
  return null;
}
