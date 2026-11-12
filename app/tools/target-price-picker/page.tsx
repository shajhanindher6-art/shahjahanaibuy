/**
 * Smart Target-Price Picker — /tools/target-price-picker
 * (Section 16, E8).
 *
 * The reverse of the Price Alert Simulator (which checks a
 * user-supplied target): this page SUGGESTS targets from recorded
 * price history — the recorded low, a low recorded point, and the
 * last recorded price — each with how often it was seen.
 *
 * Server component, no JavaScript needed: the product picker is a
 * plain GET form (?product=<slug>), so a suggestion is a shareable
 * URL. Data: getProducts + getPriceHistory, composed by
 * lib/target-price-picker.ts over the 40 recorded price_history
 * rows.
 *
 * Honesty: 4 recorded points per product make any percentile
 * crude, so every suggestion is labelled "from N recorded points"
 * and the page shows the actual points. "Seen" counts are counts
 * of recorded points at or below the target — never a probability,
 * never a forecast. A product with no history gets an honest
 * empty state, not a suggested target.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { Crosshair } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { getPriceHistory } from '@/services/price-history';
import {
  parseTargetPickerParams,
  suggestTargetPrices,
} from '@/lib/target-price-picker';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Smart Target-Price Picker — SmartBuy AI',
  description:
    'Pick a product and get target prices suggested from its recorded price history — recorded low, low recorded point, last price — each with how often it was seen. Recorded prices only.',
  alternates: {
    canonical: `${appConfig.url}/tools/target-price-picker`,
  },
  openGraph: {
    title: 'Smart Target-Price Picker — SmartBuy AI',
    description:
      'Pick a product and get target prices suggested from its recorded price history — recorded low, low recorded point, last price — each with how often it was seen. Recorded prices only.',
    url: `${appConfig.url}/tools/target-price-picker`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Smart Target-Price Picker — SmartBuy AI',
    description:
      'Pick a product and get target prices suggested from its recorded price history — recorded low, low recorded point, last price — each with how often it was seen. Recorded prices only.',
  },
};

interface TargetPricePickerProps {
  searchParams: { product?: string | string[] };
}

export default async function TargetPricePickerPage({
  searchParams,
}: TargetPricePickerProps) {
  const { productSlug } = parseTargetPickerParams(searchParams);
  const supabase = await createSupabaseServerClient();
  const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });
  const selected = productSlug !== null ? products.find((p) => p.slug === productSlug) ?? null : null;

  const suggestions =
    selected !== null
      ? suggestTargetPrices(
          selected.id,
          (await getPriceHistory(supabase, selected.id, { limit: 500 })).history.map((h) => ({
            price: Number(h.price),
            recordedAt: h.recordedAt,
          }))
        )
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Smart Target-Price Picker"
        description="Pick a product and get target prices suggested from its recorded price history — recorded low, low recorded point, last price — each with how often it was seen. Recorded prices only."
        path="/tools/target-price-picker"
        crumbs={[ { name: "Home", path: "/" }, { name: "AI tools", path: "/tools" }, { name: "Smart Target-Price Picker" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Crosshair className="h-7 w-7 text-blue-600" /> Smart Target-Price Picker
          </h1>
          <p className="mt-2 text-muted-foreground">
            Not sure what target price to set for an alert? Pick a
            product and this page suggests targets from its recorded
            price history — the lowest price ever recorded, a low
            recorded point, and the last recorded price — each with
            how many recorded points were at or below it. Suggestions
            come only from recorded points (currently 4 per product,
            Amazon only); nothing here is a prediction.
          </p>

          <form
            method="get"
            action="/tools/target-price-picker"
            className="mt-8 rounded-lg border p-6"
          >
            <label htmlFor="product" className="text-sm font-medium">
              Product
            </label>
            <select
              id="product"
              name="product"
              defaultValue={productSlug ?? ''}
              className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Choose a product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button type="submit" className="mt-4">
              Suggest targets →
            </Button>
          </form>

          {selected !== null && suggestions === null && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No recorded price history"
                title={`No targets to suggest for ${selected.name}`}
                description="This product has no recorded price history yet, so no target can be suggested — a target invented from nothing would be a guess."
              />
            </div>
          )}

          {selected !== null && suggestions !== null && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">
                <Link
                  href={`/products/${selected.slug}`}
                  className="underline-offset-4 hover:underline"
                >
                  {selected.name}
                </Link>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Suggested from {suggestions.pointCount} recorded point
                {suggestions.pointCount === 1 ? '' : 's'}.
              </p>
              <div className="mt-4 space-y-4">
                {suggestions.suggestions.map((s) => (
                  <article key={s.label} className="rounded-lg border p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold">{s.label}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{s.note}</p>
                      </div>
                      <p className="text-xl font-bold">${s.targetUsd.toFixed(2)}</p>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      Seen in {s.pointsAtOrBelow} of {s.pointCount} recorded point
                      {s.pointCount === 1 ? '' : 's'} at or below this price.
                    </p>
                    <Link
                      href={`/tools/price-alert-simulator?product=${selected.id}&target=${s.targetUsd.toFixed(2)}`}
                      className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                    >
                      Check this target in the simulator →
                    </Link>
                  </article>
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Recorded points:{' '}
                {suggestions.points
                  .map(
                    (p) =>
                      `$${p.price.toFixed(2)} on ${new Date(p.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                  )
                  .join(' · ')}
              </p>
            </section>
          )}

          {selected === null && productSlug !== null && (
            <div className="mt-6">
              <EmptyState
                eyebrow="Unknown product"
                title="That product is not in the catalog"
                description="Pick a product from the list — only catalog products have recorded price history to suggest from."
              />
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
