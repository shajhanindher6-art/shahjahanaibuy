/**
 * Minimal multi-language dictionary: English + Roman Urdu.
 *
 * LIMIT (deliberate, stated to the user): only the strings listed
 * here are translated — header nav, hero, search placeholder, Buy /
 * Where to Buy / stock labels, and the region banner. ALL other page
 * content stays English. This is not full-page translation; product
 * descriptions, reviews, deal copy and dashboard text are English
 * until a full i18n pass is done.
 *
 * Language defaults to English for every visitor. Visitors from
 * Pakistan are *offered* Roman Urdu (via the region banner), never
 * switched automatically.
 */

import type { Language } from './region';

export type DictKey =
  | 'navHome'
  | 'navFeatures'
  | 'navHowItWorks'
  | 'navPricing'
  | 'navSignIn'
  | 'navGetStarted'
  | 'navDashboard'
  | 'heroBadge'
  | 'heroTitleA'
  | 'heroTitleB'
  | 'heroTitleC'
  | 'heroSubtitle'
  | 'heroCtaStart'
  | 'heroCtaSearch'
  | 'heroNoCard'
  | 'heroFreeForever'
  | 'searchPlaceholder'
  | 'buy'
  | 'whereToBuy'
  | 'inStock'
  | 'outOfStock'
  | 'noListings'
  | 'bannerDetected'
  | 'bannerChange'
  | 'bannerDismiss'
  | 'bannerOfferUrdu'
  | 'languageEnglish'
  | 'languageRomanUrdu';

export const DICTIONARIES: Record<Language, Record<DictKey, string>> = {
  en: {
    navHome: 'Home',
    navFeatures: 'Features',
    navHowItWorks: 'How It Works',
    navPricing: 'Pricing',
    navSignIn: 'Sign In',
    navGetStarted: 'Get Started',
    navDashboard: 'Dashboard',
    heroBadge: 'AI-Powered Shopping Intelligence',
    heroTitleA: 'Make smarter',
    heroTitleB: 'shopping decisions',
    heroTitleC: 'with AI',
    heroSubtitle:
      'SmartBuy AI analyzes millions of products, reviews, and prices in real-time to help you find the best deals, avoid bad purchases, and shop with confidence.',
    heroCtaStart: 'Get Started Free',
    heroCtaSearch: 'Try AI Search',
    heroNoCard: 'No credit card required',
    heroFreeForever: 'Free forever plan',
    searchPlaceholder: 'e.g. Best gaming laptop under $1000',
    buy: 'Buy',
    whereToBuy: 'Where to Buy',
    inStock: 'In Stock',
    outOfStock: 'Out of Stock',
    noListings: 'No retailer listings yet for this product.',
    bannerDetected: "You're browsing from {country} — prices shown in {currency} (≈)",
    bannerChange: 'Change',
    bannerDismiss: 'Dismiss',
    bannerOfferUrdu: 'Roman Urdu mein dekhein',
    languageEnglish: 'English',
    languageRomanUrdu: 'Roman Urdu',
  },
  ur: {
    navHome: 'Home',
    navFeatures: 'Khasiyat',
    navHowItWorks: 'Ye Kaise Kaam Karta Hai',
    navPricing: 'Qeematein',
    navSignIn: 'Sign In',
    navGetStarted: 'Shuru Karein',
    navDashboard: 'Dashboard',
    heroBadge: 'AI Shopping Intelligence',
    heroTitleA: 'AI ke saath',
    heroTitleB: 'behtareen shopping faisle',
    heroTitleC: 'karein',
    heroSubtitle:
      'SmartBuy AI lakhon products, reviews aur prices ko real-time mein analyze kar ke aap ko behtareen deals dhoondne, ghalat khareedari se bachne aur itminan se shopping karne mein madad karta hai.',
    heroCtaStart: 'Muft Shuru Karein',
    heroCtaSearch: 'AI Search Try Karein',
    heroNoCard: 'Credit card ki zaroorat nahi',
    heroFreeForever: 'Hamesha ke liye muft plan',
    searchPlaceholder: 'masalan: $1000 se kam behtareen gaming laptop',
    buy: 'Kharidein',
    whereToBuy: 'Kahan Se Kharidein',
    inStock: 'Stock Mein Hai',
    outOfStock: 'Stock Mein Nahi',
    noListings: 'Is product ke liye abhi koi retailer listing nahi hai.',
    bannerDetected: 'Aap {country} se browse kar rahe hain — qeematein {currency} mein dikhayi ja rahi hain (≈)',
    bannerChange: 'Tabdeel Karein',
    bannerDismiss: 'Band Karein',
    bannerOfferUrdu: 'Roman Urdu mein dekhein',
    languageEnglish: 'English',
    languageRomanUrdu: 'Roman Urdu',
  },
};

export function tFor(language: Language, key: DictKey): string {
  return DICTIONARIES[language][key] ?? DICTIONARIES.en[key];
}

/** Fill {country} / {currency} placeholders in a banner string. */
export function bannerText(
  language: Language,
  countryName: string,
  currency: string
): string {
  return tFor(language, 'bannerDetected')
    .replace('{country}', countryName)
    .replace('{currency}', currency);
}
