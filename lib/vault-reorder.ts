/**
 * Vault reorder helpers (Section 6, Item 3 — Smart reordering).
 *
 * Pure functions, no I/O. Reorder fields live on `vault_items`
 * (migration 033, owner runs it once): is_consumable,
 * reorder_interval_days, reorder_reminder.
 *
 * The next reorder date is DERIVED on view — never stored: the
 * purchase date plus the interval, rolled forward by whole
 * intervals until it lands today or later. Nothing is ever
 * auto-ordered and no reminder is ever sent: the reminder flag is
 * only a user-set preference shown on the item ("Remind me" on/off).
 * A reorder is a suggestion the user acts on at the retailer.
 */

/** Whole days, 1 day … 10 years. Anything else is not a recorded interval. */
export const REORDER_INTERVAL_MIN_DAYS = 1;
export const REORDER_INTERVAL_MAX_DAYS = 3650;

/** Normalize a raw interval to whole days, or null when it is not a valid interval. */
export function normalizeReorderIntervalDays(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const days = Math.floor(n);
  if (days < REORDER_INTERVAL_MIN_DAYS || days > REORDER_INTERVAL_MAX_DAYS) return null;
  return days;
}

export interface NextReorder {
  /** Next reorder date (YYYY-MM-DD), today or later. */
  date: string;
  /** Whole days until that date (0 = due today). */
  daysUntil: number;
  /** How many full intervals have passed since the purchase. */
  cyclesPassed: number;
}

function toDateOnly(value: string): Date | null {
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Next reorder date for a consumable vault item, or null when there
 * is nothing to derive: not consumable, no valid interval, or no
 * valid purchase date. `now` is injectable for tests (defaults to
 * today, UTC, date-only).
 */
export function nextReorderDate(
  purchaseDate: string | null | undefined,
  intervalDays: number | null | undefined,
  isConsumable: boolean | null | undefined,
  now?: Date
): NextReorder | null {
  if (!isConsumable) return null;
  const interval = normalizeReorderIntervalDays(intervalDays);
  if (interval === null) return null;
  if (!purchaseDate || typeof purchaseDate !== 'string') return null;
  const purchased = toDateOnly(purchaseDate.slice(0, 10));
  if (!purchased) return null;

  const today = now ? new Date(now.getTime()) : new Date();
  today.setUTCHours(0, 0, 0, 0);

  let next = addDays(purchased, interval);
  let cyclesPassed = 0;
  while (next.getTime() < today.getTime()) {
    next = addDays(next, interval);
    cyclesPassed += 1;
  }
  const daysUntil = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  return { date: next.toISOString().slice(0, 10), daysUntil, cyclesPassed };
}
