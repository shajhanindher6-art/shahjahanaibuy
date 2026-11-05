/**
 * Dashboard helpers — AI Glass redesign.
 *
 * PURE: no IO, no env, the caller passes `now`, so these can be
 * unit-tested directly. Used by the dashboard's deal sections for
 * honest countdowns built only from the deals table's real
 * start_at / end_at values — never invented dates.
 */

/** Whole days from `now` until `date` (negative when past). */
export function daysUntil(date: string, now: Date = new Date()): number {
  const ms = new Date(date).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Countdown label for a deal's end date, e.g. "Ends in 3d 4h",
 * "Ends today", or "Ended". Hours are whole hours left after the
 * whole days; a past end date always reads "Ended", never a
 * negative countdown.
 */
export function formatDealCountdown(endAt: string, now: Date = new Date()): string {
  const end = new Date(endAt).getTime();
  const current = now.getTime();
  if (!Number.isFinite(end)) return 'End date unknown';
  if (end <= current) return 'Ended';
  const diffMs = end - current;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days === 0) return hours <= 1 ? 'Ends today' : `Ends in ${hours}h`;
  return hours > 0 ? `Ends in ${days}d ${hours}h` : `Ends in ${days}d`;
}

/**
 * Countdown label for a deal's start date, e.g. "Starts in 2d",
 * "Starts today", or "Started". Used by the Upcoming Deals section.
 */
export function formatDealStartsIn(startAt: string, now: Date = new Date()): string {
  const start = new Date(startAt).getTime();
  const current = now.getTime();
  if (!Number.isFinite(start)) return 'Start date unknown';
  if (start <= current) return 'Started';
  const days = Math.floor((start - current) / (24 * 60 * 60 * 1000));
  if (days === 0) return 'Starts today';
  return days === 1 ? 'Starts in 1d' : `Starts in ${days}d`;
}

/**
 * Whether a drop-window simulation qualifies for the dashboard's
 * "Drops to watch" list: only a real simulation. "not_enough_data"
 * (< 2 price points) and "no_drops" (no recorded drop to learn
 * from) are never shown as an upcoming drop.
 */
export function qualifiesAsDropToWatch(status: string): boolean {
  return status === 'simulated';
}
