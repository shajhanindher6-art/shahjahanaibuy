/**
 * SmartBuy Price Index — public page.
 *
 * Monthly per-category / per-region index from RECORDED price
 * history only (base month = 100). Every value shows its depth
 * ("based on N recorded prices from M products"); months with too
 * few products show "Insufficient data", never an estimate.
 * Downloadable data: CSV / JSON via /api/v1/price-index/export.
 *
 * Client page: fetches GET /api/v1/price-index. A failed fetch
 * shows an honest empty state, never a fabricated index.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { PriceIndexTable } from '@/components/price-index/price-index-table';
import { CategoryInflation } from '@/components/category-inflation';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import type {
  PriceIndexEntry,
  PriceIndexGroupSummary,
} from '@/lib/price-index';

interface PriceIndexResponse {
  entries: PriceIndexEntry[];
  summaries: PriceIndexGroupSummary[];
  categories: string[];
  regions: string[];
  baseMonth: string | null;
  historyDays: number;
  pointsUsed: number;
  note: string;
}

export default function PriceIndexPage() {
  const [data, setData] = useState<PriceIndexResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [category, setCategory] = useState('');
  const [region, setRegion] = useState('GLOBAL');

  const load = useCallback(async (cat: string, reg: string) => {
    setLoading(true);
    setFailed(false);
    const params = new URLSearchParams();
    if (cat) params.set('category', cat);
    if (reg && reg !== 'GLOBAL') params.set('region', reg);
    try {
      const res = await fetch(`/api/v1/price-index?${params.toString()}`);
      const json: { success?: boolean; data?: PriceIndexResponse } | null =
        await res.json().catch(() => null);
      if (res.ok && json?.success && json.data) {
        setData(json.data);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(category, region);
  }, [category, region, load]);

  const exportParams = new URLSearchParams();
  if (category) exportParams.set('category', category);
  if (region && region !== 'GLOBAL') exportParams.set('region', region);
  const exportQuery = exportParams.toString();
  const csvHref = `/api/v1/price-index/export?format=csv${exportQuery ? `&${exportQuery}` : ''}`;
  const jsonHref = `/api/v1/price-index/export?format=json${exportQuery ? `&${exportQuery}` : ''}`;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="SmartBuy Price Index"
        description="A monthly price index per category and region, computed only from recorded price history. The base month is 100."
        path="/price-index"
        crumbs={[ { name: "Home", path: "/" }, { name: "SmartBuy Price Index" } ]}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <h1 className="text-3xl font-bold">SmartBuy Price Index</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          A monthly price index per category and region, computed only from
          recorded price history. The base month is 100 — an index of 95
          means tracked products in that category cost 5% less on average
          than in the base month. Seed prices are demo prices, not live
          retailer prices, and this index never treats them as live.
        </p>

        <div className="mt-6 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border bg-background px-3 py-2"
            >
              <option value="">All categories</option>
              {(data?.categories ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Region
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="rounded-md border bg-background px-3 py-2"
            >
              {(data?.regions ?? ['GLOBAL']).map((r) => (
                <option key={r} value={r}>
                  {r === 'GLOBAL' ? 'All regions' : r}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={csvHref}>
                <Download className="mr-1 h-4 w-4" /> Download CSV
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={jsonHref}>
                <Download className="mr-1 h-4 w-4" /> Download JSON
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-8">
          {loading ? (
            <LoadingSpinner />
          ) : failed || !data ? (
            <EmptyState
              title="Price Index unavailable right now"
              description="The index could not be loaded. Please try again later — no figures are shown rather than estimated ones."
            />
          ) : (
            <>
              {data.historyDays > 0 && data.historyDays < 90 && (
                <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  Only {data.historyDays} days of price history are recorded so
                  far ({data.pointsUsed} recorded prices). Monthly index values
                  need at least 2 products with recorded prices in a month, so
                  early months may read “Insufficient data” until history
                  accrues.
                </p>
              )}
              <PriceIndexTable
                entries={data.entries}
                summaries={data.summaries}
                baseMonth={data.baseMonth}
                historyDays={data.historyDays}
              />
              <p className="mt-4 text-xs text-muted-foreground">{data.note}</p>
            </>
          )}
        </div>

        {/* Section 15, C5 — the Category Inflation Index was orphaned
            (zero importers). It self-fetches live
            /api/v1/category-inflation and renders its own loading /
            empty states, so it sits below the index table and is
            always shown, even when the index table above fails. */}
        <CategoryInflation className="mt-8" />
      </main>
      <SiteFooter />
    </div>
  );
}
