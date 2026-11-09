'use client';

import { Globe, ShieldCheck, CalendarClock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  availabilitySummary,
  nextGenSignal,
  warrantyLabel,
  type GlobalReadinessData,
} from '@/services/global-readiness';

/**
 * Global Readiness Card (Option 20).
 *
 * Shows RECORDED readiness signals only:
 *  - regional availability — the recorded per-region map, never a
 *    hardcoded region set and never a claim about a region the owner
 *    has not recorded;
 *  - warranty scope — the recorded label, never an assumed type
 *    (warranty is manufacturer-dependent; a missing value stays
 *    "Not recorded");
 *  - next-generation signal — from the RECORDED release schedule
 *    only, labeled as such; <= 3 months suggests considering a wait.
 *    No schedule recorded → "No release schedule recorded", never a
 *    forecast.
 *
 * No recorded data → honest "Not recorded yet" state, never a
 * fabricated availability, warranty or release date. FX, landed
 * cost and Buy vs Wait live elsewhere and are not duplicated here.
 */
export function GlobalReadinessCard({
  globalReadiness,
  title,
}: {
  globalReadiness: GlobalReadinessData | null | undefined;
  title?: string;
}) {
  const data: GlobalReadinessData = globalReadiness ?? {
    regionalAvailability: null,
    nextGenReleaseMonths: null,
    globalWarrantyType: null,
  };
  const availability = availabilitySummary(data.regionalAvailability);
  const signal = nextGenSignal(data.nextGenReleaseMonths);
  const warranty = warrantyLabel(data.globalWarrantyType);
  const recorded =
    availability.status !== 'not_recorded' ||
    signal.status !== 'unknown' ||
    warranty !== 'Not recorded';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-5 w-5 text-slate-500" />
          Global Readiness{title ? ` — ${title}` : ''}
        </CardTitle>
        <CardDescription>
          Recorded regional availability, warranty scope &amp; release
          schedule (recorded data only)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!recorded ? (
          <p className="text-sm text-muted-foreground">
            Global readiness not recorded for this product yet. No region,
            warranty type or release schedule is assumed.
          </p>
        ) : (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <Globe className="h-4 w-4" /> Regional availability
              </dt>
              <dd className="text-right font-medium">
                {availability.label}
                {availability.availableRegions.length > 0 && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {availability.availableRegions.join(', ')}
                    {availability.unavailableRegions.length > 0 &&
                      ` · not recorded as available in ${availability.unavailableRegions.join(', ')}`}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <ShieldCheck className="h-4 w-4" /> Warranty scope
              </dt>
              <dd className="font-medium">{warranty}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <CalendarClock className="h-4 w-4" /> Next generation
              </dt>
              <dd className="text-right font-medium">{signal.label}</dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
