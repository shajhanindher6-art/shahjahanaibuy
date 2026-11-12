/**
 * Coupons & Cashback Finder — /tools/coupons-cashback (Section 15, C1).
 *
 * The first public finder page for coupons and cashback: until now
 * they existed only as APIs (/api/v1/coupons, /api/v1/cashback)
 * plus the per-product section on product pages. This page reuses
 * those same services (services/commerce.ts: getCoupons,
 * getCashbackOffers, getMerchants) — no second coupons backend.
 *
 * Server component, no JavaScript needed: search/filter is a plain
 * GET form (?q=…&store=…&kind=…&category=…), so a filtered view is
 * a shareable URL. Store = merchant, category = the category of
 * the product a cashback offer is linked to (coupons are store-wide
 * codes with no category, so a category filter never hides one).
 *
 * Honesty: the rows in the database today are demo/seed data, so
 * the page says so plainly (DEMO_DATA_NOTE) and never presents
 * them as live merchant offers. Expired cashback offers are
 * excluded by lib/coupons-cashback.ts; getCoupons already excludes
 * expired / not-yet-started / usage-exhausted codes.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Tag, DollarSign } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Button } from '@/components/ui/button';
import { appConfig } from '@/lib/config/app';
import { tFor } from '@/lib/i18n';
import { isSupportedLanguage, type Language } from '@/lib/region';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getCashbackOffers,
  getCoupons,
  getMerchants,
} from '@/services/commerce';
import { getProducts } from '@/services/products';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import {
  DEMO_DATA_NOTE,
  FINDER_KIND_LABELS,
  FINDER_KINDS,
  filterCashbackOffers,
  filterCoupons,
  formatCashbackValue,
  formatCouponValue,
  formatExpiry,
  parseFinderParams,
  type FinderKind,
} from '@/lib/coupons-cashback';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Coupons & Cashback Finder — SmartBuy AI',
  description:
    'Find coupon codes and cashback offers by store and category. Demo / seed data — sample offers from the demo catalog, not live merchant offers.',
  alternates: {
    canonical: `${appConfig.url}/tools/coupons-cashback`,
  },
  openGraph: {
    title: 'Coupons & Cashback Finder — SmartBuy AI',
    description:
      'Find coupon codes and cashback offers by store and category. Demo / seed data — sample offers from the demo catalog, not live merchant offers.',
    url: `${appConfig.url}/tools/coupons-cashback`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Coupons & Cashback Finder — SmartBuy AI',
    description:
      'Find coupon codes and cashback offers by store and category. Demo / seed data — sample offers from the demo catalog, not live merchant offers.',
  },
};

interface CouponsCashbackPageProps {
  searchParams: {
    q?: string | string[];
    store?: string | string[];
    kind?: string | string[];
    category?: string | string[];
  };
}

/**
 * Section 16, #44: the last tool page with zero i18n — its h1 now
 * renders through tFor like the other 25 tools (toolHeading
 * key added in lib/i18n.ts). Same sb-language cookie pattern as
 * the other server tools (see emi-calculator).
 */
function toolLanguage(): Language {
  const saved = cookies().get('sb-language')?.value ?? null;
  return saved && isSupportedLanguage(saved) ? saved : 'en';
}

