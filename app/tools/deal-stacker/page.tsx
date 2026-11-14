/**
 * AI Deal Stacker — /tools/deal-stacker (T8).
 *
 * For one product, compute the best stack: best currently-valid
 * coupon + best applicable cashback offer + recorded price drop —
 * each component shown separately with its source, plus the total.
 *
 * This is NOT a duplicate of /tools/coupons-cashback (which FINDS
 * coupons; it never combines them). The stacking math is new:
 * lib/deal-stacker.ts (buildDealStack). Coupons and cashback are
 * read the same way the finder reads them — services/commerce.ts
 * getCoupons / getCashbackOffers / getMerchants — plus
 * getToolMerchantProducts for the lowest in-stock recorded listing and
 * getToolPriceHistory for the recorded drop (Stage 1 cached fetch).
 *
 * HONESTY:
 * - The total is math on RECORDED prices only, labeled with the
 *   price's staleness. The stacked total is NEVER a guaranteed
 *   checkout total: taxes and shipping vary, and the final price
 *   is the retailer's.
 * - Never an expired coupon (validity-filtered by lib/deal-math.ts
 *   bestCoupon / isCouponCurrentlyValid) and never a coupon that
 *   isn't in the live coupons table. A coupon's checkout is still
 *   unverified — the retailer decides whether a code works.
 * - "No stack available" when nothing applies: no drop, no valid
 *   coupon, no applicable cashback — or no in-stock recorded
 *   listing at all. Nothing is invented to fill the stack.
 * - The drop is the recorded fall from the previous price point to
 *   the latest, so the base price is the pre-drop price — the drop
 *   is counted once, never twice.
 *
 * Server component, no JavaScript needed: the product picker is a
 * plain GET form (?product=…), so a stack view is a shareable URL.
 * Deterministic, zero LLM, no scraping, no invented prices.
 */

import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Layers } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { RelatedTools } from '@/components/tools/related-tools';
import { SaveCalculationButton } from '@/components/tools/save-calculation-button';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getCashbackOffers,
  getCoupons,
  getMerchants,
} from '@/services/commerce';
import {
  getCachedProducts,
  getToolMerchantProducts,
  getToolPriceHistory,
} from '@/services/tool-integration';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import {
  buildDealStack,
  formatUsd,
  type DealStack,
} from '@/lib/deal-stacker';
import { COUPON_CHECKOUT_UNVERIFIED_LABEL } from '@/lib/deal-math';
import { DEMO_DATA_NOTE } from '@/lib/coupons-cashback';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Deal Stacker — SmartBuy AI',
  description:
    'Stack the best valid coupon, cashback offer, and recorded price drop for one product — each part shown separately with its source. Recorded prices only, never a guaranteed checkout total.',
  alternates: {
    canonical: `${appConfig.url}/tools/deal-stacker`,
  },
  openGraph: {
    title: 'AI Deal Stacker — SmartBuy AI',
    description:
      'Stack the best valid coupon, cashback offer, and recorded price drop for one product — each part shown separately with its source. Recorded prices only, never a guaranteed checkout total.',
    url: `${appConfig.url}/tools/deal-stacker`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'AI Deal Stacker — SmartBuy AI',
    description:
      'Stack the best valid coupon, cashback offer, and recorded price drop for one product — each part shown separately with its source. Recorded prices only, never a guaranteed checkout total.',
  },
};

