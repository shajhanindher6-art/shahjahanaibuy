/**
 * Forecast Explainer + Backtest Accuracy — /tools/forecast-explainer
 * (Section 13).
 *
 * The forecast engine (lib/forecast.ts OLS, walk-forward backtest,
 * lib/prediction-accuracy.ts) exists, but no page ever showed
 * backtest accuracy numbers or explained ranges in plain language —
 * the product page shows only a badge. This page does both, per
 * product and per horizon (7 / 30 / 90 days).
 *
 * Honesty: with 4 recorded points per product over ~30 days,
 * backtests are thin — a 30-day backtest has 0 trials, and the
 * page shows "n trials" for every horizon instead of promising
 * accuracy. The recorded-outcomes accuracy % stays unpublished
 * until 20 outcomes resolve (lib/prediction-accuracy.ts gate).
 * Ranges are probabilistic fits to recorded prices, never a
 * promised price or date.
 */

import { cookies } from 'next/headers';
import { isSupportedLanguage, type Language } from '@/lib/region';
import { tFor } from '@/lib/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { TrendingUp } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { ShareButtons } from '@/components/products/share-buttons';
import { SaveCalculationButton } from '@/components/tools/save-calculation-button';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { getPriceHistory } from '@/services/price-history';
import {
  backtestForecast,
  computeForecast,
  FORECAST_HORIZONS,
  formatForecastBasis,
} from '@/lib/forecast';
import { getFreshnessStatus } from '@/lib/price-freshness';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import {
  accuracySummaryLine,
  summarizeAccuracy,
  type AccuracyOutcomeRow,
} from '@/lib/prediction-accuracy';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Forecast Explainer — SmartBuy AI',
  description:
    'What a price forecast range really means, in plain language — and how often past forecasts were right, with the trial count shown honestly.',
  alternates: {
    canonical: `${appConfig.url}/tools/forecast-explainer`,
  },
  openGraph: {
    title: 'Forecast Explainer — SmartBuy AI',
    description:
      'What a price forecast range really means, in plain language — and how often past forecasts were right, with the trial count shown honestly.',
    url: `${appConfig.url}/tools/forecast-explainer`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Forecast Explainer — SmartBuy AI',
    description:
      'What a price forecast range really means, in plain language — and how often past forecasts were right, with the trial count shown honestly.',
  },
};

