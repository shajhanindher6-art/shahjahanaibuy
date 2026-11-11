import Link from 'next/link';
import { Puzzle, Tag, Search, ShieldCheck, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SiteHeader } from '@/components/layout/site-header';
import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';
import { SiteFooter } from '@/components/layout/site-footer';
import { buildSoftwareApplicationJsonLd, toJsonLd } from '@/lib/json-ld';
// Manifest facts (name / description / version) read directly from
// extension/manifest.json so the schema can never drift from it.
import extensionManifest from '@/extension/manifest.json';

/**
 * Browser extension guide page: /extension
 *
 * The extension (extension/ folder in the repo, v2.0.0) runs on
 * Amazon, Walmart, Best Buy, eBay and AliExpress product +
 * checkout pages: a better-price overlay on product pages (best
 * recorded price + recorded price-history sparkline + browser-local
 * price alert), and a coupon panel with Apply buttons on checkout
 * pages. It is NOT on the Chrome Web Store yet (publishing needs a
 * developer account, a fee and a review), so this page documents
 * the honest install route: load the folder as an unpacked
 * extension in developer mode. No login is required and no account
 * data is collected — the extension only sends a product title to
 * SmartBuy's public API and reads public coupon codes.
 */
// Section 13, Chunk E: self-canonical + Open Graph metadata (the
// root layout's canonical points at the homepage, so without this
// the page self-canonicalizes to /).
export const metadata: Metadata = {
  title: 'SmartBuy Browser Extension — SmartBuy AI',
  description:
    'Shop on Amazon, Walmart, Best Buy, eBay or AliExpress and let SmartBuy watch prices and coupons for you — right on the retailer’s own pages.',
  alternates: {
    canonical: `${appConfig.url}/extension`,
  },
  openGraph: {
    title: 'SmartBuy Browser Extension — SmartBuy AI',
    description:
      'Shop on Amazon, Walmart, Best Buy, eBay or AliExpress and let SmartBuy watch prices and coupons for you — right on the retailer’s own pages.',
    url: `${appConfig.url}/extension`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'SmartBuy Browser Extension — SmartBuy AI',
    description:
      'Shop on Amazon, Walmart, Best Buy, eBay or AliExpress and let SmartBuy watch prices and coupons for you — right on the retailer’s own pages.',
  },
};

