/**
 * Tests for the 20-language i18n expansion (S5#12, lib/i18n.ts +
 * lib/region.ts).
 *
 * Key parity (33 DictKeys × 20 languages), detection (country →
 * language, browser tag → language), the auto-translated label set,
 * and the RTL flag. Translations themselves are machine
 * translations — these tests check coverage and plumbing, not
 * linguistic quality.
 */

import { describe, expect, it } from 'vitest';
import { DICTIONARIES, tFor, type DictKey } from '@/lib/i18n';
import {
  AUTO_TRANSLATED_LANGUAGES,
  COUNTRY_LANGUAGE,
  LANGUAGES,
  REGIONS,
  SUPPORTED_LANGUAGES,
  isAutoTranslatedLanguage,
  isRtlLanguage,
  isSupportedLanguage,
  languageForCountry,
  languageFromBrowserLanguage,
  languageMeta,
} from '@/lib/region';

const EXPECTED_KEYS: DictKey[] = [
  'navHome',
  'navFeatures',
  'navHowItWorks',
  'navPricing',
  'navSignIn',
  'navGetStarted',
  'navDashboard',
  'navTools',
  'navSearch',
  'navDeals',
  'navCompare',
  'navBrands',
  'heroBadge',
  'heroTitleA',
  'heroTitleB',
  'heroTitleC',
  'heroSubtitle',
  'heroCtaStart',
  'heroCtaSearch',
  'heroNoCard',
  'heroFreeForever',
  'searchPlaceholder',
  'buy',
  'whereToBuy',
  'inStock',
  'outOfStock',
  'noListings',
  'bannerDetected',
  'bannerChange',
  'bannerDismiss',
  'bannerOfferUrdu',
  'languageEnglish',
  'languageRomanUrdu',
];

const NEW_12 = ['ar', 'zh', 'ja', 'ko', 'hi', 'bn', 'nl', 'sv', 'pl', 'ru', 'id', 'vi'] as const;

