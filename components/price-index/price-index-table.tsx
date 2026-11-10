/**
 * Price Index table — presentational rendering of the monthly
 * SmartBuy Price Index (see lib/price-index.ts).
 *
 * Every value carries its depth: "based on N recorded prices from
 * M products". Months with too few products render as
 * "Insufficient data" — never an estimated number. The base month
 * is 100 by construction; the latest month-over-month change is
 * shown per group with an up / down / flat label.
 */

'use client';

import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { indexDepthLabel, type PriceIndexEntry, type PriceIndexGroupSummary } from '@/lib/price-index';
import { cn } from '@/lib/utils';

export interface PriceIndexTableProps {
  entries: PriceIndexEntry[];
  summaries: PriceIndexGroupSummary[];
  baseMonth: string | null;
  historyDays: number;
  className?: string;
}

export function PriceIndexTable({
  entries,
  summaries,
  baseMonth,
  historyDays,
  className,
}: PriceIndexTableProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No index data yet"
        description="There are not enough recorded prices yet to publish a monthly index. The index appears once at least 2 products have recorded prices in a month."
        className={className}
      />
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {summaries.map((s) => (
          <Card key={`${s.category}|${s.region}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {s.category}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {s.region === 'GLOBAL' ? 'All regions' : s.region}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {s.latestValue === null ? (
                <p className="text-sm text-muted-foreground">
                  Insufficient data — not enough recorded prices yet.
                </p>
              ) : (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold">{s.latestValue.toFixed(1)}</span>
                    <span className="text-sm text-muted-foreground">
                      {s.latestMonth} (base {s.baseMonth} = 100)
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm">
                    {s.direction === 'down' ? (
                      <TrendingDown className="h-4 w-4 text-green-600" />
                    ) : s.direction === 'up' ? (
                      <TrendingUp className="h-4 w-4 text-red-600" />
                    ) : (
                      <Minus className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span>
                      {s.latestChangePct === null
                        ? 'No previous month to compare'
                        : `${s.latestChangePct > 0 ? '+' : ''}${s.latestChangePct.toFixed(1)}% vs previous month`}
                    </span>
                    <Badge variant="outline">
                      {s.direction === 'unknown' ? 'No change data' : s.direction}
                    </Badge>
                  </div>
                </>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {indexDepthLabel({ productsUsed: s.productsUsed, pointsUsed: s.pointsUsed })}
                {historyDays > 0 ? ` · ${historyDays} days of history` : ''}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">Region</th>
              <th className="px-4 py-2 font-medium">Month</th>
              <th className="px-4 py-2 font-medium">Index</th>
              <th className="px-4 py-2 font-medium">Depth</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={`${e.category}|${e.region}|${e.periodMonth}`}
                className="border-b last:border-0"
              >
                <td className="px-4 py-2">{e.category}</td>
                <td className="px-4 py-2">{e.region === 'GLOBAL' ? 'All regions' : e.region}</td>
                <td className="px-4 py-2">{e.periodMonth}</td>
                <td className="px-4 py-2 font-medium">
                  {e.indexValue === null ? '—' : e.indexValue.toFixed(1)}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {indexDepthLabel(e)}
                </td>
                <td className="px-4 py-2">
                  {e.status === 'ok' ? (
                    <Badge variant="outline" className="border-green-600 text-green-700">
                      Published
                    </Badge>
                  ) : (
                    <Badge variant="outline">Insufficient data</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {baseMonth && (
        <p className="text-xs text-muted-foreground">
          Base month {baseMonth} = 100. The index is the mean of per-product price
          ratios vs the base month — never a mean of raw prices.
        </p>
      )}
    </div>
  );
}