export default function ExtensionPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 13, Chunk E: SoftwareApplication schema from the
          extension manifest (v2.0.0) — name, description and version
          only; no store listing or price is claimed (see
          buildSoftwareApplicationJsonLd). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: toJsonLd(
            buildSoftwareApplicationJsonLd(appConfig.url, {
              name: extensionManifest.name,
              description: extensionManifest.description,
              version: extensionManifest.version,
              pagePath: '/extension',
            })
          ),
        }}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold">
              <Puzzle className="h-7 w-7 text-blue-600" /> SmartBuy Browser Extension
            </h1>
            <p className="mt-2 text-muted-foreground">
              Shop on Amazon, Walmart, Best Buy, eBay or AliExpress and let SmartBuy watch prices
              and coupons for you — right on the retailer&apos;s own pages.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">What it does</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex items-start gap-2">
                <Search className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                <span>
                  <strong>Better-price overlay:</strong> on a product page, it compares the
                  retailer&apos;s price with SmartBuy&apos;s recorded catalog price and shows an
                  overlay when SmartBuy has it cheaper — with a recorded price-history
                  sparkline and a browser-local price-alert button. The overlay can also be
                  opened on demand from the extension popup (&ldquo;Show Price History&rdquo;),
                  even when SmartBuy is not cheaper.
                </span>
              </p>
              <p className="flex items-start gap-2">
                <Tag className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                <span>
                  <strong>Coupon Apply at checkout:</strong> on a checkout or cart page, it shows
                  SmartBuy coupon codes for that retailer (e.g. SAVE10 for Amazon, BESTBUY15 for
                  Best Buy). Tap Apply on one code and the extension fills the retailer&apos;s
                  promo box and clicks its Apply button. Only the code you tap is applied —
                  nothing runs automatically.
                </span>
              </p>
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                <span>
                  <strong>Privacy:</strong> no login, no account data. Only the product title is
                  sent to SmartBuy&apos;s public API for the price check, and coupon codes
                  are read from the public coupons API.
                </span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Integration Hub — feature status (extension v2.0.0)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="flex justify-between gap-4">
                <span><strong>Better-price overlay</strong> — best recorded price, price-history sparkline and price-alert button on retailer product pages</span>
                <span className="shrink-0 font-medium text-green-700">Available in v2.0.0</span>
              </p>
              <p className="flex justify-between gap-4">
                <span><strong>Checkout coupon panel</strong> — tap Apply, retailer applies the code</span>
                <span className="shrink-0 font-medium text-green-700">Available</span>
              </p>
              <p className="flex justify-between gap-4">
                <span>
                  <strong>Background price-drop sync</strong> — re-checks products you viewed, hourly,
                  and notifies you in the browser when SmartBuy&apos;s price drops
                </span>
                <span className="shrink-0 font-medium text-green-700">Available in v2.0.0</span>
              </p>
              <p className="flex justify-between gap-4">
                <span>
                  <strong>Universal shopping cart</strong> — items you save from retailer pages live
                  in this browser only; opening them takes you to SmartBuy&apos;s wishlist
                </span>
                <span className="shrink-0 font-medium text-amber-700">Browser-local only</span>
              </p>
              <p className="text-muted-foreground">
                Cross-device cart sync requires sign-in and is <strong>not</strong> available — the
                extension never claims it. Likewise, no code is ever applied automatically: auto-trying
                codes can get a shopper&apos;s retailer account flagged, so every code needs your tap.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Integration endpoints (public, no login needed)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                The extension talks to these SmartBuy endpoints. They serve only public catalog data
                (capped responses, no account data, no secrets):
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <code>GET /api/v1/public/products?search=product name</code> — resolve a
                  retailer product title to a catalog product (slug).
                </li>
                <li>
                  <code>GET /api/v1/public/products/&lt;slug&gt;</code> — the product with its
                  latest recorded price (the overlay&apos;s best price; recorded data, not a
                  live retailer quote, and with no merchant attribution — the public API
                  does not expose per-merchant offers).
                </li>
                <li>
                  <code>GET /api/v1/public/prices?slug=&lt;slug&gt;</code> — recorded price
                  history for the overlay sparkline.
                </li>
                <li>
                  <code>GET /api/v1/extension/coupons?domain=amazon.com</code> — that merchant&apos;s
                  currently-valid coupons (expired coupons are never served). Coupons have no
                  public-API equivalent yet, so the extension still uses this route.
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Install (Chrome or Edge, free)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                The extension is not on the Chrome Web Store yet, so it installs as an unpacked
                extension from the project&apos;s <code>extension/</code> folder:
              </p>
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  Download the project (or at least the <code>extension/</code> folder) from{' '}
                  <a
                    className="text-blue-600 underline"
                    href="https://github.com/shajhanindher6-art/shahjahanaibuy"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub
                  </a>
                  .
                </li>
                <li>
                  Open <code>chrome://extensions</code> (or <code>edge://extensions</code>) and
                  turn on <strong>Developer mode</strong> (top-right switch).
                </li>
                <li>
                  Click <strong>Load unpacked</strong> and select the <code>extension/</code>{' '}
                  folder. The SmartBuy icon appears in your toolbar.
                </li>
                <li>
                  Open any supported product page — the overlay appears when a better price exists.
                  On a checkout page, the coupon panel appears when SmartBuy has a code for that
                  retailer.
                </li>
              </ol>
              <p className="text-muted-foreground">
                Honest limits: retailer page layouts change often, so a redesigned checkout may
                hide its promo box — in that case the panel says so instead of pretending a code
                was applied. Retailers with no SmartBuy coupon yet simply show no panel. Prefer
                no install at all? The <Link className="text-blue-600 underline" href="/bookmarklet">bookmarklet</Link> tracks
                from any store without an extension.
              </p>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a
                href="https://github.com/shajhanindher6-art/shahjahanaibuy"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="mr-2 h-4 w-4" /> Get it on GitHub
              </a>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/deals">Browse deals & coupons</Link>
            </Button>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
