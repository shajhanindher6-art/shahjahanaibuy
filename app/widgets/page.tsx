/**
 * Embeddable price widgets — /widgets
 *
 * Docs + copy-paste codes for the price and price-history widgets
 * (S5#9). The examples use the real catalog slug macbook-air-13;
 * any real catalog slug works. Previews below render the live
 * embed (/widgets/embed) — if the data is unavailable they show
 * the embed's honest empty state, never a made-up price.
 *
 * Click reporting: outbound clicks from a widget are reported with
 * the same privacy rules as the site's affiliate beacon — product
 * slug + target URL only, never the embedding page's URL or any
 * visitor identifier. Wave 2: when the S4#18 public API lands, the
 * embed switches to it and these codes gain an API-key option.
 */

import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildWidgetEmbedCode } from '@/lib/widgets';

const EXAMPLE_SLUG = 'macbook-air-13';

export default function WidgetsDocsPage() {
  const priceCode = buildWidgetEmbedCode({ slug: EXAMPLE_SLUG, type: 'price', theme: 'light' });
  const historyCode = buildWidgetEmbedCode({ slug: EXAMPLE_SLUG, type: 'history', theme: 'light' });
  const darkCode = buildWidgetEmbedCode({ slug: EXAMPLE_SLUG, type: 'price', theme: 'dark' });

  const codeBlock = (code: string) => (
    <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
      <code>{code}</code>
    </pre>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Embeddable Price Widgets</h1>
            <p className="mt-2 text-muted-foreground">
              Put a live SmartBuy price — or price history — on your own blog or site with one
              copy-paste snippet. Widgets show recorded merchant prices for a real catalog
              product, and link back to the product page on SmartBuy AI.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Price widget (example: MacBook Air 13)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <iframe
                src={`/widgets/embed?slug=${EXAMPLE_SLUG}&type=price&theme=light`}
                width="320"
                height="180"
                style={{ border: 0, borderRadius: 12, overflow: 'hidden' }}
                loading="lazy"
                title="SmartBuy AI price widget preview — macbook-air-13"
              />
              {codeBlock(priceCode)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Price-history widget (same product)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                A sparkline of the product&apos;s recorded prices, with lowest / highest / current.
                With fewer than 2 recorded prices it honestly says &ldquo;Not enough price history
                yet&rdquo; instead of drawing a made-up line.
              </p>
              <iframe
                src={`/widgets/embed?slug=${EXAMPLE_SLUG}&type=history&theme=light`}
                width="320"
                height="260"
                style={{ border: 0, borderRadius: 12, overflow: 'hidden' }}
                loading="lazy"
                title="SmartBuy AI price-history widget preview — macbook-air-13"
              />
              {codeBlock(historyCode)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dark theme</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">{codeBlock(darkCode)}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">How it works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Replace the <code>slug</code> with any real catalog product slug (for example{' '}
                <code>galaxy-s24-ultra</code> or <code>sony-wh-1000xm5</code>). An unknown slug
                renders an honest &ldquo;unavailable&rdquo; state — never a guessed product.
              </p>
              <p>
                Widgets read the public API (Section 4, item 18):{' '}
                <code>/api/v1/public/products/&lt;slug&gt;</code> for the latest recorded price
                and <code>/api/v1/public/prices?slug=…</code> for recorded history. The public
                API returns recorded prices only, with no per-merchant offers — so the widget
                shows the latest recorded price with no retailer attribution.
              </p>
              <p>
                Click reporting: when a visitor clicks through from a widget, SmartBuy records the
                product and the destination link only — the same privacy rules as the site&apos;s
                affiliate click beacon. The page your widget sits on is never reported, and no
                visitor is identified.
              </p>
              <p>
                Prices shown are recorded merchant prices from SmartBuy&apos;s catalog. Seed prices
                are demo prices — the widget never presents them as live retailer prices.
              </p>
              <p>
                Questions? See the <Link href="/extension" className="text-blue-600 underline">browser extension</Link>{' '}
                or <Link href="/deals" className="text-blue-600 underline">deals page</Link>.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
