/**
 * Inflation-Adjusted (Real-Price) Converter —
 * /tools/real-price-converter (Section 16, E6).
 *
 * Amount + category → what that amount is worth in today's
 * recorded prices, using the category inflation index
 * (services/category-inflation.ts, trailing 90-day window).
 *
 * Server component, no JavaScript needed: the conversion is a
 * plain GET form (?amount=…&category=…), so a result is a
 * shareable URL. The index is computed server-side from the same
 * queries as GET /api/v1/category-inflation (products + recorded
 * price_history rows).
 *
 * Honesty: a category is reported only with ≥2 products having a
 * valid change; anything else renders as an honest empty state
 * with the products/points behind it — never a converted number.
 * The index is recorded history only, never a forecast.
 */

import type { Metadata } from 'next';
import { TrendingUp } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  computeCategoryInflation,
  CATEGORY_INFLATION_WINDOW_DAYS,
} from '@/services/category-inflation';
import {
  convertRealPrice,
  describeRealPriceConversion,
  parseRealPriceParams,
} from '@/lib/real-price-converter';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Inflation-Adjusted (Real-Price) Converter — SmartBuy AI',
  description:
    'Enter an amount and a category to see what it is worth in today’s recorded prices, from the category inflation index (trailing 90 days, recorded prices only).',
  alternates: {
    canonical: `${appConfig.url}/tools/real-price-converter`,
  },
  openGraph: {
    title: 'Inflation-Adjusted (Real-Price) Converter — SmartBuy AI',
    description:
      'Enter an amount and a category to see what it is worth in today’s recorded prices, from the category inflation index (trailing 90 days, recorded prices only).',
    url: `${appConfig.url}/tools/real-price-converter`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Inflation-Adjusted (Real-Price) Converter — SmartBuy AI',
    description:
      'Enter an amount and a category to see what it is worth in today’s recorded prices, from the category inflation index (trailing 90 days, recorded prices only).',
  },
};

interface RealPriceConverterProps {
  searchParams: { amount?: string | string[]; category?: string | string[] };
}

export default async function RealPriceConverterPage({
  searchParams,
}: RealPriceConverterProps) {
  const params = parseRealPriceParams(searchParams);
  const supabase = await createSupabaseServerClient();

  const [productsRes, historyRes] = await Promise.all([
    supabase.from('products').select('id, category').is('deleted_at', null).limit(500),
    supabase
      .from('price_history')
      .select('product_id, price, recorded_at')
      .order('recorded_at', { ascending: true })
      .limit(5000),
  ]);

  const categoryByProduct = new Map<string, string | null>();
  for (const row of (productsRes.data ?? []) as Array<{ id: string; category: string | null }>) {
    categoryByProduct.set(row.id, row.category);
  }
  const index = computeCategoryInflation(
    ((historyRes.data ?? []) as Array<{ product_id: string; price: number; recorded_at: string }>).map(
      (r) => ({
        productId: r.product_id,
        category: categoryByProduct.get(r.product_id) ?? null,
        price: Number(r.price),
        recordedAt: r.recorded_at,
      })
    )
  );

  const selectedEntry =
    params.category !== null
      ? index.entries.find((e) => e.category === params.category) ?? null
      : null;
  const conversion =
    params.amount !== null && selectedEntry !== null
      ? convertRealPrice(params.amount, selectedEntry, index.windowDays)
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Inflation-Adjusted (Real-Price) Converter"
        description="Enter an amount and a category to see what it is worth in today’s recorded prices, from the category inflation index (trailing 90 days, recorded prices only)."
        path="/tools/real-price-converter"
        crumbs={[ { name: "Home", path: "/" }, { name: "AI tools", path: "/tools" }, { name: "Inflation-Adjusted (Real-Price) Converter" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <TrendingUp className="h-7 w-7 text-blue-600" /> Inflation-Adjusted (Real-Price)
            Converter
          </h1>
          <p className="mt-2 text-muted-foreground">
            What is an amount from {CATEGORY_INFLATION_WINDOW_DAYS} days
            ago worth in today&apos;s recorded prices? Enter an amount
            and a category — the conversion uses the category inflation
            index (average per-product price change over the trailing{' '}
            {index.windowDays} days, from recorded price history only).
            Categories without enough recorded prices cannot be
            converted, and the page says so.
          </p>

          <form
            method="get"
            action="/tools/real-price-converter"
            className="mt-8 rounded-lg border p-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="amount" className="text-sm font-medium">
                  Amount (USD, from {index.windowDays} days ago)
                </label>
                <input
                  id="amount"
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 100"
                  defaultValue={params.amount !== null ? String(params.amount) : ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="category" className="text-sm font-medium">
                  Category
                </label>
                <select
                  id="category"
                  name="category"
                  defaultValue={params.category ?? ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Choose a category…</option>
                  {index.entries.map((e) => (
                    <option key={e.category} value={e.category}>
                      {e.category}
                      {e.status === 'insufficient' ? ' — not enough data' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {params.errors.length > 0 && (
              <div className="mt-3" role="alert">
                {params.errors.map((e) => (
                  <p key={e} className="text-sm font-medium text-red-600">
                    {e}
                  </p>
                ))}
              </div>
            )}
            <Button type="submit" className="mt-4">
              Convert →
            </Button>
          </form>

          {conversion !== null && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">In today&apos;s recorded prices</h2>
              <p className="mt-3 text-3xl font-bold">
                ${conversion.adjustedUsd.toFixed(2)}
                <span className="text-base font-normal text-muted-foreground">
                  {' '}
                  (was ${conversion.amountUsd.toFixed(2)})
                </span>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {describeRealPriceConversion(conversion)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                From {conversion.productsUsed} products with a valid
                change and {conversion.pointsUsed} recorded points over
                the trailing {conversion.windowDays} days.
              </p>
            </section>
          )}

          {params.hasQuery &&
            params.amount !== null &&
            selectedEntry !== null &&
            conversion === null && (
              <div className="mt-6">
                <EmptyState
                  eyebrow="Not enough data"
                  title={`Cannot convert ${selectedEntry.category} yet`}
                  description={`This category has only ${selectedEntry.productsUsed} product(s) with a valid recorded change (${selectedEntry.pointsUsed} recorded points) — the index needs at least 2 products, so no conversion is shown rather than a guessed number.`}
                />
              </div>
            )}

          {params.hasQuery && params.category !== null && selectedEntry === null && (
            <div className="mt-6">
              <EmptyState
                eyebrow="Unknown category"
                title="That category has no recorded price history"
                description="Pick a category from the list — only categories with recorded price history can be converted."
              />
            </div>
          )}

          <section className="mt-10">
            <h2 className="text-xl font-semibold">
              Category inflation index (trailing {index.windowDays} days)
            </h2>
            {index.entries.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No category has enough recorded price history yet for an index.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {index.entries.map((e) => (
                  <li key={e.category} className="rounded-lg border p-4 text-sm">
                    <span className="font-semibold">{e.category}</span>{' '}
                    {e.status === 'ok' ? (
                      <span className="text-muted-foreground">
                        {e.avgChangePct !== null && e.avgChangePct > 0 ? '+' : ''}
                        {e.avgChangePct}% ({e.direction}) · {e.productsUsed} products,{' '}
                        {e.pointsUsed} points
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Not enough data — {e.productsUsed} product(s) with a valid change,{' '}
                        {e.pointsUsed} points
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              The full index is also on /price-index. Recorded prices
              only — this is history, not a forecast.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
