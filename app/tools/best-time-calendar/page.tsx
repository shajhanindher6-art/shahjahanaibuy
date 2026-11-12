/**
 * AI Best-Time-to-Buy Calendar — /tools/best-time (Section 7 item 7).
 *
 * Category-wise best-buy months from RECORDED price history only.
 * Ranges only — never an exact date promise, never a future price.
 * Seasonal labels are generic month markers, not sale dates.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

interface BestMonth {
  month: number;
  monthName: string;
  lowestPrice: number;
  averagePrice: number;
  pointCount: number;
  savingVsCategoryAvgPct: number;
  seasonalLabels: string[];
}

interface CategoryCalendar {
  category: string;
  status: 'ready' | 'insufficient';
  bestMonths: BestMonth[];
  bestWindow: string | null;
  monthsCovered: number;
  pointCount: number;
  lowestPrice: number | null;
  reason: string;
}

export default function BestTimePage() {
  const { language } = useRegion();
  const [categories, setCategories] = useState<CategoryCalendar[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/v1/tools/best-time');
        if (!res.ok) throw new Error('load failed');
        const data = await res.json();
        if (!cancelled) {
          setCategories((data?.data?.categories ?? []) as CategoryCalendar[]);
          setNote(data?.data?.note ?? null);
        }
      } catch {
        if (!cancelled) setError('Could not load the calendar. Please try again.');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <CalendarDays className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingBestTime')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            For each category, the months when recorded prices were
            lowest. This comes from real recorded price history only —
            ranges, not exact dates, and no future price is promised.
            Best months are computed with deterministic rules from
            recorded price history — no LLM, nothing guessed.
          </p>

          {error ? (
            <p role="alert" className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {error}
            </p>
          ) : categories === null ? (
            <p className="mt-8 text-muted-foreground">Loading the calendar…</p>
          ) : categories.length === 0 ? (
            <div className="mt-8 rounded-lg border p-6">
              <p className="font-medium">No recorded price history yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The calendar appears once products have recorded price
                history across at least two months. Nothing is guessed
                in the meantime.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-4">
              {categories.map((cat) => (
                <article key={cat.category} className="rounded-lg border p-6">
                  <h2 className="text-xl font-semibold">{cat.category}</h2>
                  {cat.status === 'insufficient' ? (
                    <p className="mt-2 text-sm text-muted-foreground">{cat.reason}</p>
                  ) : (
                    <>
                      <p className="mt-2">
                        <span className="font-medium">Best window: {cat.bestWindow}</span>
                        {cat.lowestPrice !== null ? (
                          <span className="text-muted-foreground">
                            {' '}— lowest recorded price ${cat.lowestPrice.toFixed(2)}
                          </span>
                        ) : null}
                      </p>
                      <ul className="mt-3 space-y-2">
                        {cat.bestMonths.map((m) => (
                          <li key={m.month} className="text-sm">
                            <span className="font-medium">{m.monthName}</span>
                            {' — '}lowest ${m.lowestPrice.toFixed(2)}
                            {m.savingVsCategoryAvgPct > 0
                              ? ` (${m.savingVsCategoryAvgPct}% below the category average)`
                              : ''}
                            {` · ${m.pointCount} recorded point${m.pointCount === 1 ? '' : 's'}`}
                            {m.seasonalLabels.length > 0 ? (
                              <span className="text-muted-foreground">
                                {' · '}{m.seasonalLabels.join(', ')} (month marker only — not a promised sale date)
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-xs text-muted-foreground">{cat.reason}</p>
                    </>
                  )}
                </article>
              ))}
            </div>
          )}

          {note ? <p className="mt-8 text-sm text-muted-foreground">{note}</p> : null}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
