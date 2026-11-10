import './globals.css';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import type { Language } from '@/lib/region';
import { SUPPORTED_LANGUAGES, isRtlLanguage, isSupportedLanguage } from '@/lib/region';
import { Toaster } from '@/components/ui/toaster';
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { AnalyticsProvider } from '@/components/providers/analytics-provider';
import { PageTransition } from '@/components/layout/page-transition';
import dynamic from 'next/dynamic';
// P0 fix (2026-11-09 audit): the AI chat widget (Vercel AI SDK
// useChat) was statically mounted on every page. It now loads as a
// separate chunk instead of inflating the first-paint bundle. (No
// ssr:false here — that is not allowed in a Server Component — but
// the chunk split alone removes it from the initial JS.)
// CRASH FIX (2026-11-09, same day): NO `.then(m => m.X)` selector
// here. This file is a Server Component, and the RSC runtime forbids
// dotting into a client module — `.then` on the import threw
// "Cannot access AIDealFinderWidget.then on the server" and crashed
// every page. Plain dynamic() resolves the module's DEFAULT export,
// so the widget file now has one (named export kept).
const AIDealFinderWidget = dynamic(
  () => import('@/components/chat/ai-deal-finder-widget')
);
import { appConfig } from '@/lib/config/app';
import {
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  toJsonLdGraph,
} from '@/lib/json-ld';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import CookieConsentBanner from '@/components/privacy/cookie-consent';
import PostHogProvider from '@/components/analytics/posthog-provider';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

// hreflang (Section 2 item 13, S2#13 part): x-default + one
// alternate per supported UI language (lib/i18n.ts dictionaries /
// lib/region.ts SUPPORTED_LANGUAGES — 20 languages since S5#12). There are NO localized routes — language is chosen
// client-side (sb-language cookie / localStorage) — so every
// alternate points at the same canonical URL rather than inventing
// /de/, /ur/ … paths that do not exist. That is the honest limit
// of cookie-based i18n: the x-default entry is the useful signal
// here, and per-language URLs need localized routes first (wave 2).
// /products/[slug] is dynamic, so it inherits this map and should
// set its own per-product alternates in its generateMetadata
// (wave 2 — not this file's scope).
const languageAlternates: Record<string, string> = {
  'x-default': appConfig.url,
};
for (const lang of SUPPORTED_LANGUAGES) {
  languageAlternates[lang] = appConfig.url;
}

