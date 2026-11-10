import Link from 'next/link';
import { Wrench } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { RepairabilityRow } from '@/lib/sustainability';

/**
 * Repairability database table (Section 5, item 18).
 *
 * Every catalog product with a RECORDED repairability score (Option
 * 16 data), ranked best index first. Index = min(100, score×8 +
 * spare-parts-years×2). Products without recorded data are not in
 * the table — the footer says how many are missing instead of
 * inventing scores for them.
 */
export function RepairabilityTable({
  rows,
  recordedCount,
  totalCount,
}: {
  rows: RepairabilityRow[];
  recordedCount: number;
  totalCount: number;
}) {
  const missingCount = totalCount - recordedCount;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-5 w-5 text-sky-600" /> Repairability database
        </CardTitle>
        <CardDescription>
          {recordedCount} of {totalCount} catalog products have a recorded repairability score.
          Scores come from recorded data only — nothing here is estimated.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repairability data has been recorded for any product yet. Scores appear here once
            real repairability data is recorded per product.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.productId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div>
                  <Link href={`/products/${row.slug}`} className="font-medium hover:underline">
                    {row.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {row.brand ?? 'Unknown brand'}
                    {row.category ? ` · ${row.category}` : ''} · Spare parts:{' '}
                    {row.index.availabilityLabel}
                    {!row.index.hasPartsYears ? ' (years not recorded)' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      row.index.verdict === 'excellent'
                        ? 'default'
                        : row.index.verdict === 'not-recommended'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    {row.index.index}/100 ·{' '}
                    {row.index.verdict === 'excellent'
                      ? 'Excellent'
                      : row.index.verdict === 'good'
                        ? 'Good'
                        : 'Not recommended'}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
        {missingCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {missingCount} product(s) have no recorded repairability data yet — they are listed
            nowhere here until real data is recorded.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Index = min(100, repairability score × 8 + spare-parts years × 2). Below 40, or High
          local repair risk, means &ldquo;Not recommended for long-term use&rdquo;.
        </p>
      </CardContent>
    </Card>
  );
}
