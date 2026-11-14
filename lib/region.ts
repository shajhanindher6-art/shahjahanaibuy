/**
 * Region registry for the Global website system.
 *
 * HONEST LIMITS (do not silently widen these):
 * - The only merchants in the catalog are Amazon and Best Buy. This
 *   registry does NOT invent merchants, platforms, or deals for any
 *   country — it only localises (a) the display currency and
 *   (b) the *domain* of an Amazon search link (Best Buy stays US/CA).
 * - Prices are stored in USD. Converted prices use the APPROXIMATE
 *   static FX rates in services/currency.ts (original block reviewed
 *   2026-11-01, worldwide-expansion block reviewed 2026-11-02),
 *   never a live rate, and are always shown with "≈" plus the USD
 *   value in small text.
 * - No per-country deal data exists: a visitor from any country
 *   sees the same catalog and deals, priced in their currency.
 * - Worldwide expansion (2026-11-02): 60 regions. Section 8
 *   (2026-11-10) added Ukraine (UA, UAH) as the 61st region so
 *   its verified local store (Rozetka) is reachable by geo
 *   detection. Venezuela and Ecuador use USD (both dollarized in
 *   practice); every other new region uses its real local
 *   currency. Countries outside this registry still get the
 *   global retailer fallback on product pages (see
 *   lib/stores.ts getStoresForCountry).
 */

import { USD_PER_UNIT, type CurrencyCode } from '@/services/currency';

/**
 * Supported UI languages (Option 4 Part 1 + S5#12, 2026-11-10).
 * Chrome strings only — see lib/i18n.ts. The original 8 languages
 * (en, ur, de, fr, es, it, pt, tr) are human-written functional
 * chrome strings. The 12 added by S5#12 (ar, zh, ja, ko, hi, bn,
 * nl, sv, pl, ru, id, vi) are machine translations, labelled
 * "auto-translated" in the UI (LanguageMeta.autoTranslated) — they
 * have not been professionally reviewed. Adding a language is a
 * small, obvious change: one entry here, one dictionary in
 * lib/i18n.ts, and one COUNTRY_LANGUAGE entry per country that
 * speaks it (below).
 */
export type Language =
  | 'en'
  | 'ur'
  | 'de'
  | 'fr'
  | 'es'
  | 'it'
  | 'pt'
  | 'tr'
  | 'ar'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'hi'
  | 'bn'
  | 'nl'
  | 'sv'
  | 'pl'
  | 'ru'
  | 'id'
  | 'vi';

export const SUPPORTED_LANGUAGES: Language[] = [
  'en',
  'ur',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'tr',
  'ar',
  'zh',
  'ja',
  'ko',
  'hi',
  'bn',
  'nl',
  'sv',
  'pl',
  'ru',
  'id',
  'vi',
];

/** Languages whose dictionaries are machine translations (S5#12). */
export const AUTO_TRANSLATED_LANGUAGES: Language[] = [
  'ar',
  'zh',
  'ja',
  'ko',
  'hi',
  'bn',
  'nl',
  'sv',
  'pl',
  'ru',
  'id',
  'vi',
];

export function isAutoTranslatedLanguage(code: string): boolean {
  return (AUTO_TRANSLATED_LANGUAGES as string[]).includes(code);
}

/** Right-to-left UI languages (S5#12). Arabic is RTL; Roman Urdu
 * ('ur') is written left-to-right in this project (Latin script),
 * so it is NOT in this set. */
export const RTL_LANGUAGES: Language[] = ['ar'];

export function isRtlLanguage(code: string | null | undefined): boolean {
  return !!code && (RTL_LANGUAGES as string[]).includes(code);
}

export interface LanguageMeta {
  code: Language;
  /** Native name, as shown in the header Language Switcher. */
  nativeName: string;
  /**
   * True when the dictionary is a machine translation (S5#12).
   * The switcher / settings UI appends "(auto-translated)" so
   * shoppers are never misled about its quality.
   */
  autoTranslated?: boolean;
  /** True when the language reads right-to-left. */
  rtl?: boolean;
}