export default async function CouponsCashbackPage({
  searchParams,
}: CouponsCashbackPageProps) {
  const language = toolLanguage();
  const params = parseFinderParams(searchParams);
  const supabase = await createSupabaseServerClient();

  const [merchants, coupons, cashback, productResult] = await Promise.all([
    getMerchants(supabase),
    getCoupons(supabase, { active: true, limit: 100 }),
    getCashbackOffers(supabase, { active: true, limit: 100 }),
    getProducts(supabase, { page: 1, pageSize: 100 }),
  ]);

  const merchantById = new Map(merchants.map((m) => [m.id, m]));
  const merchantBySlug = new Map(merchants.map((m) => [m.slug, m]));
  const selectedMerchant = params.store
    ? merchantBySlug.get(params.store)
    : undefined;
  const merchantId = selectedMerchant ? selectedMerchant.id : '';

  const productCategoryById = new Map(
    productResult.products
      .filter((p) => p.category !== null)
      .map((p) => [p.id, p.category as string])
  );
  const categories = Array.from(
    new Set(
      productResult.products
        .map((p) => p.category)
        .filter((c): c is string => c !== null)
    )
  ).sort();

  const shownCoupons =
    params.kind === 'cashback'
      ? []
      : filterCoupons(coupons, { q: params.q, merchantId });
  const shownCashback =
    params.kind === 'coupons'
      ? []
      : filterCashbackOffers(
          cashback,
          {
            q: params.q,
            merchantId,
            category: params.category,
            productCategoryById,
          },
          new Date()
        );

  const total = shownCoupons.length + shownCashback.length;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: WebPage + BreadcrumbList
          (Home → AI tools → this tool). */}
      <PageJsonLd
        name="Coupons & Cashback Finder"
        description="Find coupon codes and cashback offers by store and category. Demo / seed data — sample offers from the demo catalog, not live merchant offers."
        path="/tools/coupons-cashback"
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'AI tools', path: '/tools' },
          { name: 'Coupons & Cashback Finder' },
        ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Tag className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingCouponsCashback')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Search coupon codes and cashback offers by store and category —
            the code to enter at the retailer&apos;s checkout, and the
            cashback a store offers on top of the price.
          </p>
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {DEMO_DATA_NOTE}
          </p>

          <form
            method="get"
            action="/tools/coupons-cashback"
            className="mt-8 rounded-lg border p-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="q" className="text-sm font-medium">
                  Search
                </label>
                <input
                  id="q"
                  name="q"
                  type="search"
                  placeholder="e.g. SAVE10, or a store or offer"
                  defaultValue={params.q}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="store" className="text-sm font-medium">
                  Store
                </label>
                <select
                  id="store"
                  name="store"
                  defaultValue={params.store}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">All stores</option>
                  {merchants.map((merchant) => (
                    <option key={merchant.id} value={merchant.slug}>
                      {merchant.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="kind" className="text-sm font-medium">
                  Type
                </label>
                <select
                  id="kind"
                  name="kind"
                  defaultValue={params.kind}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {FINDER_KINDS.map((kind: FinderKind) => (
                    <option key={kind} value={kind}>
                      {FINDER_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="category" className="text-sm font-medium">
                  Category
                </label>
                <select
                  id="category"
                  name="category"
                  defaultValue={params.category}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Category applies to cashback linked to a product; coupons
                  are store-wide codes, so they are shown for every category.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="submit">Find offers →</Button>
              {(params.q || params.store || params.kind !== 'all' || params.category) && (
                <Link
                  href="/tools/coupons-cashback"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-md border px-4 py-2 text-sm font-medium"
                >
                  Clear filters
                </Link>
              )}
            </div>
          </form>

          <p className="mt-8 text-sm text-muted-foreground" aria-live="polite">
            {total === 0
              ? 'No offers match these filters.'
              : `Showing ${shownCoupons.length} coupon${shownCoupons.length !== 1 ? 's' : ''} and ${shownCashback.length} cashback offer${shownCashback.length !== 1 ? 's' : ''}.`}
          </p>

          {params.kind !== 'cashback' && (
            <section className="mt-6" aria-label="Coupons">
              <h2 className="text-xl font-semibold">Coupons</h2>
              {shownCoupons.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No coupon codes match these filters — try another store or
                  clear the search.
                </p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {shownCoupons.map((coupon) => {
                    const merchant = coupon.merchantId
                      ? merchantById.get(coupon.merchantId)
                      : undefined;
                    return (
                      <li key={coupon.id} className="rounded-lg border p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-mono text-lg font-bold tracking-wider">
                            {coupon.code}
                          </span>
                          <span className="text-sm font-semibold text-green-700">
                            {formatCouponValue(coupon)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {merchant ? merchant.name : 'All stores'}
                          {' · '}
                          {formatExpiry(coupon.validUntil)}
                        </p>
                        {coupon.description && (
                          <p className="mt-2 text-sm">{coupon.description}</p>
                        )}
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {coupon.minOrderValue !== null && (
                            <li>Min order: ${coupon.minOrderValue}</li>
                          )}
                          {coupon.maxDiscountAmount !== null && (
                            <li>Max discount: ${coupon.maxDiscountAmount}</li>
                          )}
                          <li>Per-user limit: {coupon.perUserLimit}</li>
                        </ul>
                        {merchant?.websiteUrl && (
                          <p className="mt-3 text-sm">
                            <Link
                              href={merchant.websiteUrl}
                              className="underline underline-offset-4"
                            >
                              Shop at {merchant.name} →
                            </Link>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {params.kind !== 'coupons' && (
            <section className="mt-10" aria-label="Cashback offers">
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <DollarSign className="h-5 w-5 text-green-700" /> Cashback
                offers
              </h2>
              {shownCashback.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No cashback offers match these filters — try another store
                  or category, or clear the search.
                </p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {shownCashback.map((offer) => {
                    const merchant = merchantById.get(offer.merchantId);
                    const product = offer.productId
                      ? productResult.products.find(
                          (p) => p.id === offer.productId
                        )
                      : undefined;
                    return (
                      <li key={offer.id} className="rounded-lg border p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-semibold">{offer.title}</span>
                          <span className="text-sm font-semibold text-green-700">
                            {formatCashbackValue(offer)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {merchant ? merchant.name : 'Unknown store'}
                          {product ? ` · ${product.name}` : ''}
                          {' · '}
                          {formatExpiry(offer.endAt)}
                        </p>
                        {offer.description && (
                          <p className="mt-2 text-sm">{offer.description}</p>
                        )}
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {offer.maxCashbackAmount !== null && (
                            <li>Max cashback: ${offer.maxCashbackAmount}</li>
                          )}
                        </ul>
                        {offer.termsUrl && (
                          <p className="mt-3 text-sm">
                            <Link
                              href={offer.termsUrl}
                              className="underline underline-offset-4"
                            >
                              Read the full terms →
                            </Link>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          <p className="mt-10 text-xs text-muted-foreground">
            {DEMO_DATA_NOTE} Coupons are entered at the retailer&apos;s own
            checkout — SmartBuy never applies a discount itself. See{' '}
            <Link href="/deals" className="underline underline-offset-4">
              Deals
            </Link>{' '}
            for the same coupons alongside ranked deals.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
