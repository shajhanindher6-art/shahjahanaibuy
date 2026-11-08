/**
 * Deal Hotspots Calendar — self-fetching client component.
 *
 * A month grid of RECORDED price-drop and deal-start events from
 * GET /api/v1/deal-hotspots. Each day cell shows how many drops
 * (and deal starts) were recorded on that date. There is no
 * probability, no "high-probability window", and no seasonal
 * forecast anywhere: the recorded history covers roughly 30 days,
 * so the coverage note under the grid says so plainly on every
 * render. Days with no events are plain cells, never zero-filled
 * claims.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';
import type { HotspotMonth } from '@/services/deal-hotspots';

interface HotspotsResponse {
  months: HotspotMonth[];
  totalDrops: number;
  totalDeals: number;
  historyDays: number;
  coverageNote: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export function DealHotspotsCalendar({ className }: { className?: string }) {
  const [data, setData] = useState<HotspotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/v1/deal-hotspots', {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error('deal-hotspots request failed');
        const json = await res.json();
        if (!cancelled) setData((json?.data ?? null) as HotspotsResponse | null);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(() => {
    if (!data || data.months.length === 0) return null;
    if (selectedKey) {
      const found = data.months.find((m) => `${m.year}-${m.month}` === selectedKey);
      if (found) return found;
    }
    return data.months[0];
  }, [data, selectedKey]);

  // Calendar cells for the selected month: leading blanks so day 1
  // lands under the right weekday, then one cell per calendar day.
  const cells = useMemo(() => {
    if (!selected) return [];
    const daysInMonth = new Date(selected.year, selected.month + 1, 0).getDate();
    const firstWeekday = new Date(selected.year, selected.month, 1).getDay();
    const byDate = new Map(selected.days.map((d) => [d.date, d]));
    const out: Array<{ date: string; day: number; drops: number; deals: number } | null> = [];
    for (let i = 0; i < firstWeekday; i++) out.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${selected.year}-${String(selected.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const found = byDate.get(date);
      out.push({ date, day, drops: found?.drops ?? 0, deals: found?.deals ?? 0 });
    }
    return out;
  }, [selected]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Deal Hotspots Calendar</CardTitle>
        <CardDescription>
          Recorded price drops and deal starts, by day. What was recorded — nothing
          predicted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <LoadingSpinner size="lg" />
          </div>
        ) : failed || !data ? (
          <p className="text-sm text-muted-foreground">
            Deal hotspot data is unavailable right now. Please try again later.
          </p>
        ) : data.months.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No price drops or deal starts recorded yet.
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              {data.months.map((m) => {
                const key = `${m.year}-${m.month}`;
                const active = selected && `${selected.year}-${selected.month}` === key;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedKey(key)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    )}
                  >
                    {monthLabel(m.year, m.month)}
                  </button>
                );
              })}
            </div>

            {selected && (
              <>
                <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
                  {WEEKDAYS.map((d) => (
                    <div key={d} className="py-1">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {cells.map((cell, i) =>
                    cell === null ? (
                      <div key={`blank-${i}`} />
                    ) : (
                      <div
                        key={cell.date}
                        title={
                          cell.drops === 0 && cell.deals === 0
                            ? `${cell.date}: no recorded drops or deal starts`
                            : `${cell.date}: ${cell.drops} price drop${cell.drops === 1 ? '' : 's'}, ${cell.deals} deal start${cell.deals === 1 ? '' : 's'}`
                        }
                        className={cn(
                          'flex min-h-12 flex-col items-center justify-center rounded-md border px-1 py-1.5 text-center',
                          cell.drops > 0
                            ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-900/30'
                            : 'border-slate-200 dark:border-slate-800'
                        )}
                      >
                        <span className="text-xs font-medium">{cell.day}</span>
                        {cell.drops > 0 && (
                          <span className="text-[11px] font-semibold text-green-700 dark:text-green-300">
                            −{cell.drops} drop{cell.drops === 1 ? '' : 's'}
                          </span>
                        )}
                        {cell.deals > 0 && (
                          <span className="text-[11px] text-blue-700 dark:text-blue-300">
                            {cell.deals} deal{cell.deals === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                    )
                  )}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {selected.totalDrops} price drop{selected.totalDrops === 1 ? '' : 's'} and{' '}
                  {selected.totalDeals} deal start{selected.totalDeals === 1 ? '' : 's'} recorded
                  in {monthLabel(selected.year, selected.month)}.
                </p>
              </>
            )}
          </>
        )}
        {!loading && data && (
          <p className="mt-4 text-xs text-muted-foreground">{data.coverageNote}</p>
        )}
      </CardContent>
    </Card>
  );
}
