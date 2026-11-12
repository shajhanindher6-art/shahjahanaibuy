/**
 * Price Protection Check — /tools/price-protection (Section 14).
 *
 * Guest tool, no sign-in. The user enters a product, what they
 * paid, when they bought it, and a protection window (days). The
 * page checks ONLY the RECORDED price history (currently 4 points
 * per product over 30 days, Amazon only) for recorded points inside
 * that window after the purchase date.
 *
 * Server component, no JavaScript needed: the form submits as a
 * plain GET to this same page
 * (?product=…&price=…&date=…&window=…), so the result URL is
 * shareable. Data: getProducts + getPriceHistory, judged by
 * lib/price-protection-check.ts.
 *
 * Honesty: the check CAN prove whether a lower price was recorded
 * in the window; it CANNOT prove a retailer will refund the
 * difference — retailer policies are not in our data and are never
 * checked here. A 'lower-price-found' result is evidence to take
 * to the retailer, not a guarantee of a refund.
 */

import { cookies } from 'next/headers';
import { isSupportedLanguage, type Language } from '@/lib/region';
import { tFor } from '@/lib/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { ShareButtons } from '@/components/products/share-buttons';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { getPriceHistory } from '@/services/price-history';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import {
  PROTECTION_VERDICT_LABELS,
  PROTECTION_WINDOWS_DAYS,
  checkPriceProtection,
  parseProtectionParams,
} from '@/lib/price-protection-check';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Price Protection Check — SmartBuy AI',
  description:
    'Bought something and the price dropped after? Check whether a lower price was recorded inside your protection window. Recorded prices only — retailer policies are not checked.',
  alternates: {
    canonical: `${appConfig.url}/tools/price-protection`,
  },
  openGraph: {
    title: 'Price Protection Check — SmartBuy AI',
    description:
      'Bought something and the price dropped after? Check whether a lower price was recorded inside your protection window. Recorded prices only — retailer policies are not checked.',
    url: `${appConfig.url}/tools/price-protection`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Price Protection Check — SmartBuy AI',
    description:
      'Bought something and the price dropped after? Check whether a lower price was recorded inside your protection window. Recorded prices only — retailer policies are not checked.',
  },
};

interface PriceProtectionProps {
  searchParams: {
    product?: string | string[];
    price?: string | string[];
    date?: string | string[];
    window?: string | string[];
  };
}

/**
 * Section 15 (C3): the server reads the same sb-language cookie the
 * root layout and homepage use for dir/lang — a first-visit language
 * switch via localStorage takes effect on the next load.
 */
function toolLanguage(): Language {
  const saved = cookies().get('sb-language')?.value ?? null;
  return saved && isSupportedLanguage(saved) ? saved : 'en';
}

export default async function PriceProtectionPage({
  searchParams,
}: PriceProtectionProps) {
  const language = toolLanguage();
  const { productId, price, date, windowDays, errors, hasQuery } =
    parseProtectionParams(searchParams);
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
    selected && price !== null && date !== null
      ? checkPriceProtection(price, date, points, windowDays)
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: WebPage + BreadcrumbList
          (Home → AI tools → this tool). */}
      <PageJsonLd
        name="Price Protection Check"
        description="Bought something and the price dropped after? Check whether a lower price was recorded inside your protection window. Recorded prices only — retailer policies are not checked."
        path="/tools/price-protection"
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'AI tools', path: '/tools' },
          { name: 'Price Protection Check' },
        ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <ShieldCheck className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingPriceProtection')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Bought something and the price dropped soon after? This
            checks whether a lower price than yours was recorded inside
            the window after your purchase — currently 4 recorded points
            per product over 30 days (Amazon only). No sign-in needed.
            What this check cannot do: prove a retailer will refund the
            difference. Retailer price-protection policies, claim
            deadlines, and exclusions are not in our data — a lower
            recorded price is evidence to take to the retailer, not a
            guarantee of a refund.
          </p>

          {products.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No products yet"
                title="No products to check"
                description="The catalog is empty right now, so there is no recorded price history to check a purchase against."
              />
            </div>
          )}

          {products.length > 0 && (
            <form
              method="get"
              action="/tools/price-protection"
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
                    defaultValue={price !== null ? String(price) : ''}
                    className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="date" className="text-sm font-medium">
                    Purchase date
                  </label>
                  <input
                    id="date"
                    name="date"
                    type="date"
                    defaultValue={date ?? ''}
                    className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="window" className="text-sm font-medium">
                    Protection window
                  </label>
                  <select
                    id="window"
                    name="window"
                    defaultValue={String(windowDays)}
                    className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    {PROTECTION_WINDOWS_DAYS.map((w) => (
                      <option key={w} value={w}>
                        {w} days after purchase
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {errors.length > 0 && (
                <div className="mt-3" role="alert">
                  {errors.map((e) => (
                    <p key={e} className="text-sm font-medium text-red-600">
                      {e}
                    </p>
                  ))}
                </div>
              )}
              {productId !== null && !selected && (
                <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                  That product was not found in the catalog.
                </p>
              )}
              <Button type="submit" className="mt-4">
                Check protection →
              </Button>
            </form>
          )}

          {check !== null && selected && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">Result</h2>
              <p className="mt-3 text-lg font-semibold">
                {PROTECTION_VERDICT_LABELS[check.verdict]}
              </p>
              {check.verdict === 'lower-price-found' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  You paid ${check.purchasePrice.toFixed(2)} on{' '}
                  {new Date(check.purchaseDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                  . Within {check.windowDays} days after that, the
                  lowest recorded price was $
                  {check.lowestAfterPurchase?.toFixed(2)} — $
                  {check.difference.toFixed(2)} less than you paid.
                  Take this to the retailer with your receipt and ask
                  about their price-protection policy; this result does
                  not guarantee a refund.
                </p>
              )}
              {check.verdict === 'no-lower-price' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Within {check.windowDays} days after your purchase,
                  the lowest recorded price was $
                  {check.lowestAfterPurchase?.toFixed(2)} — not below
                  the ${check.purchasePrice.toFixed(2)} you paid, on the
                  recorded points. No lower price was recorded in the
                  window.
                </p>
              )}
              {check.verdict === 'cannot-verify' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {check.reason} Only {check.pointsInWindow.length}{' '}
                  recorded point
                  {check.pointsInWindow.length === 1 ? ' was' : 's were'}{' '}
                  found in the {check.windowDays}-day window after your
                  purchase date — with 4 recorded points per product
                  over 30 days, many windows simply have no data.
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Checked against recorded points only ({check.pointsInWindow.length}{' '}
                in the window). Retailer policies, claim deadlines, and
                exclusions are not checked here.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Share this check:
                </span>
                <ShareButtons
                  title="Price Protection Check — SmartBuy AI"
                  text={`Paid $${check.purchasePrice.toFixed(2)} for ${selected.name}: ${PROTECTION_VERDICT_LABELS[check.verdict]} — SmartBuy AI`}
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
              Tip: enter what you paid and when — if a lower price was
              recorded within your window, you may have a claim worth
              raising with the retailer.
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
