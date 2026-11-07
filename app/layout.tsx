import './globals.css';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import type { Language } from '@/lib/region';
import { Toaster } from '@/components/ui/toaster';
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register';
import { AIDealFinderWidget } from '@/components/chat/ai-deal-finder-widget';
import { appConfig } from '@/lib/config/app';
import { toJsonLd } from '@/lib/json-ld';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import CookieConsentBanner from '@/components/privacy/cookie-consent';
import PostHogProvider from '@/components/analytics/posthog-provider';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

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
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: appConfig.name,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: appConfig.name,
    description: appConfig.description,
    images: ['/og-image.png'],
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
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="theme-color" content="#1e40af" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <script
          type="application/ld+json"
          nonce={nonce ?? undefined}
          dangerouslySetInnerHTML={{ __html: toJsonLd(structuredData) }}
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers
          initialCountryCode={initialCountryCode}
          initialLanguage={savedLanguage as Language | null}
          initialSource={initialSource}
          nonce={nonce}
        >
          {children}
          <Toaster />
          <ServiceWorkerRegister />
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
      </body>
    </html>
  );
}
