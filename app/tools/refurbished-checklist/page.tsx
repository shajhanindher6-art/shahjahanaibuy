/**
 * AI Refurbished Buying Checklist — /tools/refurbished-checklist (T9).
 *
 * A safety checklist for buying certified refurbished: a
 * condition-grade decoder (A/B/C), a 10-point inspection list,
 * and a benchmark price vs the same product new (recorded price).
 *
 * Honesty: no refurbished listings exist in the catalog — this
 * tool NEVER shows a refurbished offer, price, or condition grade
 * for any specific listing. It links out to retailer search pages
 * (like /find) where refurbished offers appear when the retailer
 * has them. The benchmark uses recorded new prices only, labeled
 * STALE where applicable.
 *
 * This tool does NOT duplicate /tools/trade-in-finder: no
 * trade-in directory, no resale projection. Different job —
 * buying refurbished safely vs finding trade-in programs.
 *
 * Server component, no JavaScript needed: the product picker is
 * a plain GET form.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ClipboardCheck } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { getMerchantProducts } from '@/services/commerce';
import { policyForStore } from '@/services/return-policies';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { GLOBAL_STORES, buildStoreSearchUrl } from '@/lib/stores';
import {
  CONDITION_GRADES,
  INSPECTION_CHECKLIST,
  REFURBISHED_OUTBOUND_NOTE,
  buildRefurbishedBenchmark,
  refurbishedSearchQuery,
} from '@/lib/refurbished-checklist';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Refurbished Buying Checklist — SmartBuy AI',
  description:
    'Buy certified refurbished safely: a condition-grade decoder, a 10-point inspection list, and a benchmark against the recorded new price. No refurbished offer is ever shown — only the checks.',
  alternates: {
    canonical: `${appConfig.url}/tools/refurbished-checklist`,
  },
  openGraph: {
    title: 'AI Refurbished Buying Checklist — SmartBuy AI',
    description:
      'Buy certified refurbished safely: a condition-grade decoder, a 10-point inspection list, and a benchmark against the recorded new price. No refurbished offer is ever shown — only the checks.',
    url: `${appConfig.url}/tools/refurbished-checklist`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'AI Refurbished Buying Checklist — SmartBuy AI',
    description:
      'Buy certified refurbished safely: a condition-grade decoder, a 10-point inspection list, and a benchmark against the recorded new price. No refurbished offer is ever shown — only the checks.',
  },
};

/** Return windows shown beside the checklist (general summaries). */
const RETURN_WINDOW_STORES = ['Amazon', 'Best Buy', 'eBay'];

interface RefurbishedChecklistPageProps {
  searchParams: { product?: string | string[] };
}

