/**
 * Price Alert Simulator — /tools/price-alert-simulator (Section 14).
 *
 * Pick a product and a target price; the page simulates what a
 * price-drop alert at that target would do, judged ONLY against
 * the RECORDED price history (currently 4 points per product over
 * 30 days, Amazon only).
 *
 * Server component, no JavaScript needed: the form submits as a
 * plain GET to this same page (?product=…&target=…), so the result
 * URL is shareable. Data: getProducts + getPriceHistory, judged by
 * lib/price-alert-simulator.ts.
 *
 * Honesty: no probability, no predicted date, no smoothing — the
 * verdict only says whether the target was already met, has been
 * recorded before, or has never been recorded. This is a
 * simulation only; it creates NO real price alert.
 */

import { cookies } from 'next/headers';
import { isSupportedLanguage, type Language } from '@/lib/region';
import { tFor } from '@/lib/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { ShareButtons } from '@/components/products/share-buttons';
import { SimulatorToAlertButton } from '@/components/tools/simulator-to-alert-button';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { getPriceHistory } from '@/services/price-history';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import {
  ALERT_VERDICT_LABELS,
  parseAlertSimulatorParams,
  simulatePriceAlert,
} from '@/lib/price-alert-simulator';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Price Alert Simulator — SmartBuy AI',
  description:
    'Pick a product and a target price — see whether that price was already met, has been recorded before, or has never been recorded. Recorded prices only, no predictions.',
  alternates: {
    canonical: `${appConfig.url}/tools/price-alert-simulator`,
  },
  openGraph: {
    title: 'Price Alert Simulator — SmartBuy AI',
    description:
      'Pick a product and a target price — see whether that price was already met, has been recorded before, or has never been recorded. Recorded prices only, no predictions.',
    url: `${appConfig.url}/tools/price-alert-simulator`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Price Alert Simulator — SmartBuy AI',
    description:
      'Pick a product and a target price — see whether that price was already met, has been recorded before, or has never been recorded. Recorded prices only, no predictions.',
  },
};

interface PriceAlertSimulatorProps {
  searchParams: {
    product?: string | string[];
    target?: string | string[];
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

export default async function PriceAlertSimulatorPage({
  searchParams,
}: PriceAlertSimulatorProps) {
  const language = toolLanguage();
  const { productId, target, targetError } =
    parseAlertSimulatorParams(searchParams);
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
  const simulation =
    selected && target !== null ? simulatePriceAlert(target, points) : null;
  const hasQuery = productId !== null || target !== null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: WebPage + BreadcrumbList
          (Home → AI tools → this tool). */}
      <PageJsonLd
        name="Price Alert Simulator"
        description="Pick a product and a target price — see whether that price was already met, has been recorded before, or has never been recorded. Recorded prices only, no predictions."
        path="/tools/price-alert-simulator"
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'AI tools', path: '/tools' },
          { name: 'Price Alert Simulator' },
        ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Bell className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingPriceAlertSimulator')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Would a price-drop alert at your target price ever fire?
            This simulates the alert against the product&apos;s recorded
            price history — currently 4 recorded points per product over
            30 days (Amazon only). Nothing is predicted and nothing is
            smoothed: the answer only says what the recorded past
            shows. This simulation creates NO real price alert.
          </p>

          {products.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No products yet"
                title="No products to simulate"
                description="The catalog is empty right now, so there is no recorded price history to simulate against."
              />
            </div>
          )}

          {products.length > 0 && (
            <form
              method="get"
              action="/tools/price-alert-simulator"
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
                  <label htmlFor="target" className="text-sm font-medium">
                    Target price (USD)
                  </label>
                  <input
                    id="target"
                    name="target"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="e.g. 899"
                    defaultValue={target !== null ? String(target) : ''}
                    className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {targetError && (
                <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                  {targetError}
                </p>
              )}
              {productId !== null && !selected && (
                <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                  That product was not found in the catalog.
                </p>
              )}
              <Button type="submit" className="mt-4">
                Simulate alert →
              </Button>
            </form>
          )}

          {simulation !== null && selected && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">Simulation result</h2>
              <p className="mt-3 text-lg font-semibold">
                {ALERT_VERDICT_LABELS[simulation.verdict]}
              </p>
              {simulation.verdict === 'cannot-verify' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {selected.name} has no recorded price history, so the
                  target cannot be judged against the past. The alert
                  would simply wait for a future recorded price at or
                  below ${simulation.target.toFixed(2)}.
                </p>
              )}
              {simulation.verdict === 'already-met' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  The current recorded price is $
                  {simulation.current.toFixed(2)}, already at or below
                  your target of ${simulation.target.toFixed(2)} — an
                  alert set at this target would fire right now.
                </p>
              )}
              {simulation.verdict === 'recorded-before' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  The current recorded price is $
                  {simulation.current.toFixed(2)}. Your target of $
                  {simulation.target.toFixed(2)} is at or above the
                  lowest recorded price ($
                  {simulation.lowest.toFixed(2)}), so this price has
                  been seen before — but the recorded history cannot
                  say when, or whether, it will be seen again. The
                  price would need to drop $
                  {simulation.dropNeededAmount.toFixed(2)} (
                  {simulation.dropNeededPercent.toFixed(1)}%) from
                  current.
                </p>
              )}
              {simulation.verdict === 'below-recorded-low' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  The current recorded price is $
                  {simulation.current.toFixed(2)} and the lowest
                  recorded price is ${simulation.lowest.toFixed(2)} —
                  your target of ${simulation.target.toFixed(2)} is
                  below every recorded price. It has never been seen
                  in the recorded history, so the alert would wait for
                  a new record low. The price would need to drop $
                  {simulation.dropNeededAmount.toFixed(2)} (
                  {simulation.dropNeededPercent.toFixed(1)}%) from
                  current.
                </p>
              )}
              {simulation.pointCount > 0 && (
                <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Current</dt>
                    <dd className="mt-1 font-semibold">
                      ${simulation.current.toFixed(2)}
                    </dd>
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Recorded low</dt>
                    <dd className="mt-1 font-semibold">
                      ${simulation.lowest.toFixed(2)}
                    </dd>
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Recorded high</dt>
                    <dd className="mt-1 font-semibold">
                      ${simulation.highest.toFixed(2)}
                    </dd>
                  </div>
                </dl>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Based on {simulation.pointCount} recorded point
                {simulation.pointCount === 1 ? '' : 's'} over 30 days
                (Amazon only). No probability and no date is predicted
                — with this little history, none would be honest.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Share this simulation:
                </span>
                <ShareButtons
                  title="Price Alert Simulator — SmartBuy AI"
                  text={`Alert at $${simulation.target.toFixed(2)} for ${selected.name}: ${ALERT_VERDICT_LABELS[simulation.verdict]} — SmartBuy AI`}
                />
              </div>
              {/* Section 16, #33 — one-click bridge from the
                  simulation to a REAL alert (same product + target,
                  via POST /api/v1/alerts). The simulation itself
                  still creates nothing; only this button does. */}
              <div className="mt-4 border-t pt-4">
                <SimulatorToAlertButton
                  productId={selected.id}
                  productName={selected.name}
                  targetPrice={simulation.target}
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
              Tip: pick any product, enter the price you would buy at,
              and see what the recorded history says about it.
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