export const LANGUAGES: LanguageMeta[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'ur', nativeName: 'Roman Urdu' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'es', nativeName: 'Español' },
  { code: 'it', nativeName: 'Italiano' },
  { code: 'pt', nativeName: 'Português' },
  { code: 'tr', nativeName: 'Türkçe' },
  { code: 'ar', nativeName: 'العربية', autoTranslated: true, rtl: true },
  { code: 'zh', nativeName: '中文', autoTranslated: true },
  { code: 'ja', nativeName: '日本語', autoTranslated: true },
  { code: 'ko', nativeName: '한국어', autoTranslated: true },
  { code: 'hi', nativeName: 'हिन्दी', autoTranslated: true },
  { code: 'bn', nativeName: 'বাংলা', autoTranslated: true },
  { code: 'nl', nativeName: 'Nederlands', autoTranslated: true },
  { code: 'sv', nativeName: 'Svenska', autoTranslated: true },
  { code: 'pl', nativeName: 'Polski', autoTranslated: true },
  { code: 'ru', nativeName: 'Русский', autoTranslated: true },
  { code: 'id', nativeName: 'Bahasa Indonesia', autoTranslated: true },
  { code: 'vi', nativeName: 'Tiếng Việt', autoTranslated: true },
];

export function languageMeta(code: Language): LanguageMeta {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

/** True when a stored/raw value is one of the supported languages. */
export function isSupportedLanguage(value: string | null | undefined): value is Language {
  return !!value && (SUPPORTED_LANGUAGES as string[]).includes(value);
}

/**
 * Country → UI language map (Option 4 Part 1 auto-detection).
 *
 * Every one of the 60 region codes below is listed explicitly so
 * coverage is checkable (see the scripted check: each REGIONS code
 * must resolve here to a supported language). Regions whose
 * language is NOT in the supported set map to 'en' — English
 * fallback, stated honestly, not a pretended translation:
 * - DE/AT/CH → de (German-speaking; CH locale is de-CH).
 * - FR, plus CI/SN (locales fr-CI/fr-SN, French-speaking) → fr.
 * - ES plus Mexico and Latin America → es.
 * - IT → it. BR → pt (PT is listed too, although Portugal is not
 *   itself a region code, so a PT detection still resolves).
 * - TR → tr. PK → ur.
 * - S5#12: AE/SA/QA/EG/MA → ar; JP → ja; KR → ko; TW → zh;
 *   ID → id; VN → vi; BD → bn; NL → nl; PL → pl. IN stays 'en'
 *   (English is an official language; Hindi is reachable via the
 *   browser-language path, 'hi'/'hi-IN' → hi). RU/SV/HI have no
 *   region in the registry, so they resolve only from the browser
 *   language, never from a country code.
 * - Everything else (US, GB, CA, AU, …) → en: either
 *   English-speaking or a language not yet supported.
 * Unlisted codes (outside the registry, e.g. IS) also resolve
 * to 'en' via languageForCountry's fallback.
 */
export const COUNTRY_LANGUAGE: Record<string, Language> = {
  // English-speaking / English fallback (explicit, not omitted).
  US: 'en',
  GB: 'en',
  CA: 'en',
  AU: 'en',
  IN: 'en',
  AE: 'ar',
  SA: 'ar',
  IE: 'en',
  SG: 'en',
  PH: 'en',
  NG: 'en',
  KE: 'en',
  UG: 'en',
  GH: 'en',
  ZA: 'en',
  NZ: 'en',
  // S5#12 languages (machine-translated dictionaries, lib/i18n.ts).
  JP: 'ja',
  KR: 'ko',
  TW: 'zh',
  ID: 'id',
  MY: 'en',
  TH: 'en',
  VN: 'vi',
  BD: 'bn',
  LK: 'en',
  NP: 'en',
  QA: 'ar',
  EG: 'ar',
  MA: 'ar',
  PL: 'pl',
  CZ: 'en',
  GR: 'en',
  UA: 'en',
  BE: 'en',
  NL: 'nl',
  // Supported non-English languages.
  PK: 'ur',
  DE: 'de',
  AT: 'de',
  CH: 'de',
  FR: 'fr',
  CI: 'fr',
  SN: 'fr',
  ES: 'es',
  MX: 'es',
  AR: 'es',
  CL: 'es',
  CO: 'es',
  PE: 'es',
  UY: 'es',
  BO: 'es',
  PY: 'es',
  VE: 'es',
  CR: 'es',
  EC: 'es',
  GT: 'es',
  DO: 'es',
  PA: 'es',
  HN: 'es',
  NI: 'es',
  IT: 'it',
  BR: 'pt',
  PT: 'pt',
  TR: 'tr',
};

/** Resolve a country code to its UI language; 'en' for anything unknown. */
export function languageForCountry(code: string | null | undefined): Language {
  if (!code) return 'en';
  return COUNTRY_LANGUAGE[code.toUpperCase()] ?? 'en';
}

/**
 * Map a browser language tag to a supported UI language, using
 * only the primary subtag (e.g. 'de-AT' → 'de'). Null when the
 * browser language is not in the supported set.
 */
export function languageFromBrowserLanguage(tag: string | null | undefined): Language | null {
  if (!tag) return null;
  const primary = tag.toLowerCase().split('-')[0];
  return isSupportedLanguage(primary) ? primary : null;
}

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
   * UI language auto-detected for a visitor from this region
   * (Option 4 Part 1): it equals languageForCountry(code), so the
   * banner can offer it when the current UI language differs.
   * A saved language choice always wins over this value; changing
   * the Country Switcher never forces a language change.
   */
  suggestedLanguage: Language;
}