export default async function RefurbishedChecklistPage({
  searchParams,
}: RefurbishedChecklistPageProps) {
  const rawSlug = searchParams.product;
  const selectedSlug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  const supabase = await createSupabaseServerClient();
  const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });

  const selected =
    products.find((p) => p.slug === selectedSlug) ?? null;

  // Benchmark: lowest recorded in-stock merchant price (new) for
  // the selected product only. No refurbished price is ever read
  // — none is recorded anywhere.
  let benchmark = null;
  if (selected) {
    const listings = await getMerchantProducts(supabase, selected.id);
    const inStock = listings.filter((l) => l.inStock);
    const lowest = inStock.length > 0 ? Number(inStock[0].price) : null;
    benchmark = buildRefurbishedBenchmark({
      name: selected.name,
      slug: selected.slug,
      recordedPrice: lowest,
      priceState: selected.priceState ?? null,
      lastCheckedAt: selected.dataFreshness ?? null,
    });
  }

  const searchQuery = selected
    ? refurbishedSearchQuery(selected.name)
    : 'refurbished';

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <PageJsonLd
        name="AI Refurbished Buying Checklist"
        description="Buy certified refurbished safely: a condition-grade decoder, a 10-point inspection list, and a benchmark against the recorded new price. No refurbished offer is ever shown — only the checks."
        path="/tools/refurbished-checklist"
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'AI tools', path: '/tools' },
          { name: 'AI Refurbished Buying Checklist' },
        ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <ClipboardCheck className="h-7 w-7 text-blue-600" /> AI Refurbished Buying Checklist
          </h1>
          <p className="mt-2 text-muted-foreground">
            Buying certified refurbished can save real money — if the
            grade, the warranty and the return window check out. Use
            this list before you pay, and test everything inside the
            return window after it arrives.
          </p>
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            No refurbished listings exist in the SmartBuy catalog, so
            this tool never shows a refurbished offer, a refurbished
            price, or a condition grade for any specific listing. The
            benchmark below is the recorded price of the same product
            new — a ceiling to compare against, not a refurbished
            price.
          </p>

          <section aria-labelledby="grade-decoder" className="mt-10">
            <h2 id="grade-decoder" className="text-xl font-semibold">
              Condition-grade decoder
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Grades are not standardized — every seller defines its
              own A, B and C. This is what a grade usually means;
              always read the seller&apos;s own definition on the
              listing.
            </p>
            <div className="mt-4 space-y-4">
              {CONDITION_GRADES.map((grade) => (
                <article key={grade.grade} className="rounded-lg border p-6">
                  <h3 className="text-lg font-semibold">
                    Grade {grade.grade} — {grade.label}
                  </h3>
                  <p className="mt-2 text-sm">{grade.meaning}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Watch out for:{' '}
                    </span>
                    {grade.watchOutFor}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="inspection-list" className="mt-10">
            <h2 id="inspection-list" className="text-xl font-semibold">
              10-point inspection list
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Check every item before you buy — and re-check items 5,
              7 and 8 the day the device arrives.
            </p>
            <ol className="mt-4 space-y-3">
              {INSPECTION_CHECKLIST.map((item, index) => (
                <li key={item.id} className="rounded-lg border p-4">
                  <p className="font-medium">
                    {index + 1}. {item.title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.detail}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="benchmark" className="mt-10">
            <h2 id="benchmark" className="text-xl font-semibold">
              Benchmark: the same product new
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The recorded new price is your ceiling. A refurbished
              unit should cost meaningfully less than this — and the
              smaller the saving, the less the wear and the shorter
              warranty are worth.
            </p>

            <form
              method="get"
              action="/tools/refurbished-checklist"
              className="mt-4 rounded-lg border p-6"
            >
              <label htmlFor="product" className="text-sm font-medium">
                Pick a product to benchmark
              </label>
              <select
                id="product"
                name="product"
                defaultValue={selected?.slug ?? ''}
                className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">No product selected</option>
                {products.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button type="submit" className="mt-4">
                Show benchmark →
              </Button>
            </form>

            {products.length === 0 && (
              <div className="mt-6">
                <EmptyState
                  eyebrow="No products yet"
                  title="No products to benchmark"
                  description="The catalog is empty right now, so there is no recorded new price to compare a refurbished unit against."
                />
              </div>
            )}

            {products.length > 0 && !benchmark && (
              <div className="mt-6">
                <EmptyState
                  eyebrow="No benchmark yet"
                  title="Pick a product to see its recorded new price"
                  description="The benchmark is the lowest recorded in-stock price for the same product new — it is the ceiling a refurbished price should sit well below."
                />
              </div>
            )}

            {benchmark && (
              <article className="mt-6 rounded-lg border p-6">
                <h3 className="text-lg font-semibold">
                  <Link
                    href={`/products/${benchmark.slug}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {benchmark.name}
                  </Link>
                </h3>
                {benchmark.hasRecordedPrice ? (
                  <>
                    <p className="mt-2 text-2xl font-bold">
                      ${benchmark.recordedPrice!.toFixed(2)}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        lowest recorded new price
                      </span>
                    </p>
                    {benchmark.priceStateLabel && (
                      <p className="mt-2 text-sm">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                          {benchmark.priceStateLabel}
                        </span>
                      </p>
                    )}
                    {benchmark.priceStateReason && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {benchmark.priceStateReason}
                      </p>
                    )}
                    {benchmark.lastCheckedLabel && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Last checked {benchmark.lastCheckedLabel} — a
                        stale benchmark is a rough ceiling, not a
                        current price.
                      </p>
                    )}
                    <p className="mt-3 text-sm text-muted-foreground">
                      A refurbished unit of this product should cost
                      meaningfully less than $
                      {benchmark.recordedPrice!.toFixed(2)}. SmartBuy
                      records no refurbished price, so no refurbished
                      comparison can be shown here.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No recorded new price for this product — there is
                    no in-stock merchant listing to benchmark against.
                    Do not guess a benchmark; check the retailer&apos;s
                    own new price on the day.
                  </p>
                )}
              </article>
            )}
          </section>

          <section aria-labelledby="return-windows" className="mt-10">
            <h2 id="return-windows" className="text-xl font-semibold">
              Return windows at major stores
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              General policy summaries — always verify at the
              retailer&apos;s site before purchase. Refurbished items
              can carry a shorter window than new ones.
            </p>
            <ul className="mt-4 space-y-3">
              {RETURN_WINDOW_STORES.map((store) => {
                const policy = policyForStore(store);
                return (
                  <li key={store} className="rounded-lg border p-4 text-sm">
                    <span className="font-medium">{store}: </span>
                    {policy?.returnWindow ?? (
                      <span className="text-muted-foreground">
                        Varies by seller — check the listing.
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="where-to-look" className="mt-10">
            <h2 id="where-to-look" className="text-xl font-semibold">
              Where to look for refurbished offers
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {REFURBISHED_OUTBOUND_NOTE}
            </p>
            <ul className="mt-4 space-y-3">
              {GLOBAL_STORES.map((store) => (
                <li key={store.slug} className="rounded-lg border p-4 text-sm">
                  <a
                    href={buildStoreSearchUrl(store, searchQuery)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    Search refurbished on {store.name} →
                  </a>
                  <span className="text-muted-foreground">
                    {' '}
                    — {store.name}&apos;s own search results
                    {selected ? ` for “${searchQuery}”` : ' for refurbished items'}.
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm">
              <Link href="/find" className="underline-offset-4 hover:underline">
                Search all stores on /find →
              </Link>{' '}
              ·{' '}
              <Link
                href="/tools/trade-in-finder"
                className="underline-offset-4 hover:underline"
              >
                Trade-in finder →
              </Link>
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
