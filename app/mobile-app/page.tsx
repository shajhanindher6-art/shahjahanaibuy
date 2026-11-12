/**
 * Mobile app page — /mobile-app.
 *
 * Honest status page (Section 6 item 18 — trimmed, in-repo only):
 * there is NO native app in the App Store / Google Play yet, and no
 * launch date is promised. What visitors CAN do today is install the
 * PWA (progressive web app) — Android/Chrome via the browser's
 * install prompt, iOS via Share → Add to Home Screen — with the
 * offline limits from docs/pwa.md stated plainly. A waitlist form
 * records interest for a future native app.
 *
 * No Capacitor / React Native app is built here: that needs a
 * separate repo, store accounts, and (for Apple) a $99/year
 * developer account — out of scope for this batch.
 */

import Link from 'next/link';
import { Smartphone } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';
import { WaitlistForm } from '@/components/mobile-app/waitlist-form';

// Section 13, Chunk E: self-canonical + Open Graph metadata (the
// root layout's canonical points at the homepage, so without this
// the page self-canonicalizes to /).
export const metadata: Metadata = {
  title: 'Mobile app — SmartBuy AI',
  description:
    'There is no native SmartBuy AI app in the App Store or Google Play yet, and no launch date is promised. Until there is, the website itself installs as an app on your phone.',
  alternates: {
    canonical: `${appConfig.url}/mobile-app`,
  },
  openGraph: {
    title: 'Mobile app — SmartBuy AI',
    description:
      'There is no native SmartBuy AI app in the App Store or Google Play yet, and no launch date is promised. Until there is, the website itself installs as an app on your phone.',
    url: `${appConfig.url}/mobile-app`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Mobile app — SmartBuy AI',
    description:
      'There is no native SmartBuy AI app in the App Store or Google Play yet, and no launch date is promised. Until there is, the website itself installs as an app on your phone.',
  },
};

export default function MobileAppPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Mobile app"
        description="There is no native SmartBuy AI app in the App Store or Google Play yet, and no launch date is promised. Until there is, the website itself installs as an app on your phone."
        path="/mobile-app"
        crumbs={[ { name: "Home", path: "/" }, { name: "Mobile app" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Smartphone className="h-7 w-7 text-blue-600" /> Mobile app
          </h1>
          <p className="mt-2 text-muted-foreground">
            There is no native SmartBuy AI app in the App Store or Google
            Play yet, and no launch date is promised. Until there is, the
            website itself installs as an app on your phone — see below —
            and you can join the waitlist to hear when a native app
            arrives.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Install SmartBuy AI on your phone today</h2>
          <p className="mt-3 text-muted-foreground">
            SmartBuy AI is a progressive web app (PWA): installing it adds
            an icon to your home screen and opens the site full-screen,
            without an app-store download.
          </p>
          <h3 className="mt-6 font-semibold">Android / Chrome</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Open this site in Chrome on your phone.</li>
            <li>
              When the install card appears, tap <strong>Install</strong>.
              (If you dismissed it earlier, Chrome&apos;s menu →{' '}
              <strong>Install app</strong> / <strong>Add to Home screen</strong>{' '}
              still works.)
            </li>
            <li>The SmartBuy icon appears on your home screen.</li>
          </ol>
          <h3 className="mt-6 font-semibold">iPhone / iPad (Safari)</h3>
          <p className="mt-2 text-muted-foreground">
            Safari does not offer an install prompt, so installation is
            manual:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Open this site in Safari.</li>
            <li>
              Tap the <strong>Share</strong> button (the square with an
              arrow pointing up).
            </li>
            <li>
              Scroll down and tap <strong>Add to Home Screen</strong>,
              then <strong>Add</strong>.
            </li>
          </ol>

          <h2 className="mt-8 text-xl font-semibold">What works offline, and what does not</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>
              <strong>Works offline:</strong> pages you have already
              visited, and their images — they are cached on your device
              and keep opening without a connection.
            </li>
            <li>
              <strong>Needs a connection:</strong> live prices, search,
              compare results, price-drop alerts, and retailer links.
              Prices are never served stale from the cache.
            </li>
            <li>
              <strong>Not available:</strong> there is no background sync
              and no offline wishlist or alert queue — anything you do
              while offline is not saved for later.
            </li>
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            The short version: the installed web app is a faster way into
            the same website, not a separate offline app.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Native app waitlist</h2>
          <p className="mt-3 text-muted-foreground">
            Join the waitlist and we will only email you when a native app
            is available for your platform. No launch date is promised,
            and no other emails are sent.
          </p>
          <WaitlistForm />

          <p className="mt-8 text-sm text-muted-foreground">
            Prefer the website as it is? It works in any modern mobile
            browser with nothing to install — start on the{' '}
            <Link href="/" className="underline">
              home page
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
