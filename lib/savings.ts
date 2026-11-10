/**
 * Gamified smart buying — Section 6, item 15 (trimmed audit design).
 *
 * An append-only savings ledger: a row is created ONLY when the user
 * confirms a purchase, and the amount is derived from recorded data
 * only (merchant compare_at_price minus the recorded price at
 * purchase — verified in app/api/v1/savings/route.ts). Amounts are
 * never auto-credited and never estimated.
 *
 * There is NO points currency for buyers and NOTHING is stored
 * derived: totals, streaks, and badges are computed at read time
 * from the ledger — never stored stale. The badge ladder reuses the
 * creator-rewards thresholds (1 / 5 / 15 / 30 events → bronze /
 * silver / gold / platinum), counting confirmed savings events
 * instead of verified deals.
 */

import { badgeForVerifiedDeals, badgeLabel, type CreatorBadge } from '@/lib/creator-rewards';

export type SaverBadge = CreatorBadge;

export const SAVER_BADGE_THRESHOLDS = [
  { badge: 'bronze', events: 1, label: 'Bronze Saver' },
  { badge: 'silver', events: 5, label: 'Silver Saver' },
  { badge: 'gold', events: 15, label: 'Gold Saver' },
  { badge: 'platinum', events: 30, label: 'Platinum Saver' },
] as const;

export type SavingsBasis = 'alert_purchase' | 'price_drop';

export interface SavingsEvent {
  id: string;
  userId: string;
  productId: string | null;
  alertId: string | null;
  amountSavedUsd: number;
  basis: SavingsBasis;
  recordedAt: string;
}

export interface SavingsSummary {
  totalSavedUsd: number;
  eventCount: number;
  /** Consecutive weeks (most recent first) with at least one event. Derived, never stored. */
  streakWeeks: number;
  badge: SaverBadge;
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Round to whole cents (avoids float dust in money math). */
export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Savings for one purchase: compare-at minus the recorded purchase
 * price. Returns null unless both prices are finite and compare-at
 * is strictly greater — a purchase at or above compare-at saved
 * nothing, and an unrecorded price can never produce a saving.
 */
export function computeSavingsAmount(
  compareAtPrice: number | null | undefined,
  purchasePrice: number | null | undefined
): number | null {
  if (
    typeof compareAtPrice !== 'number' ||
    typeof purchasePrice !== 'number' ||
    !Number.isFinite(compareAtPrice) ||
    !Number.isFinite(purchasePrice)
  ) {
    return null;
  }
  if (compareAtPrice <= purchasePrice) return null;
  return roundToCents(compareAtPrice - purchasePrice);
}

/**
 * True only when a user-claimed amount equals the expected saving
 * to the cent. The API rejects anything else — a claimed saving
 * that does not match the recorded data is never recorded.
 */
export function savingsAmountMatches(amountSavedUsd: unknown, expectedUsd: number | null): boolean {
  if (expectedUsd === null) return false;
  if (typeof amountSavedUsd !== 'number' || !Number.isFinite(amountSavedUsd) || amountSavedUsd <= 0) {
    return false;
  }
  return roundToCents(amountSavedUsd) === roundToCents(expectedUsd);
}

/**
 * Consecutive weeks with at least one savings event, counting back
 * from the most recent week in the array (the array is ordered
 * oldest → newest; the last element is the current week). A gap
 * week ends the streak; trailing weeks with no event give 0.
 */
export function deriveStreak(weeksWithEvents: boolean[]): number {
  let streak = 0;
  for (let i = weeksWithEvents.length - 1; i >= 0; i--) {
    if (!weeksWithEvents[i]) break;
    streak++;
  }
  return streak;
}

/**
 * Derive the per-week event flags from ledger timestamps. The
 * returned array is ordered oldest → newest, one entry per week
 * from the earliest event's week through the current week, so
 * deriveStreak() can count back from the end. Events in the future
 * are ignored (a clock-skewed row must not extend a streak).
 */
export function weeksWithEventsFromDates(
  recordedAtList: Array<string | null | undefined>,
  now: Date = new Date()
): boolean[] {
  const nowMs = now.getTime();
  const weeksAgo = new Set<number>();
  let maxWeeksAgo = 0;
  for (const raw of recordedAtList) {
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms) || ms > nowMs) continue;
    const ago = Math.floor((nowMs - ms) / MS_PER_WEEK);
    weeksAgo.add(ago);
    if (ago > maxWeeksAgo) maxWeeksAgo = ago;
  }
  if (weeksAgo.size === 0) return [];
  const weeks: boolean[] = [];
  for (let ago = maxWeeksAgo; ago >= 0; ago--) {
    weeks.push(weeksAgo.has(ago));
  }
  return weeks;
}

/**
 * Saver badge for a confirmed-savings-event count, reusing the
 * creator-rewards ladder (1 / 5 / 15 / 30). Derived at read time.
 */
export function saverBadgeForEventCount(count: number): SaverBadge {
  return badgeForVerifiedDeals(count);
}

export function saverBadgeLabel(badge: SaverBadge): string {
  if (badge === 'none') return 'No badge yet';
  return badgeLabel(badge).replace('Contributor', 'Saver');
}

/** Total, streak, and badge for a user's ledger — derived at read time. */
export function deriveSavingsSummary(
  events: Array<{ amountSavedUsd: number; recordedAt: string }>,
  now: Date = new Date()
): SavingsSummary {
  const total = roundToCents(
    events.reduce(
      (sum, e) =>
        sum + (typeof e.amountSavedUsd === 'number' && Number.isFinite(e.amountSavedUsd) ? e.amountSavedUsd : 0),
      0
    )
  );
  const weeks = weeksWithEventsFromDates(events.map((e) => e.recordedAt), now);
  return {
    totalSavedUsd: total,
    eventCount: events.length,
    streakWeeks: deriveStreak(weeks),
    badge: saverBadgeForEventCount(events.length),
  };
}
