/**
 * Alert health — Section 13, Chunk F, item 43.
 *
 * Active / paused / never-triggered / triggered N times / last
 * triggered date, from TrackedAlert (active, lastTriggeredAt,
 * triggerCount) returned by GET /api/v1/tracking. There is no
 * "expired" state: no expires_at column exists on alerts, so none
 * is invented here.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import Link from 'next/link';
import { Bell, BellOff, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/** Minimal shape of one TrackedAlert from GET /api/v1/tracking. */
export interface AlertHealthAlert {
  id: string;
  active: boolean;
  lastTriggeredAt: string | null;
  triggerCount: number;
}

export interface AlertHealthSummary {
  total: number;
  active: number;
  paused: number;
  neverTriggered: number;
  triggeredTotal: number;
  lastTriggeredAt: string | null;
}

/** Pure summary over the alert list. */
export function summarizeAlertHealth(alerts: AlertHealthAlert[]): AlertHealthSummary {
  let active = 0;
  let neverTriggered = 0;
  let triggeredTotal = 0;
  let lastTriggeredAt: string | null = null;
  for (const alert of alerts) {
    if (alert.active) active += 1;
    if (alert.triggerCount === 0) neverTriggered += 1;
    triggeredTotal += alert.triggerCount;
    if (alert.lastTriggeredAt !== null && (lastTriggeredAt === null || alert.lastTriggeredAt > lastTriggeredAt)) {
      lastTriggeredAt = alert.lastTriggeredAt;
    }
  }
  return {
    total: alerts.length,
    active,
    paused: alerts.length - active,
    neverTriggered,
    triggeredTotal,
    lastTriggeredAt,
  };
}

export function AlertHealth({ alerts, loading = false }: { alerts: AlertHealthAlert[]; loading?: boolean }) {
  const { language } = useRegion();
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{tFor(language, 'dashAlertHealth')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="glass-card animate-shimmer h-24" />
        </CardContent>
      </Card>
    );
  }

  const summary = summarizeAlertHealth(alerts);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" aria-hidden="true" />
          {tFor(language, 'dashAlertHealth')}
        </CardTitle>
        <CardDescription>
          Are your price alerts actually watching — and have they ever fired?
        </CardDescription>
      </CardHeader>
      <CardContent>
        {summary.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            No price alerts yet — open any product page and set a price alert there.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border p-3">
                <p className="flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground">
                  <Bell className="h-3.5 w-3.5 text-green-600" aria-hidden="true" /> Active
                </p>
                <p className="mt-1 text-2xl font-bold">{summary.active}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground">
                  <BellOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Paused
                </p>
                <p className="mt-1 text-2xl font-bold">{summary.paused}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-medium text-muted-foreground">Never triggered</p>
                <p className="mt-1 text-2xl font-bold">{summary.neverTriggered}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Triggered {summary.triggeredTotal} time{summary.triggeredTotal === 1 ? '' : 's'} in total
              {summary.lastTriggeredAt
                ? ` · last triggered ${new Date(summary.lastTriggeredAt).toLocaleDateString()}`
                : ' · none have triggered yet'}
              .
            </p>
            <Link href="/dashboard/tracking" className="text-sm font-medium text-primary hover:underline">
              Manage your alerts →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
