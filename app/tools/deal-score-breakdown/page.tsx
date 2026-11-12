/**
 * Deal Score Breakdown Explorer — /tools/deal-score-breakdown
 * (Section 16, E4).
 *
 * Pick a product, see its Deal Score as term-by-term numbers
 * (drop-chance term, price term, confidence term) summing to the
 * displayed score. Server component, no JavaScript needed: the
 * form submits as a plain GET to this same page (?product=…), so
 * the result URL is shareable. Inputs come from the predictions
 * service (predictPriceDrop — the same inputs the predictions API
 * exposes), broken down by lib/deal-score-breakdown.ts using the
 * CANONICAL formula in lib/deal-score.ts.
 *
 * Honesty: the live catalog scores 100/100 on every product
 * because 4 recorded points → discount probability 0, confidence
 * 20 → 100 − 0 + 30 + 6 = 136, clamped to 100. This page shows
 * those real inputs and the raw (unclamped) total, so the 100/100
 * is explained instead of hidden. The score is NOT rebased. The
 * Deal Score badge stays hidden on product pages until a
 * prediction rests on 5+ recorded points — this page shows the
 * underlying arithmetic anyway, labelled as such.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { Sigma } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { ShareButtons } from '@/components/products/share-buttons';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { predictPriceDrop } from '@/services/ai-predictions';
import { breakdownDealScoreFromPrediction } from '@/lib/deal-score-breakdown';
import {
  DEAL_SCORE_MIN_DATA_POINTS,
  shouldShowDealScore,
} from '@/lib/deal-score';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Deal Score Breakdown Explorer — SmartBuy AI',
  description:
    'What is behind a product’s Deal Score? Pick a product and see the score as term-by-term numbers — drop-chance term, price term, confidence term — summing to the displayed score, from the real prediction inputs.',
  alternates: {
    canonical: `${appConfig.url}/tools/deal-score-breakdown`,
  },
  openGraph: {
    title: 'Deal Score Breakdown Explorer — SmartBuy AI',
    description:
      'What is behind a product’s Deal Score? Term-by-term numbers — drop-chance, price, confidence — summing to the displayed score, from the real prediction inputs.',
    url: `${appConfig.url}/tools/deal-score-breakdown`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Deal Score Breakdown Explorer — SmartBuy AI',
    description:
      'A Deal Score as term-by-term numbers, from the real prediction inputs behind it.',
  },
};

interface DealScoreBreakdownProps {
  searchParams: { product?: string | string[] };
}

export default async function DealScoreBreakdownPage({
  searchParams,
}: DealScoreBreakdownProps) {
  const supabase = await createSupabaseServerClient();
  const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });
  const sortedProducts = [...products].sort((a, b) => a.name.localeCompare(b.name));

  const rawProduct = searchParams.product;
  const productId = Array.isArray(rawProduct) ? rawProduct[0] : rawProduct;
  const selected =
    (productId ? products.find((p) => p.id === productId) ?? null : null) ??
    sortedProducts[0] ??
    null;

  const prediction = selected
    ? await predictPriceDrop(supabase, selected.id)
    : null;
  const breakdown = breakdownDealScoreFromPrediction(prediction);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Deal Score Breakdown Explorer"
        description="What is behind a product’s Deal Score? Pick a product and see the score as term-by-term numbers — drop-chance term, price term, confidence term — summing to the displayed score, from the real prediction inputs."
        path="/tools/deal-score-breakdown"
        crumbs={[ { name: "Home", path: "/" }, { name: "AI tools", path: "/tools" }, { name: "Deal Score Breakdown Explorer" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Sigma className="h-7 w-7 text-blue-600" /> Deal Score Breakdown Explorer
          </h1>
          <p className="mt-2 text-muted-foreground">
            What is behind a product&apos;s Deal Score? Pick a product
            and see the score as term-by-term numbers — the drop-chance
            term, the price term, and the confidence term — summing to
            the displayed score. The inputs are the real ones from the
            price-drop prediction; the formula is the canonical one, and
            nothing is re-derived or rebased.
          </p>

          <form
            method="get"
            action="/tools/deal-score-breakdown"
            className="mt-8 rounded-lg border p-6"
          >
            <label htmlFor="product" className="text-sm font-medium">
              Product
            </label>
            <select
              id="product"
              name="product"
              defaultValue={selected?.id ?? ''}
              className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {sortedProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button type="submit" className="mt-4">
              Show breakdown →
            </Button>
          </form>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Share this view:
            </span>
            <ShareButtons
              title="Deal Score Breakdown Explorer — SmartBuy AI"
              text="What is behind a Deal Score? Term-by-term numbers from the real prediction inputs. — SmartBuy AI"
            />
          </div>

          {sortedProducts.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No products yet"
                title="No products to break down"
                description="The catalog is empty right now, so there is no Deal Score to explain."
              />
            </div>
          )}

          {selected && !breakdown && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No prediction yet"
                title="No Deal Score breakdown for this product"
                description="There is no price-drop prediction for this product yet, so there are no inputs to break down. A missing prediction is shown as missing — never as a guessed score."
              />
            </div>
          )}

          {selected && breakdown && (
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border p-6">
                <h2 className="text-lg font-semibold">
                  <Link
                    href={`/products/${selected.slug}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {selected.name}
                  </Link>
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selected.brand ?? 'Unknown brand'}
                  {selected.category ? ` · ${selected.category}` : ''}
                  {` · from ${breakdown.dataPoints ?? 'unknown'} recorded point${breakdown.dataPoints === 1 ? '' : 's'}`}
                </p>
                <p className="mt-3 text-2xl font-bold">
                  Deal Score: {breakdown.score}/100
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Raw total before clamping: {breakdown.rawTotal.toFixed(1)}
                  {breakdown.clamped &&
                    ' — the raw total was clamped to 0–100, which is why the score reads 100/100.'}
                </p>
                {!shouldShowDealScore(breakdown.dataPoints) && (
                  <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                    Honest note: the Deal Score badge is hidden on product
                    pages until a prediction rests on {DEAL_SCORE_MIN_DATA_POINTS}+
                    recorded points. This product has{' '}
                    {breakdown.dataPoints ?? 'an unknown number of'} — so
                    this 100/100 is a 4-point artifact, shown here with its
                    real inputs rather than hidden.
                  </p>
                )}
              </div>

              <div className="rounded-lg border p-6">
                <h2 className="text-lg font-semibold">Term by term</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  {breakdown.terms.map((term) => (
                    <div
                      key={term.label}
                      className="flex items-start justify-between gap-4 rounded-md bg-muted p-3"
                    >
                      <div>
                        <dt className="font-medium">{term.label}</dt>
                        <dd className="text-muted-foreground">{term.formula}</dd>
                      </div>
                      <dd className="font-semibold">
                        {term.value > 0 ? '+' : ''}
                        {term.value.toFixed(1)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-sm text-muted-foreground">
                  100 {breakdown.terms.slice(1).map((t) => `${t.value >= 0 ? '+' : '−'} ${Math.abs(t.value).toFixed(1)}`).join(' ')} ={' '}
                  {breakdown.rawTotal.toFixed(1)} raw
                  {breakdown.clamped ? ` → clamped to ${breakdown.score}` : ` → ${breakdown.score}`}.
                </p>
              </div>

              <div className="rounded-lg border p-6">
                <h2 className="text-lg font-semibold">The real inputs</h2>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Drop chance</dt>
                    <dd className="mt-1 font-semibold">
                      {breakdown.inputs.discountProbability}%
                    </dd>
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Confidence</dt>
                    <dd className="mt-1 font-semibold">
                      {breakdown.inputs.confidenceScore}
                    </dd>
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Current price</dt>
                    <dd className="mt-1 font-semibold">
                      {breakdown.inputs.currentPrice !== null
                        ? `$${breakdown.inputs.currentPrice.toFixed(2)}`
                        : 'Unknown'}
                    </dd>
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Recorded low</dt>
                    <dd className="mt-1 font-semibold">
                      {breakdown.inputs.lowestPrice !== null
                        ? `$${breakdown.inputs.lowestPrice.toFixed(2)}`
                        : 'Unknown'}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  Formula: score = 100 − drop chance × 0.4 + (lowest /
                  current × 30, or +20 when a price is missing) +
                  confidence × 0.3, rounded and clamped to 0–100. The
                  same formula the product page uses — never re-derived
                  here.
                </p>
              </div>

              <Link
                href={`/products/${selected.slug}`}
                className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                View product →
              </Link>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
