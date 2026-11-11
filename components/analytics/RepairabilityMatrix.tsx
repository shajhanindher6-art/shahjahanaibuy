import { Wrench } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  computeRepairabilityIndex,
  type RepairabilityData,
} from '@/services/repairability';
import { cn } from '@/lib/utils';

/**
 * Repairability Matrix (Option 16, Step 3).
 *
 * Parts availability + local repair risk from the product's RECORDED
 * repairability data (migration 019). No recorded data → honest
 * "Not recorded yet" state, never a fake score. Score below 40 or a
 * High local repair risk shows the red "Not Recommended for
 * Long-Term Use" badge.
 *
 * Server-safe: pure render, no client state.
 */

export function RepairabilityMatrix({
  repairability,
  title,
}: {
  repairability: RepairabilityData | null | undefined;
  title?: string;
}) {
  const data: RepairabilityData = repairability ?? {
    repairabilityScore: null,
    sparePartsYears: null,
    localRepairRiskLevel: null,
  };
  const result = computeRepairabilityIndex(data);
  const hasAnything = result.hasScore || result.hasPartsYears || result.hasRisk;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-5 w-5 text-muted-foreground" />
          Repairability{title ? ` — ${title}` : ''}
        </CardTitle>
        <CardDescription>
          Spare-parts availability &amp; local repair risk (recorded data only)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasAnything || result.verdict === 'unknown' ? (
          <p className="text-sm text-muted-foreground">
            Repairability not recorded for this product yet — no score, parts
            or repair-risk data has been added. Nothing here is estimated.
          </p>
        ) : (
          <>
            {result.index !== null && (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold">{result.index}/100</span>
                  <Badge
                    className={cn(
                      'text-white',
                      result.verdict === 'excellent' && 'bg-emerald-600',
                      result.verdict === 'good' && 'bg-blue-600',
                      result.verdict === 'not-recommended' && 'bg-red-600'
                    )}
                  >
                    {result.verdict === 'excellent'
                      ? 'Excellent'
                      : result.verdict === 'good'
                        ? 'Good'
                        : 'Not Recommended for Long-Term Use'}
                  </Badge>
                </div>
                <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      result.verdict === 'excellent' && 'bg-emerald-500',
                      result.verdict === 'good' && 'bg-blue-500',
                      result.verdict === 'not-recommended' && 'bg-red-500'
                    )}
                    style={{ width: `${result.index}%` }}
                  />
                </div>
              </div>
            )}
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Repairability score</dt>
                <dd className="font-medium">
                  {data.repairabilityScore !== null
                    ? `${data.repairabilityScore} / 10`
                    : 'Not recorded'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Spare parts availability</dt>
                <dd className="font-medium">
                  {result.availabilityLabel}
                  {data.sparePartsYears !== null ? ` (${data.sparePartsYears} years)` : ''}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Local repair risk</dt>
                <dd className="font-medium">
                  {data.localRepairRiskLevel ?? 'Not recorded'}
                </dd>
              </div>
            </dl>
            {!result.hasPartsYears && (
              <p className="text-xs text-muted-foreground">
                Spare-parts years not recorded — the index counts 0 for parts.
              </p>
            )}
            {result.verdict === 'not-recommended' && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                Not Recommended for Long-Term Use —{' '}
                {result.index !== null && result.index < 40
                  ? `repairability index ${result.index} is below 40`
                  : 'local repair risk is High'}
                .
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
