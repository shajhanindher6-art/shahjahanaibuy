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

const inter = Inter({
  // Section 16, #48: latin alone covered only the Latin-script
  // languages. latin-ext (pl, tr, vi diacritics), cyrillic +
  // cyrillic-ext (ru) and vietnamese (vi) now cover 14 of the 20
  // supported languages with real Inter glyphs. TRADEOFF: each
  // subset adds font payload (larger first-paint download), and
  // Inter ships NO glyphs for ar, zh, ja, ko, hi, bn — those six
  // still fall back to system fonts (the browser renders them, just
  // not in Inter). Adding subsets for scripts Inter does not ship
  // would change nothing; a different font family would be needed
  // for those scripts, which is a bigger design decision, not this
  // item.
  subsets: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'vietnamese'],
  variable: '--font-inter',
});

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
  // Section 15, P2-5 — no hardcoded chargeable figure. The old
  // structured-data offer block claimed a 9.99 high price as if
  // Premium were purchasable — $9.99 is a PLANNED price label
  // (lib/tiers.ts), not a live charge (Stripe is in test mode). Only the Free
  // plan is live today, so the structured data offers exactly
  // that; paid tiers are not listed as purchasable offers.
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock',
    description: 'Free plan. Paid plans are planned — no live charge yet.',
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
  // lang="en" dir="ltr". The client provider owns live switching
  // and flips BOTH lang and dir on change, no reload needed
  // (components/region/region-provider.tsx sets
  // document.documentElement.dir in its [language] effect).
  const htmlLang =
    savedLanguage && isSupportedLanguage(savedLanguage) ? savedLanguage : 'en';
  const htmlDir = isRtlLanguage(htmlLang) ? 'rtl' : 'ltr';
  // Site-wide structured data (S4#15 builders, imported only):
  // WebApplication (existing) + Organization + WebSite in one
  // @graph. SearchAction IS wired: /search reads `?q=` (Section
  // 10, chunk 1), so the sitelinks search box target is real.
  // No social profiles: no verified handle exists.
  const siteJsonLd = toJsonLdGraph(
    structuredData,
    buildOrganizationJsonLd(appConfig.url),
    buildWebSiteJsonLd(appConfig.url, `${appConfig.url}/search?q={search_term_string}`)
  );
  return (
    <html lang={htmlLang} dir={htmlDir} suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        {/* Section 16, #41: iOS startup image. This reuses the
            existing 512px app icon rather than a new binary:
            a true device-size splash (e.g. 1170x2532) would need a
            new PNG via the GitHub web UI. The icon is a valid
            startup image, just not a full-bleed splash. The iOS
            "Add to Home Screen" hint itself already exists — the
            InstallPrompt component shows the manual Share → Add to
            Home Screen steps on iPhone/iPad (Section 14, P-1) and
            is mounted in this layout — so no second prompt was
            built here. */}
        <link rel="apple-touch-startup-image" href="/icon-512.png" />
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
        {/* Skip link (Section 10, 2026-11-11): first focusable
            element on every page. Jumps to the #main-content wrapper
            below (pages render their own <main> inside it); the link
            is visually hidden until keyboard focus. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          Skip to content
        </a>
        <Providers
          initialCountryCode={initialCountryCode}
          initialLanguage={savedLanguage as Language | null}
          initialSource={initialSource}
          nonce={nonce}
        >
          <div id="main-content" tabIndex={-1} className="outline-none">
            <PageTransition>{children}</PageTransition>
          </div>
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
