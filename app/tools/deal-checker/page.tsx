/**
 * Deal Checker — /tools/deal-checker (Section 14).
 *
 * The user enters a product and a price they found somewhere; the
 * page checks it against the RECORDED price history (currently 4
 * points per product over 30 days, Amazon only) and gives an honest
 * verdict: real deal, cheaper than current, not a deal, or cannot
 * verify.
 *
 * Server component, no JavaScript needed: the form submits as a
 * plain GET to this same page (?product=…&price=…), so the result
 * URL is shareable. Data: getProducts + getPriceHistory, judged by
 * lib/deal-checker.ts.
 *
 * Honesty: deterministic only — no Deal Score, no forecast, no
 * probability. The checker never sees the store the price came
 * from, so it cannot verify shipping, taxes, condition, or whether
 * the listing is genuine.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { ShareButtons } from '@/components/products/share-buttons';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { getPriceHistory } from '@/services/price-history';
import {
  DEAL_VERDICT_LABELS,
  checkDeal,
  parseDealCheckerParams,
} from '@/lib/deal-checker';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Deal Checker — SmartBuy AI',
  description:
    'Found a price somewhere? Check it against recorded prices — real deal, cheaper than current, not a deal, or cannot verify. Recorded prices only, no invented data.',
  alternates: {
    canonical: `${appConfig.url}/tools/deal-checker`,
  },
  openGraph: {
    title: 'Deal Checker — SmartBuy AI',
    description:
      'Found a price somewhere? Check it against recorded prices — real deal, cheaper than current, not a deal, or cannot verify. Recorded prices only, no invented data.',
    url: `${appConfig.url}/tools/deal-checker`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Deal Checker — SmartBuy AI',
    description:
      'Found a price somewhere? Check it against recorded prices — real deal, cheaper than current, not a deal, or cannot verify. Recorded prices only, no invented data.',
  },
};

interface DealCheckerProps {
  searchParams: {
    product?: string | string[];
    price?: string | string[];
  };
}

export default async function DealCheckerPage({
  searchParams,
}: DealCheckerProps) {
  const { productId, price, priceError } =
    parseDealCheckerParams(searchParams);
  const supabase = await createSupabaseServerClient();
  const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });
  const selected =
    productId !== null
      ? products.find((p) => p.id === productId) ?? null
      : null;

  let points: Array<{ price: number; recordedAt: string }> = [];
  if (selected) {
    const result = await getPriceHistory(supabase, selected.id, { limit: 500 });
    points = (result.history ?? []).map((h) => ({
      price: Number(h.price),
      recordedAt: h.recordedAt,
    }));
  }
  const check =
    selected && price !== null ? checkDeal(price, points) : null;
  const hasQuery = productId !== null || price !== null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <BadgeCheck className="h-7 w-7 text-blue-600" /> Deal Checker
          </h1>
          <p className="mt-2 text-muted-foreground">
            Found a price somewhere and wondering if it is really a
            deal? Enter the product and the price you found. The verdict
            comes only from recorded prices — currently 4 recorded
            points per product over 30 days (Amazon only). This check
            cannot verify the store, shipping, taxes, condition, or
            whether the listing is genuine.
          </p>

          {products.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No products yet"
                title="No products to check"
                description="The catalog is empty right now, so there is no recorded price history to check a deal against."
              />
            </div>
          )}

          {products.length > 0 && (
            <form
              method="get"
              action="/tools/deal-checker"
              className="mt-8 rounded-lg border p-6"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="product" className="text-sm font-medium">
                    Product
                  </label>
                  <select
                    id="product"
                    name="product"
                    defaultValue={selected?.id ?? ''}
                    className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Choose a product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="price" className="text-sm font-medium">
                    Price you found (USD)
                  </label>
                  <input
                    id="price"
                    name="price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="e.g. 849"
                    defaultValue={price !== null ? String(price) : ''}
                    className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {priceError && (
                <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                  {priceError}
                </p>
              )}
              {productId !== null && !selected && (
                <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                  That product was not found in the catalog.
                </p>
              )}
              <Button type="submit" className="mt-4">
                Check this deal →
              </Button>
            </form>
          )}

          {check !== null && selected && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">Verdict</h2>
              <p className="mt-3 text-lg font-semibold">
                {DEAL_VERDICT_LABELS[check.verdict]}
              </p>
              {check.verdict === 'cannot-verify' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {selected.name} has no recorded price history, so $
                  {check.foundPrice.toFixed(2)} cannot be compared
                  against anything recorded. That is not a good or a
                  bad price — it is unverified.
                </p>
              )}
              {check.verdict === 'real-deal' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  ${check.foundPrice.toFixed(2)} is below the lowest
                  recorded price (${check.lowest.toFixed(2)}) — a price
                  never seen in the recorded history. That is $
                  {check.savingVsLowest.toFixed(2)} below the recorded
                  low and ${check.savingVsCurrent.toFixed(2)} below the
                  current recorded price.
                </p>
              )}
              {check.verdict === 'below-current' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  ${check.foundPrice.toFixed(2)} is $
                  {check.savingVsCurrent.toFixed(2)} below the current
                  recorded price (${check.current.toFixed(2)}), but the
                  recorded low is ${check.lowest.toFixed(2)} — this
                  price has been beaten before in the recorded history.
                </p>
              )}
              {check.verdict === 'not-a-deal' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  ${check.foundPrice.toFixed(2)} is at or above the
                  current recorded price (${check.current.toFixed(2)})
                  — on recorded prices alone, this is not a deal.
                </p>
              )}
              {check.pointCount > 0 && (
                <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Current</dt>
                    <dd className="mt-1 font-semibold">
                      ${check.current.toFixed(2)}
                    </dd>
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Recorded low</dt>
                    <dd className="mt-1 font-semibold">
                      ${check.lowest.toFixed(2)}
                    </dd>
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Recorded high</dt>
                    <dd className="mt-1 font-semibold">
                      ${check.highest.toFixed(2)}
                    </dd>
                  </div>
                </dl>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Based on {check.pointCount} recorded point
                {check.pointCount === 1 ? '' : 's'} over 30 days
                (Amazon only). Before buying, check the store&apos;s
                shipping, taxes, and return policy — this tool does
                not see them.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Share this check:
                </span>
                <ShareButtons
                  title="Deal Checker — SmartBuy AI"
                  text={`$${check.foundPrice.toFixed(2)} for ${selected.name}: ${DEAL_VERDICT_LABELS[check.verdict]} — SmartBuy AI`}
                />
              </div>
              <p className="mt-4 text-sm">
                <Link
                  href={`/products/${selected.slug}`}
                  className="underline underline-offset-4"
                >
                  View {selected.name} →
                </Link>
              </p>
            </section>
          )}

          {!hasQuery && products.length > 0 && (
            <p className="mt-8 text-sm text-muted-foreground">
              Tip: paste the price from the deal you found — if it is
              below every recorded price, it is a real deal on the
              recorded evidence.
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
