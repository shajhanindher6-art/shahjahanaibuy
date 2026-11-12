/**
 * AI Savings Dashboard — /tools/savings-dashboard (Section 7, item 6).
 *
 * A VIEW ONLY on the existing savings ledger: it reads the existing
 * GET /api/v1/savings (confirmed savings events only — totals are
 * computed at read time, never stored, never estimated) and shows
 * total saved, this month, biggest saving, and recent events. No
 * new route, no new table, no estimate is ever added.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PiggyBank } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { saverBadgeLabel, type SavingsEvent } from '@/lib/savings';

interface SavingsResponse {
  events: SavingsEvent[];
  totalSavedUsd: number;
  eventCount: number;
  streakWeeks: number;
  badge: string;
  savingsEnabled: boolean;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

export default function SavingsDashboardPage() {
  const { language } = useRegion();
  const [data, setData] = useState<SavingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/savings');
      if (res.status === 401) {
        setSignedIn(false);
        setData(null);
        return;
      }
      if (!res.ok) throw new Error('savings request failed');
      const json = await res.json();
      setSignedIn(true);
      setData(json?.data as SavingsResponse);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const now = new Date();
  const thisMonthEvents = (data?.events ?? []).filter((e) => {
    const d = new Date(e.recordedAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const thisMonthTotal = thisMonthEvents.reduce((sum, e) => sum + e.amountSavedUsd, 0);
  const biggest = (data?.events ?? []).reduce<number | null>(
    (max, e) => (max === null || e.amountSavedUsd > max ? e.amountSavedUsd : max),
    null
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <PiggyBank className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingSavingsDashboard')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            How much you have actually saved — from confirmed savings only.
            Every figure below is computed from your recorded savings
            ledger at read time. Nothing is estimated, and nothing is
            added for a deal you did not confirm. Every figure uses
            deterministic rules on your confirmed savings ledger —
            no LLM, nothing guessed.
          </p>

          {!signedIn ? (
            <Card className="mt-8">
              <CardContent className="pt-6">
                <p className="font-medium">Sign in to see your savings.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Savings are recorded when you confirm a purchase — sign in
                  to see your ledger.
                </p>
                <Link
                  href="/sign-in"
                  className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Sign in →
                </Link>
              </CardContent>
            </Card>
          ) : loading ? (
            <div className="mt-8 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : data && !data.savingsEnabled ? (
            <EmptyState
              title="Savings are not set up yet"
              description="The savings ledger is not in the database yet. Confirmed savings will appear here once the migration has been run — no total is shown until real savings exist."
            />
          ) : data ? (
            <>
              <div className="mt-8 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Total saved</p>
                  <p className="text-lg font-bold">{money(data.totalSavedUsd)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">This month</p>
                  <p className="text-lg font-bold">{money(thisMonthTotal)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Biggest saving</p>
                  <p className="text-lg font-bold">{biggest === null ? '—' : money(biggest)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Events</p>
                  <p className="text-lg font-bold">{data.eventCount}</p>
                </div>
              </div>

              <p className="mt-4 text-sm text-muted-foreground">
                {data.streakWeeks > 0
                  ? `${data.streakWeeks}-week saving streak. `
                  : 'No saving streak yet. '}
                Badge: {saverBadgeLabel(data.badge as Parameters<typeof saverBadgeLabel>[0])}.
              </p>

              {data.events.length === 0 ? (
                <EmptyState
                  title="No confirmed savings yet"
                  description="Savings appear here when you confirm a purchase at a price below the recorded compare-at price. No estimate is shown in the meantime."
                />
              ) : (
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle className="text-base">Recent savings</CardTitle>
                    <CardDescription>Confirmed savings events, newest first</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {data.events.slice(0, 10).map((event) => (
                        <li key={event.id} className="flex items-center justify-between gap-2 border-b pb-3 last:border-0 last:pb-0">
                          <div>
                            <p className="text-sm font-medium">
                              {event.basis === 'alert_purchase' ? 'Alert purchase' : 'Price drop'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(event.recordedAt).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                              })}
                            </p>
                          </div>
                          <p className="font-bold text-emerald-700">{money(event.amountSavedUsd)}</p>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <EmptyState
              title="Could not load your savings"
              description="The savings ledger could not be reached. Try again — no figures are shown until the real ledger loads."
            />
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
