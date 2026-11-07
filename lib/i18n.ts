/**
 * Multi-language dictionary: 8 UI languages (Option 4 Part 1).
 *
 * LIMIT (deliberate, stated to the user): only the strings listed
 * here are translated — header nav, hero, search placeholder, Buy /
 * Where to Buy / stock labels, and the region banner. ALL other page
 * content stays English. This is not full-page translation; product
 * descriptions, reviews, deal copy and dashboard text are English
 * until a full i18n pass is done.
 *
 * AUTO-DETECTION (Option 4 Part 1, replacing the old
 * "never auto-switch" rule): on first visit the UI language is
 * resolved in this order — (a) saved choice in localStorage
 * 'sb-language' (never overridden by detection), (b) geo-detected
 * country → language map (lib/region.ts COUNTRY_LANGUAGE),
 * (c) browser navigator.language primary subtag mapped into the
 * supported set, (d) English. A manual Country Switcher choice
 * never forces a language change; language is only changed by
 * detection (first visit, no saved choice) or by the header
 * Language Switcher, which persists to 'sb-language'.
 *
 * TRANSLATION QUALITY (honest): these are functional chrome
 * strings written for this feature, not professionally reviewed
 * copy. Short labels may read slightly formally in some languages.
 *
 * KEY PARITY: every language must define all 28 DictKeys, no more
 * and no fewer (scripted check). `bannerOfferUrdu` is retained for
 * key parity but is no longer rendered by the banner: the banner
 * now offers the detected language by its native name instead of
 * a Roman-Urdu-specific button (see region-banner.tsx).
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
      'SmartBuy AI analyzes products, reviews, and prices in real-time to help you find the best deals, avoid bad purchases, and shop with confidence.',
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
      'SmartBuy AI products, reviews aur prices ko real-time mein analyze kar ke aap ko behtareen deals dhoondne, ghalat khareedari se bachne aur itminan se shopping karne mein madad karta hai.',
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
  de: {
    navHome: 'Start',
    navFeatures: 'Funktionen',
    navHowItWorks: 'So funktioniert es',
    navPricing: 'Preise',
    navSignIn: 'Anmelden',
    navGetStarted: 'Kostenlos starten',
    navDashboard: 'Dashboard',
    heroBadge: 'KI-gestützte Shopping-Intelligenz',
    heroTitleA: 'Triff intelligentere',
    heroTitleB: 'Kaufentscheidungen',
    heroTitleC: 'mit KI',
    heroSubtitle:
      'SmartBuy AI analysiert Produkte, Bewertungen und Preise in Echtzeit, damit du die besten Angebote findest, Fehlkäufe vermeidest und mit gutem Gefühl einkaufst.',
    heroCtaStart: 'Kostenlos starten',
    heroCtaSearch: 'KI-Suche ausprobieren',
    heroNoCard: 'Keine Kreditkarte erforderlich',
    heroFreeForever: 'Kostenloser Tarif für immer',
    searchPlaceholder: 'z. B. bester Gaming-Laptop unter 1000 $',
    buy: 'Kaufen',
    whereToBuy: 'Wo kaufen',
    inStock: 'Auf Lager',
    outOfStock: 'Nicht auf Lager',
    noListings: 'Für dieses Produkt gibt es noch keine Händlerangebote.',
    bannerDetected: 'Du surfst aus {country} — Preise werden in {currency} angezeigt (≈)',
    bannerChange: 'Ändern',
    bannerDismiss: 'Schließen',
    bannerOfferUrdu: 'Auf Roman-Urdu ansehen',
    languageEnglish: 'Englisch',
    languageRomanUrdu: 'Roman-Urdu',
  },
  fr: {
    navHome: 'Accueil',
    navFeatures: 'Fonctionnalités',
    navHowItWorks: 'Comment ça marche',
    navPricing: 'Tarifs',
    navSignIn: 'Se connecter',
    navGetStarted: 'Commencer gratuitement',
    navDashboard: 'Tableau de bord',
    heroBadge: 'Intelligence d’achat propulsée par l’IA',
    heroTitleA: 'Prenez de meilleures',
    heroTitleB: 'décisions d’achat',
    heroTitleC: 'avec l’IA',
    heroSubtitle:
      'SmartBuy AI analyse des produits, des avis et des prix en temps réel pour vous aider à trouver les meilleures offres, éviter les mauvais achats et acheter en toute confiance.',
    heroCtaStart: 'Commencer gratuitement',
    heroCtaSearch: 'Essayer la recherche IA',
    heroNoCard: 'Aucune carte bancaire requise',
    heroFreeForever: 'Forfait gratuit à vie',
    searchPlaceholder: 'ex. : meilleur ordinateur portable gaming à moins de 1000 $',
    buy: 'Acheter',
    whereToBuy: 'Où acheter',
    inStock: 'En stock',
    outOfStock: 'Rupture de stock',
    noListings: 'Aucune offre de commerçant pour ce produit pour le moment.',
    bannerDetected: 'Vous naviguez depuis {country} — les prix sont affichés en {currency} (≈)',
    bannerChange: 'Modifier',
    bannerDismiss: 'Fermer',
    bannerOfferUrdu: 'Voir en ourdou roman',
    languageEnglish: 'Anglais',
    languageRomanUrdu: 'Ourdou roman',
  },
  es: {
    navHome: 'Inicio',
    navFeatures: 'Funciones',
    navHowItWorks: 'Cómo funciona',
    navPricing: 'Precios',
    navSignIn: 'Iniciar sesión',
    navGetStarted: 'Empezar gratis',
    navDashboard: 'Panel',
    heroBadge: 'Inteligencia de compras con IA',
    heroTitleA: 'Toma decisiones',
    heroTitleB: 'de compra más inteligentes',
    heroTitleC: 'con IA',
    heroSubtitle:
      'SmartBuy AI analiza productos, reseñas y precios en tiempo real para ayudarte a encontrar las mejores ofertas, evitar malas compras y comprar con confianza.',
    heroCtaStart: 'Empezar gratis',
    heroCtaSearch: 'Probar la búsqueda con IA',
    heroNoCard: 'No se requiere tarjeta de crédito',
    heroFreeForever: 'Plan gratuito para siempre',
    searchPlaceholder: 'ej.: mejor portátil gaming por menos de $1000',
    buy: 'Comprar',
    whereToBuy: 'Dónde comprar',
    inStock: 'En stock',
    outOfStock: 'Agotado',
    noListings: 'Todavía no hay ofertas de tiendas para este producto.',
    bannerDetected: 'Estás navegando desde {country} — los precios se muestran en {currency} (≈)',
    bannerChange: 'Cambiar',
    bannerDismiss: 'Cerrar',
    bannerOfferUrdu: 'Ver en urdu romano',
    languageEnglish: 'Inglés',
    languageRomanUrdu: 'Urdú romano',
  },
  it: {
    navHome: 'Home',
    navFeatures: 'Funzionalità',
    navHowItWorks: 'Come funziona',
    navPricing: 'Prezzi',
    navSignIn: 'Accedi',
    navGetStarted: 'Inizia gratis',
    navDashboard: 'Dashboard',
    heroBadge: 'Intelligenza per lo shopping basata sull’IA',
    heroTitleA: 'Prendi decisioni',
    heroTitleB: 'di acquisto più intelligenti',
    heroTitleC: 'con l’IA',
    heroSubtitle:
      'SmartBuy AI analizza prodotti, recensioni e prezzi in tempo reale per aiutarti a trovare le migliori offerte, evitare acquisti sbagliati e fare shopping in tutta sicurezza.',
    heroCtaStart: 'Inizia gratis',
    heroCtaSearch: 'Prova la ricerca IA',
    heroNoCard: 'Nessuna carta di credito richiesta',
    heroFreeForever: 'Piano gratuito per sempre',
    searchPlaceholder: 'es.: miglior laptop da gaming sotto i 1000 $',
    buy: 'Acquista',
    whereToBuy: 'Dove acquistare',
    inStock: 'Disponibile',
    outOfStock: 'Non disponibile',
    noListings: 'Ancora nessuna offerta dei rivenditori per questo prodotto.',
    bannerDetected: 'Stai navigando da {country} — i prezzi sono mostrati in {currency} (≈)',
    bannerChange: 'Modifica',
    bannerDismiss: 'Chiudi',
    bannerOfferUrdu: 'Visualizza in urdu romano',
    languageEnglish: 'Inglese',
    languageRomanUrdu: 'Urdu romano',
  },
  pt: {
    navHome: 'Início',
    navFeatures: 'Recursos',
    navHowItWorks: 'Como funciona',
    navPricing: 'Preços',
    navSignIn: 'Entrar',
    navGetStarted: 'Começar grátis',
    navDashboard: 'Painel',
    heroBadge: 'Inteligência de compras com IA',
    heroTitleA: 'Tome decisões',
    heroTitleB: 'de compra mais inteligentes',
    heroTitleC: 'com IA',
    heroSubtitle:
      'O SmartBuy AI analisa produtos, avaliações e preços em tempo real para ajudar você a encontrar as melhores ofertas, evitar compras ruins e comprar com confiança.',
    heroCtaStart: 'Começar grátis',
    heroCtaSearch: 'Experimentar a busca com IA',
    heroNoCard: 'Não é necessário cartão de crédito',
    heroFreeForever: 'Plano gratuito para sempre',
    searchPlaceholder: 'ex.: melhor notebook gamer por menos de US$ 1000',
    buy: 'Comprar',
    whereToBuy: 'Onde comprar',
    inStock: 'Em estoque',
    outOfStock: 'Fora de estoque',
    noListings: 'Ainda não há ofertas de lojas para este produto.',
    bannerDetected: 'Você está navegando de {country} — os preços são mostrados em {currency} (≈)',
    bannerChange: 'Alterar',
    bannerDismiss: 'Fechar',
    bannerOfferUrdu: 'Ver em urdu romano',
    languageEnglish: 'Inglês',
    languageRomanUrdu: 'Urdu romano',
  },
  tr: {
    navHome: 'Ana Sayfa',
    navFeatures: 'Özellikler',
    navHowItWorks: 'Nasıl Çalışır',
    navPricing: 'Fiyatlar',
    navSignIn: 'Giriş Yap',
    navGetStarted: 'Ücretsiz Başla',
    navDashboard: 'Panel',
    heroBadge: 'YZ Destekli Alışveriş Zekâsı',
    heroTitleA: 'Yapay zekâ ile',
    heroTitleB: 'daha akıllı alışveriş',
    heroTitleC: 'kararları verin',
    heroSubtitle:
      'SmartBuy AI, ürünleri, yorumları ve fiyatları gerçek zamanlı olarak analiz ederek en iyi fırsatları bulmanıza, yanlış alışverişlerden kaçınmanıza ve güvenle alışveriş yapmanıza yardımcı olur.',
    heroCtaStart: 'Ücretsiz Başla',
    heroCtaSearch: 'YZ Aramasını Dene',
    heroNoCard: 'Kredi kartı gerekmez',
    heroFreeForever: 'Sonsuza dek ücretsiz plan',
    searchPlaceholder: 'örn.: 1000 $ altında en iyi oyuncu dizüstü bilgisayarı',
    buy: 'Satın Al',
    whereToBuy: 'Nereden Alınır',
    inStock: 'Stokta Var',
    outOfStock: 'Stokta Yok',
    noListings: 'Bu ürün için henüz mağaza listelemesi yok.',
    bannerDetected: '{country} üzerinden geziniyorsunuz — fiyatlar {currency} cinsinden gösteriliyor (≈)',
    bannerChange: 'Değiştir',
    bannerDismiss: 'Kapat',
    bannerOfferUrdu: 'Roma Urduca görüntüle',
    languageEnglish: 'İngilizce',
    languageRomanUrdu: 'Roma Urduca',
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