function explainRange(
  direction: 'down' | 'up' | 'flat',
  horizonDays: number,
  central: number,
  low: number,
  high: number,
  confidencePct: number
): string {
  const trend =
    direction === 'down'
      ? 'the recent trend points down'
      : direction === 'up'
        ? 'the recent trend points up'
        : 'the recent trend is flat';
  return (
    `In ${horizonDays} days the price is most likely around $${central.toFixed(2)} ` +
    `(${trend}), but the honest range is $${low.toFixed(2)}–$${high.toFixed(2)}. ` +
    `That range is a fit to recorded prices, not a promise — the fit ` +
    `itself is rated ${confidencePct}% confident, and the range may miss.`
  );
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

interface ForecastExplainerProps {
  searchParams: { product?: string | string[] };
}

export default async function ForecastExplainerPage({ searchParams }: ForecastExplainerProps) {
  const language = toolLanguage();
  const supabase = await createSupabaseServerClient();
  const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });

  const items = await Promise.all(
    products.map(async (product) => {
      const result = await getPriceHistory(supabase, product.id, { limit: 500 });
      const points = (result.history ?? []).map((h) => ({
        price: Number(h.price),
        recordedAt: h.recordedAt,
      }));
      const forecast = computeForecast(points, Date.now(), FORECAST_HORIZONS, {
        // Section 21, Stage E (E-P1-1) — the product's real last
        // check is the freshness input; stale inputs withhold the
        // forecast instead of presenting it as current.
        lastCheckedAt: product.dataFreshness ?? null,
      });
      return {
        product,
        pointCount: points.length,
        forecast,
        backtests: FORECAST_HORIZONS.map((h) =>
          backtestForecast(points, h, Date.now(), {
            lastCheckedAt: product.dataFreshness ?? null,
          })
        ),
      };
    })
  );

  // Recorded prediction outcomes (the dashboard accuracy %).
  // A missing table or query failure means "no recorded outcomes
  // yet" — never a fabricated percentage.
  let outcomeSummary = summarizeAccuracy([]);
  try {
    const { data } = await supabase
      .from('prediction_outcomes')
      .select('status, horizon_days')
      .limit(500);
    if (data) {
      outcomeSummary = summarizeAccuracy(
        (data as Array<{ status: string; horizon_days: number }>).map((row) => ({
          status: row.status as AccuracyOutcomeRow['status'],
          horizonDays: row.horizon_days,
        }))
      );
    }
  } catch {
    outcomeSummary = summarizeAccuracy([]);
  }

  // Section 16, #36: a saved calculation re-opens as
  // /tools/forecast-explainer?product=<slug> — the page replays
  // that product's forecast alone. An unknown slug is an honest
  // "no forecast for that product" line, never a silent full list.
  const rawProduct = Array.isArray(searchParams?.product)
    ? searchParams.product[0]
    : searchParams?.product;
  const requestedSlug = (rawProduct ?? '').trim();
  const visibleItems = requestedSlug
    ? items.filter((i) => i.product.slug === requestedSlug)
    : items;
  const unknownProduct = requestedSlug !== '' && visibleItems.length === 0;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: WebPage + BreadcrumbList
          (Home → AI tools → this tool). */}
      <PageJsonLd
        name="Forecast Explainer"
        description="What a price forecast range really means, in plain language — and how often past forecasts were right, with the trial count shown honestly."
        path="/tools/forecast-explainer"
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'AI tools', path: '/tools' },
          { name: 'Forecast Explainer' },
        ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <TrendingUp className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingForecastExplainer')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            A price forecast is a range, not a promise. SmartBuy fits a
            straight-line trend to the recorded price history and
            reports a range around it — the wider the range, the less
            certain the fit. Below, every product&apos;s forecast is
            explained in plain language, and every horizon shows how
            its past forecasts actually did.
          </p>

          <section className="mt-8 rounded-lg border p-6" aria-label="How forecasts work">
            <h2 className="text-lg font-semibold">How to read a forecast</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">The range, not the centre:</strong>{' '}
                the centre is the trend line&apos;s best guess; the
                low–high range is where the price is expected to land.
                A price outside the range means the forecast missed.
              </li>
              <li>
                <strong className="text-foreground">Confidence is about the fit:</strong>{' '}
                it rates how well the trend fits recorded prices (never
                above 90%). It is not a guarantee the future follows
                the trend.
              </li>
              <li>
                <strong className="text-foreground">Backtests are the check:</strong>{' '}
                each past forecast is compared with the price actually
                recorded at its horizon date. The trial count (n) is
                shown because a percentage from 1 trial means nothing.
              </li>
            </ul>
          </section>

          <section className="mt-8 rounded-lg border p-6" aria-label="Recorded prediction accuracy">
            <h2 className="text-lg font-semibold">Recorded prediction accuracy</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {accuracySummaryLine(outcomeSummary)}
            </p>
            {outcomeSummary.hasEnoughHistory && (
              <p className="mt-2 text-2xl font-bold">
                {outcomeSummary.accuracyPercent}% correct
              </p>
            )}
            {!outcomeSummary.hasEnoughHistory && (
              <p className="mt-2 text-sm text-muted-foreground">
                An accuracy percentage is published only after 20
                predictions have resolved — until then, showing one
                would pretend a handful of outcomes is a track record.
              </p>
            )}
          </section>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Share this page:
            </span>
            <ShareButtons
              title="Forecast Explainer — SmartBuy AI"
              text="What a price forecast range really means, and how often past forecasts were right. — SmartBuy AI"
            />
          </div>

          {requestedSlug !== '' && visibleItems.length > 0 && (
            <p className="mt-6 text-sm text-muted-foreground">
              Showing the forecast for{' '}
              <strong className="text-foreground">{visibleItems[0].product.name}</strong>{' '}
              (from a saved calculation) —{' '}
              <Link href="/tools/forecast-explainer" className="underline underline-offset-4">
                view all forecasts
              </Link>
              .
            </p>
          )}

          {unknownProduct && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No forecast for that product"
                title={`No forecast found for “${requestedSlug}”`}
                description="The product may have been removed, or the link is stale — the full forecast list is one click away."
                action={
                  <Link
                    href="/tools/forecast-explainer"
                    className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    View all forecasts →
                  </Link>
                }
              />
            </div>
          )}

          {!unknownProduct && visibleItems.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No products yet"
                title="No products to forecast"
                description="The catalog is empty right now, so there is no recorded price history to forecast from."
              />
            </div>
          )}

          {!unknownProduct && visibleItems.length > 0 && (
            <div className="mt-6 space-y-4">
              {visibleItems.map(({ product, pointCount, forecast, backtests }) => (
                <article key={product.id} className="rounded-lg border p-6">
                  <h2 className="text-lg font-semibold">
                    <Link
                      href={`/products/${product.slug}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {product.name}
                    </Link>
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {product.brand ?? 'Unknown brand'}
                    {product.category ? ` · ${product.category}` : ''}
                    {` · ${pointCount} recorded point${pointCount === 1 ? '' : 's'}`}
                    {forecast.currentPrice !== null
                      ? (() => {
                          // Section 20, §12 #84 — "now $X" claimed
                          // the price was current. It is the last
                          // RECORDED price; stale ones say so.
                          const freshness = getFreshnessStatus(
                            product.dataFreshness
                          );
                          if (freshness.status === 'stale') {
                            return ` · last recorded $${forecast.currentPrice!.toFixed(2)} (${freshness.ageDays} days ago — may be out of date)`;
                          }
                          if (freshness.status === 'unknown') {
                            return ` · last recorded $${forecast.currentPrice!.toFixed(2)} (check date unknown)`;
                          }
                          return ` · last recorded $${forecast.currentPrice!.toFixed(2)}`;
                        })()
                      : ''}
                  </p>

                  {forecast.status === 'not-enough-history' && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Not enough price history yet — at least 5 recorded
                      prices are needed before any forecast can be made.
                    </p>
                  )}

                  {forecast.status === 'ok' && (
                    <div className="mt-4 space-y-4">
                      {forecast.forecasts.map((f) => {
                        const backtest = backtests.find(
                          (b) => b.horizonDays === f.horizonDays
                        );
                        return (
                          <div key={f.horizonDays} className="rounded-md bg-muted p-4">
                            <p className="text-sm font-semibold">
                              {f.horizonDays}-day forecast: ${f.low.toFixed(2)}–$
                              {f.high.toFixed(2)} (centre ${f.central.toFixed(2)})
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {explainRange(
                                f.direction,
                                f.horizonDays,
                                f.central,
                                f.low,
                                f.high,
                                f.confidencePct
                              )}
                            </p>
                            {/* Section 16, item 11: the point count
                                and confidence band behind this range —
                                "based on 4 points, low confidence" —
                                so the visitor can see how thin the
                                history is. */}
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatForecastBasis(f.pointsUsed, f.confidencePct)}
                            </p>
                            <p className="mt-2 text-sm">
                              Backtest:{' '}
                              {backtest && backtest.trials > 0 ? (
                                <>
                                  {backtest.accuracyPct}% within range —{' '}
                                  {backtest.hits} of {backtest.trials} trial
                                  {backtest.trials === 1 ? '' : 's'} landed inside the
                                  range.
                                </>
                              ) : (
                                <>
                                  no trials yet — with only {pointCount} recorded
                                  points over ~30 days, no past forecast has a
                                  recorded price at its horizon date. No accuracy
                                  percentage is shown until trials exist.
                                </>
                              )}
                            </p>
                          </div>
                        );
                      })}
                      <p className="text-xs text-muted-foreground">{forecast.method}</p>
                    </div>
                  )}

                  {/* Section 16, #36 — save this product's
                      forecast to the account, or copy its shareable
                      link. The label quotes the 30-day range (the
                      middle horizon); the link re-opens this
                      product's forecast via ?product=<slug>. No
                      button when there is no forecast to save. */}
                  {forecast.status === 'ok' &&
                    (() => {
                      const f30 =
                        forecast.forecasts.find((f) => f.horizonDays === 30) ??
                        forecast.forecasts[0];
                      if (!f30) return null;
                      return (
                        <div className="mt-4">
                          <SaveCalculationButton
                            tool="forecast-explainer"
                            label={`${product.name} ${f30.horizonDays}-day forecast: $${f30.low.toFixed(2)}–$${f30.high.toFixed(2)}`.slice(0, 100)}
                            params={{ product: product.slug }}
                          />
                        </div>
                      );
                    })()}

                  <Link
                    href={`/products/${product.slug}`}
                    className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    View product →
                  </Link>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
