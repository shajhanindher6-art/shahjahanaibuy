/**
 * AI Upgrade Advisor — /tools/upgrade-advisor.
 *
 * "Should I upgrade or keep my current device?" The user states
 * their current device (brand/category, purchase year, price paid)
 * and picks a catalog successor — or picks from same-category
 * successors the tool suggests. Deterministic verdict tiers
 * (Keep / Wait / Upgrade) from cost-per-year math (price paid ÷
 * years owned) vs the successor's recorded price, plus a resale
 * projection from services/resale-predictor.ts.
 *
 * Server component, no JavaScript needed: the form submits as a
 * plain GET to this same page, so the result URL is shareable.
 * Data: getProducts + getPriceHistory, composed by
 * lib/upgrade-advisor.ts (pure math).
 *
 * Honesty: no trade-in value is recorded anywhere — none is ever
 * quoted. The resale figure is labelled PROJECTION with its basis
 * (recorded prices are seed/demo prices from 2026-11-02, not live
 * market prices). Successor prices carry their STALE label. The
 * successor is never claimed to be "better" on specs (0 specs
 * rows). If the current device is not in the catalog, all math
 * uses the user's entered price.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpCircle } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { getPriceHistory } from '@/services/price-history';
import {
  predictResaleValue,
  RESALE_MIN_POINTS,
  RESALE_MIN_SPAN_DAYS,
} from '@/services/resale-predictor';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import {
  decideUpgrade,
  findSameCategorySuccessors,
  parseUpgradeAdvisorParams,
  RESALE_PROJECTION_LABEL,
  SUCCESSOR_PRICE_STALE_LABEL,
  type UpgradeVerdict,
} from '@/lib/upgrade-advisor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Upgrade Advisor — SmartBuy AI',
  description:
    'Should you upgrade or keep your current device? Cost-per-year math vs a catalog successor’s recorded price, plus a labelled resale projection. No trade-in quote, ever.',
  alternates: {
    canonical: `${appConfig.url}/tools/upgrade-advisor`,
  },
  openGraph: {
    title: 'AI Upgrade Advisor — SmartBuy AI',
    description:
      'Should you upgrade or keep your current device? Cost-per-year math vs a catalog successor’s recorded price, plus a labelled resale projection. No trade-in quote, ever.',
    url: `${appConfig.url}/tools/upgrade-advisor`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'AI Upgrade Advisor — SmartBuy AI',
    description:
      'Should you upgrade or keep your current device? Cost-per-year math vs a catalog successor’s recorded price, plus a labelled resale projection. No trade-in quote, ever.',
  },
};

interface UpgradeAdvisorProps {
  searchParams: {
    brand?: string | string[];
    category?: string | string[];
    year?: string | string[];
    price?: string | string[];
    current?: string | string[];
    successor?: string | string[];
  };
}

const VERDICT_LABEL: Record<UpgradeVerdict, string> = {
  keep: 'Keep',
  wait: 'Wait',
  upgrade: 'Upgrade',
};

const VERDICT_STYLE: Record<UpgradeVerdict, string> = {
  keep: 'bg-green-100 text-green-800',
  wait: 'bg-amber-100 text-amber-800',
  upgrade: 'bg-blue-100 text-blue-800',
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function UpgradeAdvisorPage({
  searchParams,
}: UpgradeAdvisorProps): Promise<JSX.Element> {
  const params = parseUpgradeAdvisorParams(searchParams);
  const supabase = await createSupabaseServerClient();
  const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });

  const categories = Array.from(
    new Set(products.map((p) => p.category).filter((c): c is string => !!c))
  ).sort();

  const successor =
    params.successorSlug !== ''
      ? (products.find((p) => p.slug === params.successorSlug) ?? null)
      : null;
  const currentProduct =
    params.currentSlug !== ''
      ? (products.find((p) => p.slug === params.currentSlug) ?? null)
      : null;

  // Successor recorded price + history (recorded points only).
  let successorPrice: number | null = null;
  let successorLastChecked: string | null = null;
  if (successor) {
    const result = await getPriceHistory(supabase, successor.id, { limit: 500 });
    successorPrice = result.currentPrice;
    successorLastChecked = result.freshness.lastRecordedAt ?? successor.dataFreshness;
  }

  // Resale projection for the CURRENT device — only when the user
  // picked it from the catalog, so the projection comes from that
  // product's OWN recorded decline. A device that is not in the
  // catalog gets no projection; its math uses the entered price.
  let resaleProjectedValue: number | null = null;
  let resaleReason: string | null = null;
  let resaleBasis: string | null = null;
  if (currentProduct) {
    const result = await getPriceHistory(supabase, currentProduct.id, {
      limit: 500,
    });
    const points = (result.history ?? []).map((h) => ({
      price: Number(h.price),
      recordedAt: h.recordedAt,
    }));
    const prediction = predictResaleValue(points, result.currentPrice);
    if (prediction.status === 'ok') {
      resaleProjectedValue = prediction.projectedValueUsd24;
      resaleReason = prediction.reason;
      resaleBasis = `${prediction.pointCount} recorded points over ${prediction.spanDays} days`;
    } else {
      resaleReason = `Not enough recorded price history to project resale value (needs at least ${RESALE_MIN_POINTS} points spanning ${RESALE_MIN_SPAN_DAYS} days; this product has ${prediction.pointCount} points over ${prediction.spanDays} days).`;
    }
  }

  const hasQuery =
    params.purchaseYear !== null || params.pricePaid !== null;
  const advice =
    params.purchaseYear !== null && params.pricePaid !== null
      ? decideUpgrade({
          pricePaid: params.pricePaid,
          purchaseYear: params.purchaseYear,
          successorPrice,
          resaleProjectedValue,
        })
      : null;
  const suggestions =
    successor === null
      ? findSameCategorySuccessors(products, params.category)
      : [];

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: WebPage + BreadcrumbList
          (Home → AI tools → this tool). */}
      <PageJsonLd
        name="AI Upgrade Advisor"
        description="Should you upgrade or keep your current device? Cost-per-year math vs a catalog successor’s recorded price, plus a labelled resale projection. No trade-in quote, ever."
        path="/tools/upgrade-advisor"
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'AI tools', path: '/tools' },
          { name: 'AI Upgrade Advisor' },
        ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <ArrowUpCircle className="h-7 w-7 text-blue-600" /> AI Upgrade
            Advisor
          </h1>
          <p className="mt-2 text-muted-foreground">
            Should you upgrade or keep your current device? Tell us
            what you paid and when you bought it, pick a successor
            from the catalog, and we compare what your device costs
            per year against the successor&apos;s recorded price —
            plus a resale projection when your current device is in
            the catalog. No trade-in value is recorded anywhere, so
            none is ever quoted here.
          </p>

          <form
            method="get"
            action="/tools/upgrade-advisor"
            className="mt-8 rounded-lg border p-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="brand" className="text-sm font-medium">
                  Current device brand
                </label>
                <input
                  id="brand"
                  name="brand"
                  type="text"
                  placeholder="e.g. Apple"
                  defaultValue={params.brand}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="category" className="text-sm font-medium">
                  Current device category
                </label>
                <input
                  id="category"
                  name="category"
                  type="text"
                  list="upgrade-categories"
                  placeholder="e.g. Laptops"
                  defaultValue={params.category}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
                <datalist id="upgrade-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <label htmlFor="year" className="text-sm font-medium">
                  Purchase year
                </label>
                <input
                  id="year"
                  name="year"
                  type="number"
                  min="1990"
                  max={new Date().getFullYear()}
                  step="1"
                  inputMode="numeric"
                  placeholder="e.g. 2021"
                  defaultValue={
                    params.purchaseYear !== null ? String(params.purchaseYear) : ''
                  }
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="price" className="text-sm font-medium">
                  Price you paid (USD)
                </label>
                <input
                  id="price"
                  name="price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 999"
                  defaultValue={
                    params.pricePaid !== null ? String(params.pricePaid) : ''
                  }
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="current" className="text-sm font-medium">
                  Your current device in our catalog (optional)
                </label>
                <select
                  id="current"
                  name="current"
                  defaultValue={params.currentSlug}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Not in the catalog</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Only used for the resale projection. If your device
                  is not listed, all math uses the price you entered.
                </p>
              </div>
              <div>
                <label htmlFor="successor" className="text-sm font-medium">
                  Successor (catalog product)
                </label>
                <select
                  id="successor"
                  name="successor"
                  defaultValue={params.successorSlug}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Pick a successor…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {params.yearError && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {params.yearError}
              </p>
            )}
            {params.priceError && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {params.priceError}
              </p>
            )}
            <Button type="submit" className="mt-4">
              Should I upgrade? →
            </Button>
          </form>

          {products.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No products yet"
                title="No catalog to compare against"
                description="The catalog is empty right now, so there is no successor to compare your device with."
              />
            </div>
          )}

          {products.length > 0 && successor === null && suggestions.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl font-semibold">
                Same-category successors
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                In the category you entered ({params.category}) — pick
                one as the successor. This is a same-category
                shortlist only; with no recorded specs, it never
                claims one product is &ldquo;better&rdquo; than another.
              </p>
              <ul className="mt-4 space-y-2">
                {suggestions.map((p) => (
                  <li key={p.slug} className="rounded-lg border p-4">
                    <Link
                      href={`/tools/upgrade-advisor?brand=${encodeURIComponent(params.brand)}&category=${encodeURIComponent(params.category)}&year=${params.purchaseYear ?? ''}&price=${params.pricePaid ?? ''}&current=${encodeURIComponent(params.currentSlug)}&successor=${encodeURIComponent(p.slug)}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {p.brand ?? 'Unknown brand'}
                      {p.category ? ` · ${p.category}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {advice !== null && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">Verdict</h2>
              <p className="mt-3">
                <span
                  className={`inline-flex rounded-full px-4 py-1 text-lg font-bold ${VERDICT_STYLE[advice.verdict]}`}
                >
                  {VERDICT_LABEL[advice.verdict]}
                </span>
              </p>
              <p className="mt-3 text-sm text-muted-foreground">{advice.reason}</p>

              <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Owned</dt>
                  <dd className="mt-1 font-semibold">
                    {advice.yearsOwned} year{advice.yearsOwned === 1 ? '' : 's'}
                  </dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Cost per year</dt>
                  <dd className="mt-1 font-semibold">
                    ${advice.costPerYear.toFixed(2)}
                  </dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">
                    Successor price {successor ? `(${successor.name})` : ''}
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {advice.successorPrice !== null
                      ? `$${advice.successorPrice.toFixed(2)}`
                      : 'No recorded price'}
                  </dd>
                  <dd className="mt-1 text-xs text-muted-foreground">
                    {SUCCESSOR_PRICE_STALE_LABEL}
                    {successorLastChecked
                      ? ` Last checked ${formatDate(successorLastChecked)}.`
                      : ''}
                  </dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Net upgrade cost</dt>
                  <dd className="mt-1 font-semibold">
                    {advice.netUpgradeCost !== null
                      ? `$${advice.netUpgradeCost.toFixed(2)}`
                      : 'Cannot be computed yet'}
                  </dd>
                  <dd className="mt-1 text-xs text-muted-foreground">
                    {advice.resaleProjectedValue !== null
                      ? 'Successor price minus the projected resale below.'
                      : 'Full successor price — no resale projection to subtract.'}
                  </dd>
                </div>
              </dl>

              <div className="mt-6 rounded-lg border p-4">
                <h3 className="font-semibold">Resale projection</h3>
                {advice.resaleProjectedValue !== null ? (
                  <>
                    <p className="mt-2 text-2xl font-bold">
                      ${advice.resaleProjectedValue.toFixed(2)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {RESALE_PROJECTION_LABEL}
                    </p>
                    {resaleBasis && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Basis: {resaleBasis} for{' '}
                        {currentProduct?.name ?? 'the current device'}.
                      </p>
                    )}
                    {resaleReason && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {resaleReason}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {currentProduct
                      ? (resaleReason ??
                        'No resale projection could be made for this product.')
                      : 'No resale projection — your current device is not in the catalog, so all math uses the price you entered. No trade-in value is recorded anywhere, so none is quoted here.'}
                  </p>
                )}
              </div>

              <p className="mt-4 text-xs text-muted-foreground">
                This advice is arithmetic on recorded prices only. It
                never compares specs — the catalog has no recorded
                specs — and the resale figure is a projection, not a
                guaranteed amount or a trade-in quote.
              </p>
              {successor && (
                <p className="mt-3">
                  <Link
                    href={`/products/${successor.slug}`}
                    className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    View successor →
                  </Link>
                </p>
              )}
            </section>
          )}

          {!hasQuery && products.length > 0 && (
            <p className="mt-8 text-sm text-muted-foreground">
              Tip: try a MacBook Air bought in 2021 for $999, with the
              Dell XPS 13 as the successor.
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