describe('20-language registry', () => {
  it('supports exactly 20 languages', () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(20);
    expect(LANGUAGES).toHaveLength(20);
    expect(new Set(SUPPORTED_LANGUAGES).size).toBe(20);
  });

  it('has one dictionary per language with all 33 keys, no more and no fewer', () => {
    expect(Object.keys(DICTIONARIES).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    for (const lang of SUPPORTED_LANGUAGES) {
      const keys = Object.keys(DICTIONARIES[lang]).sort();
      expect(keys).toEqual([...EXPECTED_KEYS].sort());
      for (const key of EXPECTED_KEYS) {
        expect(typeof DICTIONARIES[lang][key]).toBe('string');
        expect(DICTIONARIES[lang][key].length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the original 8 languages (no regression)', () => {
    for (const lang of ['en', 'ur', 'de', 'fr', 'es', 'it', 'pt', 'tr'] as const) {
      expect(tFor(lang, 'navHome')).toBeTruthy();
      expect(tFor(lang, 'buy')).toBeTruthy();
    }
    expect(tFor('de', 'buy')).toBe('Kaufen');
    expect(tFor('ur', 'buy')).toBe('Kharidein');
  });

  it('gives every new language a real translation, not the English string', () => {
    // navHome is skipped: Dutch genuinely uses "Home" too.
    for (const lang of NEW_12) {
      expect(tFor(lang, 'navFeatures')).not.toBe(tFor('en', 'navFeatures'));
      expect(tFor(lang, 'buy')).not.toBe(tFor('en', 'buy'));
    }
  });
});

describe('auto-translated labelling', () => {
  it('marks exactly the 12 new languages as auto-translated', () => {
    expect([...AUTO_TRANSLATED_LANGUAGES].sort()).toEqual([...NEW_12].sort());
    for (const lang of NEW_12) {
      expect(isAutoTranslatedLanguage(lang)).toBe(true);
      expect(languageMeta(lang).autoTranslated).toBe(true);
    }
    for (const lang of ['en', 'ur', 'de', 'fr', 'es', 'it', 'pt', 'tr'] as const) {
      expect(isAutoTranslatedLanguage(lang)).toBe(false);
      expect(languageMeta(lang).autoTranslated).toBeFalsy();
    }
  });

  it('falls back to English metadata for an unknown code', () => {
    expect(languageMeta('xx' as never).code).toBe('en');
  });
});

describe('detection', () => {
  it('maps the new languages from their countries', () => {
    expect(languageForCountry('JP')).toBe('ja');
    expect(languageForCountry('KR')).toBe('ko');
    expect(languageForCountry('TW')).toBe('zh');
    expect(languageForCountry('ID')).toBe('id');
    expect(languageForCountry('VN')).toBe('vi');
    expect(languageForCountry('BD')).toBe('bn');
    expect(languageForCountry('NL')).toBe('nl');
    expect(languageForCountry('PL')).toBe('pl');
    expect(languageForCountry('AE')).toBe('ar');
    expect(languageForCountry('SA')).toBe('ar');
    expect(languageForCountry('EG')).toBe('ar');
    expect(languageForCountry('QA')).toBe('ar');
    expect(languageForCountry('MA')).toBe('ar');
  });

  it('keeps India on English (Hindi is browser-language only)', () => {
    expect(languageForCountry('IN')).toBe('en');
    expect(languageFromBrowserLanguage('hi-IN')).toBe('hi');
  });

  it('maps the new languages from browser tags', () => {
    expect(languageFromBrowserLanguage('ar-EG')).toBe('ar');
    expect(languageFromBrowserLanguage('zh-CN')).toBe('zh');
    expect(languageFromBrowserLanguage('ja-JP')).toBe('ja');
    expect(languageFromBrowserLanguage('ru-RU')).toBe('ru');
    expect(languageFromBrowserLanguage('sv-SE')).toBe('sv');
    expect(languageFromBrowserLanguage('bn-BD')).toBe('bn');
    expect(languageFromBrowserLanguage('vi-VN')).toBe('vi');
    expect(languageFromBrowserLanguage('id-ID')).toBe('id');
    expect(languageFromBrowserLanguage('ko-KR')).toBe('ko');
    expect(languageFromBrowserLanguage('nl-NL')).toBe('nl');
    expect(languageFromBrowserLanguage('pl-PL')).toBe('pl');
  });

  it('still falls back to English for unknown countries and tags', () => {
    expect(languageForCountry('IS')).toBe('en');
    expect(languageForCountry(null)).toBe('en');
    expect(languageFromBrowserLanguage('cs-CZ')).toBeNull();
    expect(languageFromBrowserLanguage(null)).toBeNull();
  });

  it('keeps every region code covered by COUNTRY_LANGUAGE and consistent with its suggested language', () => {
    for (const region of REGIONS) {
      expect(COUNTRY_LANGUAGE[region.code]).toBeDefined();
      expect(region.suggestedLanguage).toBe(COUNTRY_LANGUAGE[region.code]);
      expect(isSupportedLanguage(region.suggestedLanguage)).toBe(true);
    }
  });
});

describe('RTL', () => {
  it('flags Arabic as RTL and nothing else', () => {
    expect(isRtlLanguage('ar')).toBe(true);
    expect(languageMeta('ar').rtl).toBe(true);
    for (const lang of SUPPORTED_LANGUAGES) {
      if (lang !== 'ar') {
        expect(isRtlLanguage(lang)).toBe(false);
        expect(languageMeta(lang).rtl).toBeFalsy();
      }
    }
    // Roman Urdu is Latin-script and stays LTR.
    expect(isRtlLanguage('ur')).toBe(false);
    expect(isRtlLanguage(null)).toBe(false);
    expect(isRtlLanguage(undefined)).toBe(false);
  });
});

describe('tFor fallback', () => {
  it('returns the English string for a missing key instead of crashing', () => {
    const dict = DICTIONARIES.ja as Record<string, string | undefined>;
    const saved = dict.buy;
    delete dict.buy;
    try {
      expect(tFor('ja', 'buy')).toBe(DICTIONARIES.en.buy);
    } finally {
      if (saved !== undefined) dict.buy = saved;
    }
  });
});