interface DealStackerPageProps {
  searchParams: { product?: string | string[] };
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function formatRecordedDate(iso: string | null): string {
  if (!iso) return 'unknown date';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const COMPONENT_KIND_LABELS: Record<string, string> = {
  'price-drop': 'Recorded price drop',
  coupon: 'Coupon',
  cashback: 'Cashback',
};

export default async function DealStackerPage({
  searchParams,
}: DealStackerPageProps) {
  const supabase = await createSupabaseServerClient();

  const [merchants, coupons, cashbackOffers, productResult] =
    await Promise.all([
      getMerchants(supabase),
      getCoupons(supabase, { active: true, limit: 100 }),
      getCashbackOffers(supabase, { active: true, limit: 100 }),
      getCachedProducts(supabase, { page: 1, pageSize: 100 }),
    ]);

  const merchantById = new Map(merchants.map((m) => [m.id, m]));
  const products = [...productResult.products].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // One stack per catalog product: lowest in-stock recorded listing
  // (merchant_products, price ascending) + recorded history for the
  // drop. Same per-product pattern as /tools/price-history.
  const stacks: DealStack[] = await Promise.all(
    products.map(async (product) => {
      const [listings, historyResult] = await Promise.all([
        getToolMerchantProducts(supabase, product.id),
        getToolPriceHistory(supabase, product.id, { limit: 500 }),
      ]);
      const lowestInStock = listings.find((l) => l.inStock) ?? null;
      const merchant = lowestInStock
        ? merchantById.get(lowestInStock.merchantId)
        : undefined;
      const history = historyResult.history ?? [];
      return buildDealStack({
        productId: product.id,
        productName: product.name,
        productSlug: product.slug,
        merchantId: lowestInStock ? lowestInStock.merchantId : null,
        merchantName: merchant ? merchant.name : null,
        lowestPrice: lowestInStock ? lowestInStock.price : null,
        priceRecordedAt:
          lowestInStock?.lastSyncedAt ??
          (history.length > 0 ? history[0].recordedAt : null),
        historyPoints: history.map((h) => ({
          price: Number(h.price),
          recordedAt: h.recordedAt,
        })),
        coupons,
        cashbackOffers,
      });
    })
  );

  const requestedSlug = firstParam(searchParams.product).trim();
  // An unknown slug selects NOTHING — it must not silently fall
  // back to the first product's stack as if it were the requested
  // one. With no ?product= at all the first stack is the default.
  const selected =
    requestedSlug !== ''
      ? (stacks.find((s) => s.productSlug === requestedSlug) ?? null)
      : (stacks[0] ?? null);
  const unknownSlug =
    requestedSlug !== '' && selected === null ? requestedSlug : null;
  const stacksWithStack = stacks.filter((s) => s.hasStack);

  return (
    <React.Fragment>
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <PageJsonLd
          name="AI Deal Stacker"
          description="Stack the best valid coupon, cashback offer, and recorded price drop for one product — each part shown separately with its source. Recorded prices only, never a guaranteed checkout total."
          path="/tools/deal-stacker"
          crumbs={[
            { name: 'Home', path: '/' },
            { name: 'AI tools', path: '/tools' },
            { name: 'AI Deal Stacker' },
          ]}
        />
        <main className="container mx-auto flex-1 px-4 py-12">
          <div className="mx-auto max-w-3xl">
            <h1 className="flex items-center gap-2 text-3xl font-bold">
              <Layers className="h-7 w-7 text-blue-600" /> AI Deal Stacker
            </h1>
            <p className="mt-2 text-muted-foreground">
              Pick a product and see its best stack: the best
              currently-valid coupon, the best applicable cashback
              offer, and the recorded price drop — each part shown
              separately with its source, plus the total. The total is
              math on recorded prices only.
            </p>
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {DEMO_DATA_NOTE}
            </p>

            {products.length === 0 ? (
              <div className="mt-6">
                <EmptyState
                  eyebrow="No products yet"
                  title="No products to stack for"
                  description="The catalog is empty right now, so there is no recorded price to stack anything onto."
                />
              </div>
            ) : (
              <>
                <form
                  method="get"
                  action="/tools/deal-stacker"
                  className="mt-8 rounded-lg border p-6"
                >
                  <label htmlFor="product" className="text-sm font-medium">
                    Product
                  </label>
                  <select
                    id="product"
                    name="product"
                    defaultValue={selected?.productSlug ?? ''}
                    className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    {products.map((product) => (
                      <option key={product.id} value={product.slug}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" className="mt-4">
                    Stack the deal →
                  </Button>
                </form>

                {unknownSlug !== null && (
                  <p className="mt-6 text-sm font-medium text-red-600" role="alert">
                    That product is not in the catalog — pick one from the list.
                  </p>
                )}

                <p
                  className="mt-6 text-sm text-muted-foreground"
                  aria-live="polite"
                >
                  {stacksWithStack.length} of {stacks.length} products have
                  a stack available right now.
                </p>

                {selected && (
                  <section
                    className="mt-6 rounded-lg border p-6"
                    aria-label={`Best stack for ${selected.productName}`}
                  >
                    <h2 className="text-xl font-semibold">
                      <Link
                        href={`/products/${selected.productSlug}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {selected.productName}
                      </Link>
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selected.merchantName
                        ? `Lowest in-stock recorded listing: ${selected.merchantName}`
                        : 'No in-stock recorded listing'}
                      {selected.currentPrice !== null && (
                        <>
                          {' · '}
                          {formatUsd(selected.currentPrice)} recorded{' '}
                          {formatRecordedDate(selected.priceRecordedAt)}
                          {selected.priceAgeDays !== null &&
                            ` (${selected.priceAgeDays} day${selected.priceAgeDays !== 1 ? 's' : ''} ago — ${selected.priceStale ? 'stale' : 'fresh'})`}
                        </>
                      )}
                    </p>

                    {!selected.hasStack ? (
                      <div className="mt-4">
                        <EmptyState
                          eyebrow="No stack available"
                          title="No stack available for this product"
                          description={
                            selected.noStackReason ??
                            'Nothing stacks for this product right now.'
                          }
                        />
                      </div>
                    ) : (
                      <>
                        <table className="mt-4 w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="py-2 pr-2 font-medium">
                                Component
                              </th>
                              <th className="py-2 pr-2 font-medium">Source</th>
                              <th className="py-2 text-right font-medium">
                                Saving
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {selected.components.map((component) => (
                              <tr
                                key={component.kind}
                                className="border-b align-top"
                              >
                                <td className="py-3 pr-2">
                                  <span className="font-semibold">
                                    {COMPONENT_KIND_LABELS[component.kind] ??
                                      component.label}
                                    {component.kind !== 'price-drop' &&
                                      ` — ${component.label}`}
                                  </span>
                                  <span className="mt-1 block text-xs text-muted-foreground">
                                    {component.detail}
                                  </span>
                                </td>
                                <td className="py-3 pr-2 text-muted-foreground">
                                  {component.source}
                                </td>
                                <td className="py-3 text-right font-semibold text-green-700">
                                  −{formatUsd(component.amount)}
                                </td>
                              </tr>
                            ))}
                            <tr className="font-semibold">
                              <td className="py-3 pr-2">Total saving</td>
                              <td className="py-3 pr-2 text-xs font-normal text-muted-foreground">
                                vs the{' '}
                                {formatUsd(selected.basePrice ?? 0)} price
                                before the drop
                              </td>
                              <td className="py-3 text-right text-green-700">
                                −{formatUsd(selected.totalSaving ?? 0)}
                              </td>
                            </tr>
                            <tr className="text-base font-bold">
                              <td className="py-3 pr-2">Stacked total</td>
                              <td className="py-3 pr-2 text-xs font-normal text-muted-foreground">
                                {formatUsd(selected.basePrice ?? 0)} −{' '}
                                {formatUsd(selected.totalSaving ?? 0)}
                              </td>
                              <td className="py-3 text-right">
                                {formatUsd(selected.stackedTotal ?? 0)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        <p className="mt-4 text-sm text-muted-foreground">
                          Not a guaranteed checkout total — taxes and
                          shipping vary, and the final price is the
                          retailer&apos;s. {COUPON_CHECKOUT_UNVERIFIED_LABEL}
                          .
                        </p>
                      </>
                    )}
                    <div className="mt-6">
                      <SaveCalculationButton
                        tool="deal-stacker"
                        label={`Deal stack — ${selected.productName}`.slice(0, 100)}
                        params={{ product: selected.productSlug }}
                      />
                    </div>
                  </section>
                )}

                <section className="mt-10" aria-label="Stacks across the catalog">
                  <h2 className="text-xl font-semibold">
                    Stacks across the catalog
                  </h2>
                  <ul className="mt-4 space-y-3">
                    {stacks.map((stack) => (
                      <li
                        key={stack.productId}
                        className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border p-4"
                      >
                        <Link
                          href={`/tools/deal-stacker?product=${stack.productSlug}`}
                          className="font-semibold underline-offset-4 hover:underline"
                        >
                          {stack.productName}
                        </Link>
                        {stack.hasStack ? (
                          <span className="text-sm">
                            <span className="font-semibold text-green-700">
                              Save {formatUsd(stack.totalSaving ?? 0)}
                            </span>{' '}
                            <span className="text-muted-foreground">
                              → {formatUsd(stack.stackedTotal ?? 0)} stacked
                              total
                              {stack.priceStale ? ' · price stale' : ''}
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            No stack available
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}

            <p className="mt-10 text-xs text-muted-foreground">
              A stack combines only what is recorded: the lowest
              in-stock recorded listing, the best currently-valid
              coupon for that store, the best applicable cashback
              offer, and the recorded price drop. Coupons are entered
              at the retailer&apos;s own checkout — SmartBuy never
              applies a discount itself. Find coupons without stacking
              in the{' '}
              <Link
                href="/tools/coupons-cashback"
                className="underline underline-offset-4"
              >
                Coupons &amp; Cashback Finder
              </Link>
              .
            </p>
            <RelatedTools tool="deal-stacker" productSlug={selected?.productSlug ?? null} />
          </div>
        </main>
        <SiteFooter />
      </div>
    </React.Fragment>
  );
}
