import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import { Toaster } from '@/components/ui/toaster';
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register';
import { appConfig } from '@/lib/config/app';

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
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          {children}
          <Toaster />
          <ServiceWorkerRegister />
        </Providers>
      </body>
    </html>
  );
}
