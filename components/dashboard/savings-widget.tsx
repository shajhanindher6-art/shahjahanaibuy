/**
 * Savings Widget — Section 6, item 15 (standalone, NOT mounted).
 *
 * Presentational only: the wave-2 integrator mounts this on the
 * dashboard and passes the derived values from GET /api/v1/savings
 * (totals, streak, and badge are all derived at read time from the
 * savings ledger — nothing here fetches or stores anything).
 *
 * Mount point (wave-2): app/dashboard/page.tsx — render inside the
 * dashboard grid, e.g. <SavingsWidget totalSaved={...}
 * eventCount={...} streakWeeks={...} badge={...} /> with the values
 * from /api/v1/savings. When eventCount is 0 it renders the honest
 * empty state "No savings recorded yet" — a saving appears only
 * after the user confirms a purchase, never automatically.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { formatUsd } from '@/lib/region';
import { PiggyBank, Flame, Award } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { saverBadgeLabel, type SaverBadge } from '@/lib/savings';

export interface SavingsWidgetProps {
  /** Total confirmed savings in USD (derived from the ledger). */
  totalSaved: number;
  /** Number of confirmed savings events. */
  eventCount: number;
  /** Consecutive weeks with at least one savings event (derived). */
  streakWeeks: number;
  /** Saver badge derived from the event count (none/bronze/silver/gold/platinum). */
  badge: SaverBadge;
}

export function SavingsWidget({ totalSaved, eventCount, streakWeeks, badge }: SavingsWidgetProps) {
  const { language } = useRegion();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PiggyBank className="h-5 w-5" aria-hidden="true" />
          Savings
        </CardTitle>
        <CardDescription>
          Savings from purchases you confirmed — compare-at price minus the recorded price.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {eventCount === 0 ? (
          <p className="text-sm text-muted-foreground">{tFor(language, 'dashNoSavings')}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-3xl font-bold">{formatUsd(totalSaved)}</p>
            <p className="text-sm text-muted-foreground">
              Saved across {eventCount} confirmed purchase{eventCount === 1 ? '' : 's'}.
            </p>
            <p className="flex items-center gap-2 text-sm">
              <Flame className="h-4 w-4" aria-hidden="true" />
              {streakWeeks === 0
                ? 'No active weekly streak'
                : `${streakWeeks}-week saving streak`}
            </p>
            <p className="flex items-center gap-2 text-sm">
              <Award className="h-4 w-4" aria-hidden="true" />
              {saverBadgeLabel(badge)}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