export const REGIONS: Region[] = [
  { code: 'US', name: 'United States', currency: 'USD', amazonDomain: 'amazon.com', locale: 'en-US', suggestedLanguage: 'en' },
  { code: 'PK', name: 'Pakistan', currency: 'PKR', amazonDomain: 'amazon.com', locale: 'en-PK', suggestedLanguage: 'ur' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', amazonDomain: 'amazon.co.uk', locale: 'en-GB', suggestedLanguage: 'en' },
  { code: 'DE', name: 'Germany', currency: 'EUR', amazonDomain: 'amazon.de', locale: 'de-DE', suggestedLanguage: 'de' },
  { code: 'FR', name: 'France', currency: 'EUR', amazonDomain: 'amazon.fr', locale: 'fr-FR', suggestedLanguage: 'fr' },
  { code: 'IT', name: 'Italy', currency: 'EUR', amazonDomain: 'amazon.it', locale: 'it-IT', suggestedLanguage: 'it' },
  { code: 'ES', name: 'Spain', currency: 'EUR', amazonDomain: 'amazon.es', locale: 'es-ES', suggestedLanguage: 'es' },
  { code: 'IN', name: 'India', currency: 'INR', amazonDomain: 'amazon.in', locale: 'en-IN', suggestedLanguage: 'en' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', amazonDomain: 'amazon.ae', locale: 'en-AE', suggestedLanguage: 'ar' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', amazonDomain: 'amazon.sa', locale: 'en-SA', suggestedLanguage: 'ar' },
  { code: 'CA', name: 'Canada', currency: 'CAD', amazonDomain: 'amazon.ca', locale: 'en-CA', suggestedLanguage: 'en' },
  { code: 'AU', name: 'Australia', currency: 'AUD', amazonDomain: 'amazon.com.au', locale: 'en-AU', suggestedLanguage: 'en' },
  // --- Worldwide expansion (2026-11-02): 48 more regions. Amazon
  // domains are the real local domain where one exists, else
  // 'amazon.com' (same fallback PK already used). VE/EC use USD
  // (dollarized); all others use their real local currency.
  // East Asia
  { code: 'JP', name: 'Japan', currency: 'JPY', amazonDomain: 'amazon.co.jp', locale: 'ja-JP', suggestedLanguage: 'ja' },
  { code: 'KR', name: 'South Korea', currency: 'KRW', amazonDomain: 'amazon.com', locale: 'ko-KR', suggestedLanguage: 'ko' },
  { code: 'TW', name: 'Taiwan', currency: 'TWD', amazonDomain: 'amazon.com', locale: 'zh-TW', suggestedLanguage: 'zh' },
  // Southeast Asia
  { code: 'ID', name: 'Indonesia', currency: 'IDR', amazonDomain: 'amazon.com', locale: 'id-ID', suggestedLanguage: 'id' },
  { code: 'MY', name: 'Malaysia', currency: 'MYR', amazonDomain: 'amazon.com', locale: 'ms-MY', suggestedLanguage: 'en' },
  { code: 'SG', name: 'Singapore', currency: 'SGD', amazonDomain: 'amazon.sg', locale: 'en-SG', suggestedLanguage: 'en' },
  { code: 'TH', name: 'Thailand', currency: 'THB', amazonDomain: 'amazon.com', locale: 'th-TH', suggestedLanguage: 'en' },
  { code: 'VN', name: 'Vietnam', currency: 'VND', amazonDomain: 'amazon.com', locale: 'vi-VN', suggestedLanguage: 'vi' },
  { code: 'PH', name: 'Philippines', currency: 'PHP', amazonDomain: 'amazon.com', locale: 'en-PH', suggestedLanguage: 'en' },
  // South Asia
  { code: 'BD', name: 'Bangladesh', currency: 'BDT', amazonDomain: 'amazon.com', locale: 'en-BD', suggestedLanguage: 'bn' },
  { code: 'LK', name: 'Sri Lanka', currency: 'LKR', amazonDomain: 'amazon.com', locale: 'en-LK', suggestedLanguage: 'en' },
  { code: 'NP', name: 'Nepal', currency: 'NPR', amazonDomain: 'amazon.com', locale: 'en-NP', suggestedLanguage: 'en' },
  // Middle East & Africa
  { code: 'QA', name: 'Qatar', currency: 'QAR', amazonDomain: 'amazon.com', locale: 'ar-QA', suggestedLanguage: 'ar' },
  { code: 'TR', name: 'Turkey', currency: 'TRY', amazonDomain: 'amazon.com.tr', locale: 'tr-TR', suggestedLanguage: 'tr' },
  { code: 'EG', name: 'Egypt', currency: 'EGP', amazonDomain: 'amazon.eg', locale: 'ar-EG', suggestedLanguage: 'ar' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', amazonDomain: 'amazon.com', locale: 'en-NG', suggestedLanguage: 'en' },
  { code: 'KE', name: 'Kenya', currency: 'KES', amazonDomain: 'amazon.com', locale: 'en-KE', suggestedLanguage: 'en' },
  { code: 'MA', name: 'Morocco', currency: 'MAD', amazonDomain: 'amazon.com', locale: 'ar-MA', suggestedLanguage: 'ar' },
  { code: 'CI', name: 'Côte d’Ivoire', currency: 'XOF', amazonDomain: 'amazon.com', locale: 'fr-CI', suggestedLanguage: 'fr' },
  { code: 'SN', name: 'Senegal', currency: 'XOF', amazonDomain: 'amazon.com', locale: 'fr-SN', suggestedLanguage: 'fr' },
  { code: 'UG', name: 'Uganda', currency: 'UGX', amazonDomain: 'amazon.com', locale: 'en-UG', suggestedLanguage: 'en' },
  { code: 'GH', name: 'Ghana', currency: 'GHS', amazonDomain: 'amazon.com', locale: 'en-GH', suggestedLanguage: 'en' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', amazonDomain: 'amazon.co.za', locale: 'en-ZA', suggestedLanguage: 'en' },
  // Latin America
  { code: 'BR', name: 'Brazil', currency: 'BRL', amazonDomain: 'amazon.com.br', locale: 'pt-BR', suggestedLanguage: 'pt' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', amazonDomain: 'amazon.com.mx', locale: 'es-MX', suggestedLanguage: 'es' },
  { code: 'AR', name: 'Argentina', currency: 'ARS', amazonDomain: 'amazon.com', locale: 'es-AR', suggestedLanguage: 'es' },
  { code: 'CL', name: 'Chile', currency: 'CLP', amazonDomain: 'amazon.com', locale: 'es-CL', suggestedLanguage: 'es' },
  { code: 'CO', name: 'Colombia', currency: 'COP', amazonDomain: 'amazon.com', locale: 'es-CO', suggestedLanguage: 'es' },
  { code: 'PE', name: 'Peru', currency: 'PEN', amazonDomain: 'amazon.com', locale: 'es-PE', suggestedLanguage: 'es' },
  { code: 'UY', name: 'Uruguay', currency: 'UYU', amazonDomain: 'amazon.com', locale: 'es-UY', suggestedLanguage: 'es' },
  { code: 'BO', name: 'Bolivia', currency: 'BOB', amazonDomain: 'amazon.com', locale: 'es-BO', suggestedLanguage: 'es' },
  { code: 'PY', name: 'Paraguay', currency: 'PYG', amazonDomain: 'amazon.com', locale: 'es-PY', suggestedLanguage: 'es' },
  { code: 'VE', name: 'Venezuela', currency: 'USD', amazonDomain: 'amazon.com', locale: 'es-VE', suggestedLanguage: 'es' },
  { code: 'CR', name: 'Costa Rica', currency: 'CRC', amazonDomain: 'amazon.com', locale: 'es-CR', suggestedLanguage: 'es' },
  { code: 'EC', name: 'Ecuador', currency: 'USD', amazonDomain: 'amazon.com', locale: 'es-EC', suggestedLanguage: 'es' },
  { code: 'GT', name: 'Guatemala', currency: 'GTQ', amazonDomain: 'amazon.com', locale: 'es-GT', suggestedLanguage: 'es' },
  { code: 'DO', name: 'Dominican Republic', currency: 'DOP', amazonDomain: 'amazon.com', locale: 'es-DO', suggestedLanguage: 'es' },
  { code: 'PA', name: 'Panama', currency: 'PAB', amazonDomain: 'amazon.com', locale: 'es-PA', suggestedLanguage: 'es' },
  { code: 'HN', name: 'Honduras', currency: 'HNL', amazonDomain: 'amazon.com', locale: 'es-HN', suggestedLanguage: 'es' },
  { code: 'NI', name: 'Nicaragua', currency: 'NIO', amazonDomain: 'amazon.com', locale: 'es-NI', suggestedLanguage: 'es' },
  // Europe (new)
  { code: 'PL', name: 'Poland', currency: 'PLN', amazonDomain: 'amazon.pl', locale: 'pl-PL', suggestedLanguage: 'pl' },
  { code: 'CZ', name: 'Czechia', currency: 'CZK', amazonDomain: 'amazon.com', locale: 'cs-CZ', suggestedLanguage: 'en' },
  { code: 'GR', name: 'Greece', currency: 'EUR', amazonDomain: 'amazon.com', locale: 'el-GR', suggestedLanguage: 'en' },
  { code: 'IE', name: 'Ireland', currency: 'EUR', amazonDomain: 'amazon.ie', locale: 'en-IE', suggestedLanguage: 'en' },
  { code: 'AT', name: 'Austria', currency: 'EUR', amazonDomain: 'amazon.de', locale: 'de-AT', suggestedLanguage: 'de' },
  { code: 'BE', name: 'Belgium', currency: 'EUR', amazonDomain: 'amazon.com.be', locale: 'en-BE', suggestedLanguage: 'en' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', amazonDomain: 'amazon.nl', locale: 'nl-NL', suggestedLanguage: 'nl' },
  { code: 'CH', name: 'Switzerland', currency: 'CHF', amazonDomain: 'amazon.de', locale: 'de-CH', suggestedLanguage: 'de' },
  // Section 8 (2026-11-10): Ukraine, so Rozetka (verified in
  // lib/stores.ts) is reachable by geo detection. UAH already
  // exists in the FX table (~42 per USD); Ukrainian is not a
  // supported UI language, so the suggestion stays English.
  { code: 'UA', name: 'Ukraine', currency: 'UAH', amazonDomain: 'amazon.com', locale: 'uk-UA', suggestedLanguage: 'en' },
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
const ZERO_DECIMAL = new Set<CurrencyCode>([
  'PKR',
  'JPY',
  'INR',
  'BDT',
  'KRW',
  'IDR',
  'VND',
  'CLP',
  'ARS',
  'COP',
  'NGN',
  'KES',
  'UGX',
  'PYG',
  'LKR',
  'NPR',
  'XOF',
]);

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

/**
 * Live daily FX rates, in the shape GET /api/v1/fx-rates returns
 * (units of currency per 1 USD — the inverse direction of
 * USD_PER_UNIT). Defined here, structurally, so client components
 * can use it WITHOUT importing the server-only services/fx-rates.ts:
 * the client fetches /api/v1/fx-rates and passes the JSON through.
 * `fetchedAt` is the feed's own last-update timestamp (live only),
 * or null for the static fallback.
 */
export interface LiveFxRates {
  rates: Partial<Record<CurrencyCode, number>>;
  source: 'live' | 'static';
  fetchedAt: string | null;
}

/**
 * Format a USD price for a region using LIVE daily FX rates when a
 * usable live rate exists for the region currency, falling back to
 * the APPROXIMATE static table (formatPriceForRegion) otherwise —
 * a missing/stale/zero live rate never blocks the price, it just
 * means the static estimate is shown and `source` says so.
 * Converted prices are always approximate ("≈" in the UI); the
 * feed publishes DAILY rates, never real-time ones, so callers must
 * label them "live daily rate" with `rateDate`, never "real-time".
 */
export function formatPriceForRegionWithRates(
  usd: number,
  region: Region,
  fx: LiveFxRates | null
): {
  display: string;
  approximate: boolean;
  source: 'live' | 'static';
  /** Feed last-update timestamp (live only), else null. */
  rateDate: string | null;
} {
  if (region.currency === 'USD') {
    return {
      display: new Intl.NumberFormat(region.locale, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(usd),
      approximate: false,
      source: fx?.source ?? 'static',
      rateDate: fx?.fetchedAt ?? null,
    };
  }
  const liveRate = fx?.source === 'live' ? fx.rates[region.currency] : undefined;
  if (typeof liveRate === 'number' && Number.isFinite(liveRate) && liveRate > 0) {
    const converted = usd * liveRate;
    const digits = ZERO_DECIMAL.has(region.currency) ? 0 : 2;
    return {
      display: new Intl.NumberFormat(region.locale, {
        style: 'currency',
        currency: region.currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(converted),
      approximate: true,
      source: 'live',
      rateDate: fx?.fetchedAt ?? null,
    };
  }
  const fallback = formatPriceForRegion(usd, region);
  return { ...fallback, source: 'static', rateDate: null };
}

/**
 * Canonical price formatter (Stage 2, S2-2) — the one plain
 * amount+currency+locale formatter every call site should use.
 * Plain `Intl.NumberFormat` currency formatting with the currency's
 * default fraction digits (USD → 2, JPY → 0, …), so output is
 * identical to the inline formatters it replaces. Pass
 * `fractionDigits` only when a call site deliberately forces a
 * fixed precision (e.g. computed money labels that always show 2
 * decimals, even for zero-decimal currencies) — the option is
 * explicit at the call site, never a hidden default.
 *
 * This is NOT the FX-aware path: converting USD into a region
 * currency stays with `formatPriceForRegion` /
 * `formatPriceForRegionWithRates` (approximate, "≈", live/static
 * source labelled). `formatPrice` formats an amount that is
 * already in `currency` — it never converts.
 */
export function formatPrice(
  amount: number,
  currency: CurrencyCode,
  locale = 'en-US',
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    ...(options?.minimumFractionDigits !== undefined
      ? { minimumFractionDigits: options.minimumFractionDigits }
      : {}),
    ...(options?.maximumFractionDigits !== undefined
      ? { maximumFractionDigits: options.maximumFractionDigits }
      : {}),
  }).format(amount);
}

/** Format a plain USD amount (the small "original price" text). */
export function formatUsd(usd: number): string {
  return formatPrice(usd, 'USD', 'en-US');
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
      // Worldwide expansion (2026-11-02).
      'Asia/Tokyo': 'JP',
      'Asia/Seoul': 'KR',
      'Asia/Taipei': 'TW',
      'Asia/Jakarta': 'ID',
      'Asia/Makassar': 'ID',
      'Asia/Jayapura': 'ID',
      'Asia/Kuala_Lumpur': 'MY',
      'Asia/Kuching': 'MY',
      'Asia/Singapore': 'SG',
      'Asia/Bangkok': 'TH',
      'Asia/Ho_Chi_Minh': 'VN',
      'Asia/Manila': 'PH',
      'Asia/Dhaka': 'BD',
      'Asia/Colombo': 'LK',
      'Asia/Kathmandu': 'NP',
      'Asia/Qatar': 'QA',
      'Asia/Istanbul': 'TR',
      'Europe/Istanbul': 'TR',
      'Africa/Cairo': 'EG',
      'Africa/Lagos': 'NG',
      'Africa/Nairobi': 'KE',
      'Africa/Casablanca': 'MA',
      'Africa/Abidjan': 'CI',
      'Africa/Dakar': 'SN',
      'Africa/Kampala': 'UG',
      'Africa/Accra': 'GH',
      'Africa/Johannesburg': 'ZA',
      'America/Sao_Paulo': 'BR',
      'America/Fortaleza': 'BR',
      'America/Recife': 'BR',
      'America/Manaus': 'BR',
      'America/Belem': 'BR',
      'America/Mexico_City': 'MX',
      'America/Tijuana': 'MX',
      'America/Monterrey': 'MX',
      'America/Cancun': 'MX',
      'America/Argentina/Buenos_Aires': 'AR',
      'America/Santiago': 'CL',
      'America/Bogota': 'CO',
      'America/Lima': 'PE',
      'America/Montevideo': 'UY',
      'America/La_Paz': 'BO',
      'America/Asuncion': 'PY',
      'America/Caracas': 'VE',
      'America/Costa_Rica': 'CR',
      'America/Guayaquil': 'EC',
      'America/Guatemala': 'GT',
      'America/Santo_Domingo': 'DO',
      'America/Panama': 'PA',
      'America/Tegucigalpa': 'HN',
      'America/Managua': 'NI',
      'Europe/Warsaw': 'PL',
      'Europe/Prague': 'CZ',
      'Europe/Athens': 'GR',
      'Europe/Dublin': 'IE',
      'Europe/Vienna': 'AT',
      'Europe/Brussels': 'BE',
      'Europe/Amsterdam': 'NL',
      'Europe/Zurich': 'CH',
    };
    if (tzMap[timeZone]) return tzMap[timeZone];
    if (timeZone.startsWith('America/Argentina/')) return 'AR';
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
      // Worldwide expansion (2026-11-02). Full locale tags only
      // for ambiguous languages (Spanish variants, Arabic
      // variants, Portuguese): bare 'es' still maps to ES and
      // bare 'pt' is deliberately unmapped (Portugal is not in
      // the registry, so it gets the global fallback, not BR).
      ja: 'JP',
      'ja-jp': 'JP',
      ko: 'KR',
      'ko-kr': 'KR',
      tr: 'TR',
      'tr-tr': 'TR',
      pl: 'PL',
      'pl-pl': 'PL',
      cs: 'CZ',
      el: 'GR',
      th: 'TH',
      vi: 'VN',
      id: 'ID',
      'id-id': 'ID',
      ms: 'MY',
      nl: 'NL',
      'nl-nl': 'NL',
      'nl-be': 'BE',
      'pt-br': 'BR',
      'es-mx': 'MX',
      'es-ar': 'AR',
      'es-cl': 'CL',
      'es-co': 'CO',
      'es-pe': 'PE',
      'es-uy': 'UY',
      'es-bo': 'BO',
      'es-py': 'PY',
      'es-ve': 'VE',
      'es-cr': 'CR',
      'es-ec': 'EC',
      'es-gt': 'GT',
      'es-do': 'DO',
      'es-pa': 'PA',
      'es-hn': 'HN',
      'es-ni': 'NI',
      'ar-eg': 'EG',
      'ar-ma': 'MA',
      'ar-qa': 'QA',
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