export const metadata: Metadata = {
  metadataBase: new URL(appConfig.url),
  title: {
    default: `${appConfig.name} — AI-Powered Shopping Intelligence`,
    template: `%s | ${appConfig.name}`,
  },
  description: appConfig.description,
  keywords: [
    'price comparison',
    'AI shopping assistant',
    'product search',
    'price tracking',
    'deal alerts',
    'price drop prediction',
    'smart shopping',
    'product reviews',
  ],
  authors: [{ name: appConfig.name }],
  creator: appConfig.name,
  publisher: appConfig.name,
  manifest: '/manifest.json',
  applicationName: appConfig.shortName,
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: appConfig.shortName,
  },
  openGraph: {
    title: `${appConfig.name} — AI-Powered Shopping Intelligence`,
    description: appConfig.description,
    type: 'website',
    siteName: appConfig.name,
    url: appConfig.url,
    // Root locale is en_US: the site has no localized routes —
    // language is a client-side cookie choice — so the default
    // locale stays English. Per-language og:locale:alternate values
    // would need real localized URLs first.
    locale: 'en_US',
    // NOTE: no explicit images here — Next auto-discovers
    // app/opengraph-image.tsx. The old static /og-image.png
    // reference was removed: that file never existed in public/.
  },
  twitter: {
    card: 'summary_large_image',
    title: appConfig.name,
    description: appConfig.description,
    // NOTE: same as above — twitter:image comes from
    // app/opengraph-image.tsx automatically.
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: appConfig.url,
    languages: languageAlternates,
    types: {
      'application/rss+xml': '/rss.xml',
    },
  },
  themeColor: '#1e40af',
};

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: appConfig.name,
  description: appConfig.description,
  url: appConfig.url,
  applicationCategory: 'ShoppingApplication',
  operatingSystem: 'Web',
  offers: {
    '@type': 'AggregateOffer',
    priceCurrency: 'USD',
    lowPrice: '0',
    highPrice: '9.99',
    offerCount: 2,
  },
  featureList: [
    'AI product search',
    'Price comparison across retailers',
    'Price drop predictions',
    'Smart deal finder',
    'Price alerts',
    'Product recommendations',
    'Wishlist with price tracking',
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Server-initial region/language for the first-paint flash fix (workstream D):
  // a saved sb-country cookie wins; otherwise Vercel's geo header supplies the
  // detected country. The provider validates both (unknown code → US display
  // region, invalid language → English) and a saved localStorage language still
  // wins client-side, so these props are defaults, never overrides.
  const savedCountry = cookies().get('sb-country')?.value ?? null;
  const savedLanguage = cookies().get('sb-language')?.value ?? null;
  const geoCountry = headers().get('x-vercel-ip-country');
  // CSP Phase 2 nonce (set per request by middleware.ts). Passed to
  // Providers so client components can put it on their <script>
  // tags, and used on this layout's own JSON-LD script below.
  const nonce = headers().get('x-nonce');
  const initialCountryCode = savedCountry ?? geoCountry ?? null;
  const initialSource = savedCountry ? 'saved' : 'detected';
  // S5#12 RTL + lang: the saved sb-language cookie is the only
  // server-known language. A supported saved language sets both
  // <html lang> and dir (rtl for Arabic); anything else stays
  // lang="en" dir="ltr". The client provider still owns live
  // switching — it sets document.documentElement.lang on change
  // (dir flips on the next load; see lib/i18n.ts).
  const htmlLang =
    savedLanguage && isSupportedLanguage(savedLanguage) ? savedLanguage : 'en';
  const htmlDir = isRtlLanguage(htmlLang) ? 'rtl' : 'ltr';
  // Site-wide structured data (S4#15 builders, imported only):
  // WebApplication (existing) + Organization + WebSite in one
  // @graph. No SearchAction — /search ignores ?q= — and no
  // social profiles: no verified handle exists.
  const siteJsonLd = toJsonLdGraph(
    structuredData,
    buildOrganizationJsonLd(appConfig.url),
    buildWebSiteJsonLd(appConfig.url)
  );
  return (
    <html lang={htmlLang} dir={htmlDir} suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="theme-color" content="#1e40af" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <script
          type="application/ld+json"
          nonce={nonce ?? undefined}
          dangerouslySetInnerHTML={{ __html: siteJsonLd }}
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers
          initialCountryCode={initialCountryCode}
          initialLanguage={savedLanguage as Language | null}
          initialSource={initialSource}
          nonce={nonce}
        >
          <PageTransition>{children}</PageTransition>
          <Toaster />
          <ServiceWorkerRegister />
          <InstallPrompt />
          <AIDealFinderWidget />
        </Providers>
        {/* Vercel Analytics (visitors + page views) + Speed Insights
            (real-user Core Web Vitals). Both are free, need no API keys,
            and are cookie-free — they only activate on Vercel hosting. */}
        <Analytics />
        <SpeedInsights />
        {/* Cookie-consent banner (necessary + analytics categories) and
            PostHog product analytics — PostHog stays dormant until its
            key is set AND the visitor accepts analytics. */}
        <CookieConsentBanner />
        <PostHogProvider />
        {/* GA4 + Meta Pixel (Section 3 item 16): env-gated IDs,
            cookie-consent gated, nonce-aware. Dormant without IDs
            and without analytics consent — see
            components/providers/analytics-provider.tsx. */}
        <AnalyticsProvider nonce={nonce} />
      </body>
    </html>
  );
}
