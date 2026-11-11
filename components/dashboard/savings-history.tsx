/**
 * Savings ledger detail — Section 13, Chunk F, item 45
 * (CONDITIONAL — kept: verified, see below).
 *
 * SavingsWidget shows only totals; this lists which purchase saved
 * how much, when. Verified first: GET /api/v1/savings already
 * returns the event list (`events`, up to 100, newest first) from
 * savings_events alongside the totals — no route change was needed.
 * Each event's amount is compare-at minus the recorded price
 * (lib/savings.ts, append-only); the parent passes the events
 * through, so this adds no new fetch.
 *
 * The API returns productId (a UUID), not a slug, so events do not
 * link to a product page — a link would need a slug lookup that
 * does not exist, and guessing one is worse than no link.
 */

'use client';

import { PiggyBank } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { SavingsEvent } from '@/lib/savings';

export type { SavingsEvent };

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function basisLabel(basis: SavingsEvent['basis']): string {
  return basis === 'price_drop' ? 'Price drop purchase' : 'Alert purchase';
}

export function SavingsHistory({ events, loading = false }: { events: SavingsEvent[]; loading?: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Savings history</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="glass-card animate-shimmer h-24" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PiggyBank className="h-5 w-5" aria-hidden="true" />
          Savings history
        </CardTitle>
        <CardDescription>
          Each confirmed purchase and what it saved — compare-at price minus the recorded price.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No savings recorded yet — confirm a purchase after a price alert and the saving will be listed here.
          </p>
        ) : (
          <ul className="space-y-2">
            {events.slice(0, 10).map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <span className="block text-sm font-medium">{basisLabel(event.basis)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {new Date(event.recordedAt).toLocaleDateString()}
                    {event.recordedAt && ` · ${new Date(event.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                  </span>
                </div>
                <span className="shrink-0 text-sm font-bold text-green-600">
                  {formatUsd(event.amountSavedUsd)} saved
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
