/**
 * AI Negotiation Coach — /tools/negotiation-coach (T6).
 *
 * Pick a product + a target price → gap math vs the real recorded
 * low + a polite, copyable message draft the user sends the seller
 * themselves + a shortcut to the existing price alert.
 *
 * Server component, no JavaScript needed for the analysis: the form
 * submits as a plain GET to this same page
 * (?product=…&target=…&reason=…), so the result URL is shareable.
 * The engine is services/negotiation.ts (analyzeNegotiationGap,
 * buildNegotiationDraft — gap analysis + message draft ONLY, the
 * same engine the product-page widget
 * components/products/price-negotiator.tsx uses). The cheapest
 * current price comes from getLowestMerchantPrices
 * (services/products.ts) and the recorded low from getToolPriceHistory
 * (services/tool-integration.ts) — recorded data only, never a live
 * fetch, never an invented price.
 *
 * HONESTY: SmartBuy cannot negotiate with retailers and has no
 * retailer partnership. There is no negotiated outcome, no unlisted
 * coupon, no hidden price. A target below every recorded price is
 * flagged as such, not dressed up as achievable. Nothing here is
 * ever sent to a retailer by SmartBuy — the draft is the user's to
 * send, and the alert only watches the recorded price.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { Handshake } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { RelatedTools } from '@/components/tools/related-tools';
import { SaveCalculationButton } from '@/components/tools/save-calculation-button';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getLowestMerchantPrices } from '@/services/products';
import {
  getCachedProducts,
  getToolPriceHistory,
} from '@/services/tool-integration';
import { analyzeNegotiationGap, buildNegotiationDraft } from '@/services/negotiation';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { CopyTextButton } from '@/components/tools/copy-text-button';
import { PriceAlertDialog } from '@/components/products/price-alert-dialog';
import { parseNegotiationCoachParams } from '@/lib/negotiation-coach';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Negotiation Coach — SmartBuy AI',
  description:
    'Pick a product and a target price: see the gap vs the real recorded low, get a polite message draft to send the seller yourself, and set a price alert. SmartBuy cannot negotiate with retailers.',
  alternates: {
    canonical: `${appConfig.url}/tools/negotiation-coach`,
  },
  openGraph: {
    title: 'Negotiation Coach — SmartBuy AI',
    description:
      'Pick a product and a target price: see the gap vs the real recorded low, get a polite message draft to send the seller yourself, and set a price alert. SmartBuy cannot negotiate with retailers.',
    url: `${appConfig.url}/tools/negotiation-coach`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Negotiation Coach — SmartBuy AI',
    description:
      'Pick a product and a target price: see the gap vs the real recorded low, get a polite message draft to send the seller yourself, and set a price alert. SmartBuy cannot negotiate with retailers.',
  },
};

interface NegotiationCoachProps {
  searchParams: {
    product?: string | string[];
    target?: string | string[];
    reason?: string | string[];
  };
}

export default async function NegotiationCoachPage({ searchParams }: NegotiationCoachProps) {
  const params = parseNegotiationCoachParams(searchParams);
  const supabase = await createSupabaseServerClient();
  const { products } = await getCachedProducts(supabase, { page: 1, pageSize: 100 });

  const selectedProduct = params.productSlug
    ? (products.find((p) => p.slug === params.productSlug) ?? null)
    : null;
  const hasQuery = selectedProduct !== null && params.targetUsd !== null;

  // Gap math vs recorded data only. The cheapest price is the
  // lowest in-stock merchant listing; the low/average come from
  // the product's recorded price_history points.
  let cheapestUsd: number | null = null;
  let pointsUsed = 0;
  let lowestRecordedUsd: number | null = null;
  let gap: ReturnType<typeof analyzeNegotiationGap> = null;
  let draft: string | null = null;
  if (hasQuery && selectedProduct && params.targetUsd !== null) {
    const lowest = await getLowestMerchantPrices(supabase, [selectedProduct.id]);
    cheapestUsd = lowest.get(selectedProduct.id)?.price ?? null;
    const history = await getToolPriceHistory(supabase, selectedProduct.id, { limit: 500 });
    const points = (history.history ?? []).map((h) => ({
      price: Number(h.price),
      recordedAt: h.recordedAt,
    }));
    pointsUsed = points.filter((p) => Number.isFinite(p.price) && p.price > 0).length;
    lowestRecordedUsd = history.lowestPrice ?? null;
    gap = analyzeNegotiationGap(cheapestUsd, points, params.targetUsd);
    draft = gap
      ? buildNegotiationDraft({
          productName: selectedProduct.name,
          gap,
          reason: params.reason ?? undefined,
        })
      : null;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: WebPage + BreadcrumbList
          (Home → AI tools → this tool). */}
      <PageJsonLd
        name="Negotiation Coach"
        description="Pick a product and a target price: see the gap vs the real recorded low, get a polite message draft to send the seller yourself, and set a price alert. SmartBuy cannot negotiate with retailers."
        path="/tools/negotiation-coach"
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'AI tools', path: '/tools' },
          { name: 'Negotiation Coach' },
        ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Handshake className="h-7 w-7 text-blue-600" /> Negotiation Coach
          </h1>
          <p className="mt-2 text-muted-foreground">
            Pick a product and the price you&apos;d pay. We&apos;ll show
            how it compares to the real recorded prices and draft a
            polite message you can send to the seller yourself — or
            set a price alert at that target and wait for the price
            to come to you.
          </p>
          <p className="mt-2 text-sm font-medium">
            SmartBuy cannot negotiate with retailers and has no
            retailer partnership. There is no negotiated outcome, no
            unlisted coupon, no hidden price.
          </p>

          <form
            method="get"
            action="/tools/negotiation-coach"
            className="mt-8 rounded-lg border p-6"
          >
            <div>
              <label htmlFor="product" className="text-sm font-medium">
                Product
              </label>
              <select
                id="product"
                name="product"
                defaultValue={params.productSlug ?? ''}
                className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Choose a product…</option>
                {products.map((product) => (
                  <option key={product.id} value={product.slug}>
                    {product.name}
                    {product.brand ? ` (${product.brand})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="target" className="text-sm font-medium">
                  Your target price (USD)
                </label>
                <input
                  id="target"
                  name="target"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 899"
                  defaultValue={params.targetUsd !== null ? String(params.targetUsd) : ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="reason" className="text-sm font-medium">
                  Reason (optional, your own words)
                </label>
                <input
                  id="reason"
                  name="reason"
                  type="text"
                  placeholder="e.g. buying for a student budget"
                  defaultValue={params.reason ?? ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            {params.error && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {params.error}
              </p>
            )}
            {params.productSlug !== null && selectedProduct === null && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                That product is not in the catalog — pick one from the list.
              </p>
            )}
            <Button type="submit" className="mt-4">
              Coach me →
            </Button>
          </form>

          {products.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No products yet"
                title="No products to coach on"
                description="The catalog is empty right now, so there is no product to pick a target price for."
              />
            </div>
          )}

          {hasQuery && gap && selectedProduct && (
            <section className="mt-6 rounded-lg border p-6" aria-live="polite">
              <h2 className="text-lg font-semibold">
                {selectedProduct.name} — target ${gap.targetUsd.toFixed(2)}
              </h2>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Cheapest today</dt>
                  <dd className="mt-1 font-semibold">
                    {gap.currentCheapestUsd !== null
                      ? `$${gap.currentCheapestUsd.toFixed(2)}`
                      : 'Unknown'}
                  </dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Lowest recorded</dt>
                  <dd className="mt-1 font-semibold">
                    {gap.lowestRecordedUsd !== null
                      ? `$${gap.lowestRecordedUsd.toFixed(2)}`
                      : 'No history'}
                  </dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Average recorded</dt>
                  <dd className="mt-1 font-semibold">
                    {gap.averageRecordedUsd !== null
                      ? `$${gap.averageRecordedUsd.toFixed(2)}`
                      : 'No history'}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-sm text-muted-foreground">
                Based on {pointsUsed} recorded price{' '}
                {pointsUsed === 1 ? 'point' : 'points'}
                {selectedProduct.dataFreshness
                  ? ` · prices last checked ${new Date(selectedProduct.dataFreshness).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : ''}
                . Recorded prices only — nothing here is a live price.
              </p>
              {pointsUsed === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  No recorded price history for this product yet, so
                  the comparison uses today&apos;s cheapest recorded
                  listing only.
                </p>
              )}
              {gap.alreadyMet ? (
                <p className="mt-3 text-sm font-medium text-green-700">
                  Your target is already met — the cheapest recorded
                  listing is at or below it. No negotiation needed;
                  set an alert if you want to be told when it drops
                  further.
                </p>
              ) : gap.gapVsCurrentUsd !== null ? (
                <p className="mt-3 text-sm">
                  Gap to today&apos;s cheapest price:{' '}
                  <span className="font-medium">
                    ${Math.abs(gap.gapVsCurrentUsd).toFixed(2)}
                    {gap.gapVsCurrentPct !== null
                      ? ` (${Math.abs(gap.gapVsCurrentPct)}% below)`
                      : ''}
                  </span>
                </p>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No cheapest recorded price is available, so no gap
                  can be computed — the draft below still asks the
                  seller about your target.
                </p>
              )}
              {gap.belowEveryRecordedPrice && (
                <p className="mt-2 text-sm font-medium text-amber-700">
                  Note: this target is below every price ever recorded
                  for this product
                  {lowestRecordedUsd !== null
                    ? ` (lowest recorded $${lowestRecordedUsd.toFixed(2)})`
                    : ''}
                  , so a seller is unlikely to accept it at retail —
                  consider a target within the recorded range. This is
                  a flag, not a promise: no outcome is guaranteed.
                </p>
              )}

              {draft && (
                <div className="mt-6 space-y-2">
                  <h3 className="text-sm font-semibold">
                    Message draft — copy and send it to the seller yourself
                  </h3>
                  <p className="rounded-lg border bg-muted/50 p-3 text-sm leading-relaxed">
                    {draft}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <CopyTextButton text={draft} label="Copy message" />
                    <PriceAlertDialog
                      productId={selectedProduct.id}
                      productName={selectedProduct.name}
                      currentPrice={cheapestUsd}
                      initialTargetPrice={gap.targetUsd}
                      triggerLabel={`Set alert at $${gap.targetUsd.toFixed(2)}`}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    No code is generated here and no outcome is
                    promised — the alert watches the recorded price,
                    and the message is yours to send. SmartBuy sends
                    nothing to the seller.
                  </p>
                </div>
              )}
              <p className="mt-4 text-sm">
                <Link
                  href={`/products/${selectedProduct.slug}`}
                  className="underline underline-offset-4"
                >
                  View {selectedProduct.name} →
                </Link>
              </p>
              <div className="mt-6">
                <SaveCalculationButton
                  tool="negotiation-coach"
                  label={`Negotiation target $${gap.targetUsd.toFixed(2)} — ${selectedProduct.name}`.slice(0, 100)}
                  params={{
                    product: selectedProduct.slug,
                    target: gap.targetUsd,
                    ...(params.reason ? { reason: params.reason } : {}),
                  }}
                />
              </div>
            </section>
          )}

          {!hasQuery && params.error === null && (
            <p className="mt-8 text-sm text-muted-foreground">
              Tip: try{' '}
              <Link
                href="/tools/negotiation-coach?product=macbook-air-13&target=899"
                className="underline underline-offset-4"
              >
                MacBook Air 13 at $899
              </Link>{' '}
              or{' '}
              <Link
                href="/tools/negotiation-coach?product=sony-wh-1000xm5&target=249"
                className="underline underline-offset-4"
              >
                Sony WH-1000XM5 at $249
              </Link>
              .
            </p>
          )}
          <RelatedTools tool="negotiation-coach" productSlug={selectedProduct?.slug ?? null} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
