/**
 * Market reports — public page.
 *
 * Weekly deal report, monthly category deep-dives, and a seasonal
 * buying guide, all generated from RECORDED price data:
 * - Weekly drops: real point-to-point drops from each product's
 *   recorded price history (trailing 7 days), via
 *   lib/price-trend computePriceDrops.
 * - Deep-dives: the monthly Price Index (GET /api/v1/price-index).
 * - Seasonal guide: category recorded lows vs current recorded
 *   prices, from GET /api/v1/products/[slug]/prices.
 *
 * Nothing is shown that the loaded data cannot support: a failed
 * fetch shows an honest "unavailable" state, thin data is labelled
 * thin, and a "best time to buy" claim is never made on less than
 * 90 days of history (see lib/market-reports.ts). Editorial
 * guidelines are printed on the page.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { computePriceDrops, filterPointsByRange } from '@/lib/price-trend';
import type {
  PriceIndexEntry,
  PriceIndexGroupSummary,
} from '@/lib/price-index';
import {
  EDITORIAL_GUIDELINES,
  buildCategoryDeepDive,
  buildSeasonalGuide,
  buildWeeklyDealReport,
  dataQualityLabel,
  type MarketReport,
  type RecordedDrop,
  type ReportDepth,
} from '@/lib/market-reports';

interface PriceIndexResponse {
  entries: PriceIndexEntry[];
  summaries: PriceIndexGroupSummary[];
  historyDays: number;
  pointsUsed: number;
}

interface ProductRow {
  id: string;
  name: string;
  slug: string;
  category: string | null;
}

interface PricesResponse {
  history: Array<{ price: number; recordedAt: string }>;
  lowestPrice: number | null;
  currentPrice: number | null;
}

function weekLabel(now: Date): string {
  const d = new Date(now);
  const day = d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return `Week of ${monday.toISOString().slice(0, 10)}`;
}

function seasonLabel(now: Date): string {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  if (month <= 1 || month === 11) return `Winter ${year}`;
  if (month <= 4) return `Spring ${year}`;
  if (month <= 7) return `Summer ${year}`;
  return `Autumn ${year}`;
}

function ReportCard({ report }: { report: MarketReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{report.title}</CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{dataQualityLabel(report.dataQuality)}</Badge>
          <span>
            Based on {report.depth.points} recorded prices from{' '}
            {report.depth.products} products · {report.depth.historyDays} days of
            history
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="font-medium">{report.summary}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {report.findings.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{report.methodology}</p>
      </CardContent>
    </Card>
  );
}

export default function MarketReportsPage() {
  const [indexData, setIndexData] = useState<PriceIndexResponse | null>(null);
  const [indexFailed, setIndexFailed] = useState(false);
  const [weeklyReport, setWeeklyReport] = useState<MarketReport | null>(null);
  const [weeklyFailed, setWeeklyFailed] = useState(false);
  const [seasonalReport, setSeasonalReport] = useState<MarketReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const nowMs = now.getTime();

    async function loadIndex() {
      try {
        const res = await fetch('/api/v1/price-index');
        const json: { success?: boolean; data?: PriceIndexResponse } | null =
          await res.json().catch(() => null);
        if (!cancelled && res.ok && json?.success && json.data) {
          setIndexData(json.data);
        } else if (!cancelled) {
          setIndexFailed(true);
        }
      } catch {
        if (!cancelled) setIndexFailed(true);
      }
    }

    async function loadWeeklyAndSeasonal() {
      try {
        const listRes = await fetch('/api/v1/products?pageSize=100');
        const listJson: { success?: boolean; data?: ProductRow[] } | null =
          await listRes.json().catch(() => null);
        if (!listRes.ok || !listJson?.success || !Array.isArray(listJson.data)) {
          throw new Error('products list failed');
        }
        const products = listJson.data;
        const drops: RecordedDrop[] = [];
        const categoryLows = new Map<
          string,
          { lowest: number; currents: number[]; products: number }
        >();
        let totalPoints = 0;
        let earliestMs: number | null = null;
        let latestMs: number | null = null;
        let productsWithHistory = 0;

        await Promise.all(
          products.map(async (p) => {
            try {
              const res = await fetch(
                `/api/v1/products/${encodeURIComponent(p.slug)}/prices?limit=100`
              );
              const json: { success?: boolean; data?: PricesResponse } | null =
                await res.json().catch(() => null);
              if (!res.ok || !json?.success || !json.data) return;
              const history = (json.data.history ?? [])
                .filter(
                  (h) =>
                    Number.isFinite(h.price) &&
                    h.price > 0 &&
                    h.recordedAt &&
                    Number.isFinite(new Date(h.recordedAt).getTime())
                )
                .sort(
                  (a, b) =>
                    new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
                );
              if (history.length === 0) return;
              productsWithHistory += 1;
              totalPoints += history.length;
              const firstMs = new Date(history[0].recordedAt).getTime();
              const lastMs = new Date(history[history.length - 1].recordedAt).getTime();
              earliestMs = earliestMs === null ? firstMs : Math.min(earliestMs, firstMs);
              latestMs = latestMs === null ? lastMs : Math.max(latestMs, lastMs);
              const weekPoints = filterPointsByRange(history, 7, nowMs);
              for (const d of computePriceDrops(weekPoints)) {
                drops.push({
                  productName: p.name,
                  category: p.category,
                  dropPct: d.dropPercent,
                  oldPrice: d.oldPrice,
                  newPrice: d.newPrice,
                  date: d.date,
                });
              }
              if (p.category && json.data.lowestPrice !== null && json.data.currentPrice !== null) {
                const acc = categoryLows.get(p.category) ?? {
                  lowest: Number.POSITIVE_INFINITY,
                  currents: [],
                  products: 0,
                };
                acc.lowest = Math.min(acc.lowest, json.data.lowestPrice);
                acc.currents.push(json.data.currentPrice);
                acc.products += 1;
                categoryLows.set(p.category, acc);
              }
            } catch {
              // One product's history failing must not sink the report.
            }
          })
        );

        if (cancelled) return;
        const historyDays =
          earliestMs !== null && latestMs !== null
            ? Math.max(0, Math.ceil((latestMs - earliestMs) / (24 * 60 * 60 * 1000)))
            : 0;
        const depth: ReportDepth = {
          products: productsWithHistory,
          points: totalPoints,
          historyDays,
        };
        setWeeklyReport(
          buildWeeklyDealReport({ drops, weekLabel: weekLabel(now), depth })
        );
        setSeasonalReport(
          buildSeasonalGuide({
            seasonLabel: seasonLabel(now),
            categoryLows: [...categoryLows.entries()]
              .map(([category, acc]) => ({
                category,
                lowest: acc.lowest,
                current:
                  acc.currents.reduce((s, v) => s + v, 0) / acc.currents.length,
                productsUsed: acc.products,
              }))
              .sort((a, b) => a.category.localeCompare(b.category)),
            depth,
          })
        );
      } catch {
        if (!cancelled) setWeeklyFailed(true);
      }
    }

    Promise.all([loadIndex(), loadWeeklyAndSeasonal()]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const deepDives = useMemo<MarketReport[]>(() => {
    if (!indexData) return [];
    return indexData.summaries
      .filter((s) => s.region === 'GLOBAL')
      .map((s) => {
        const latestEntry =
          indexData.entries
            .filter(
              (e) =>
                e.category === s.category &&
                e.region === 'GLOBAL' &&
                e.periodMonth === s.latestMonth
            )
            .at(0) ?? null;
        return buildCategoryDeepDive({
          category: s.category,
          periodMonth: s.latestMonth ?? s.baseMonth,
          indexValue: s.latestValue,
          baseMonth: s.baseMonth,
          changePct: s.latestChangePct,
          direction: s.direction,
          depth: {
            products: s.productsUsed,
            points: latestEntry?.pointsUsed ?? indexData.pointsUsed,
            historyDays: indexData.historyDays,
          },
        });
      });
  }, [indexData]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Market reports"
        description="Weekly deal reports, monthly category deep-dives, and seasonal buying guides — all computed from recorded price history only."
        path="/market-reports"
        crumbs={[ { name: "Home", path: "/" }, { name: "Market reports" } ]}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <h1 className="text-3xl font-bold">Market reports</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Weekly deal reports, monthly category deep-dives, and seasonal
          buying guides — all computed from recorded price history only.
          Where the data is thin, the report says so instead of drawing a
          conclusion.
        </p>

        {loading ? (
          <div className="mt-8">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            <section>
              <h2 className="mb-4 text-2xl font-semibold">Weekly deal report</h2>
              {weeklyFailed || !weeklyReport ? (
                <EmptyState
                  title="Weekly report unavailable right now"
                  description="The recorded price drops for this week could not be loaded. Please try again later — no figures are shown rather than estimated ones."
                />
              ) : (
                <ReportCard report={weeklyReport} />
              )}
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold">Monthly category deep-dives</h2>
              {indexFailed || !indexData ? (
                <EmptyState
                  title="Deep-dives unavailable right now"
                  description="The Price Index data behind these deep-dives could not be loaded. Please try again later."
                />
              ) : deepDives.length === 0 ? (
                <EmptyState
                  title="No deep-dives yet"
                  description="There are not enough recorded prices yet for a monthly category index. Deep-dives appear once at least 2 products have recorded prices in a month."
                />
              ) : (
                <div className="space-y-4">
                  {deepDives.map((r) => (
                    <ReportCard key={r.slug} report={r} />
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold">Seasonal buying guide</h2>
              {weeklyFailed || !seasonalReport ? (
                <EmptyState
                  title="Seasonal guide unavailable right now"
                  description="The recorded prices behind this guide could not be loaded. Please try again later."
                />
              ) : (
                <ReportCard report={seasonalReport} />
              )}
            </section>

            <section>
              <h2 className="mb-4 text-2xl font-semibold">Editorial guidelines</h2>
              <Card>
                <CardContent className="pt-6">
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {EDITORIAL_GUIDELINES.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
