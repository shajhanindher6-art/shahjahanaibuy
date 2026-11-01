import Link from 'next/link';
import { Puzzle, Tag, Search, ShieldCheck, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

/**
 * Browser extension guide page: /extension
 *
 * The extension (extension/ folder in the repo) runs on Amazon,
 * Walmart, Best Buy, eBay and AliExpress product + checkout pages:
 * a better-price banner on product pages, and a coupon panel with
 * Apply buttons on checkout pages. It is NOT on the Chrome Web
 * Store yet (publishing needs a developer account, a fee and a
 * review), so this page documents the honest install route:
 * load the folder as an unpacked extension in developer mode.
 * No login is required and no account data is collected — the
 * extension only sends a product title to SmartBuy's public
 * search API and reads public coupon codes.
 */
export default function ExtensionPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
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
                  <strong>Better-price banner:</strong> on a product page, it compares the
                  retailer&apos;s price with SmartBuy&apos;s catalog and shows a banner when
                  SmartBuy has it cheaper, with a link to the deal.
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
                  sent to SmartBuy&apos;s public search API for the price check, and coupon codes
                  are read from the public coupons API.
                </span>
              </p>
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
                  Open any supported product page — the banner appears when a better price exists.
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
