/**
 * Deal Hotspots Calendar — pure, built ONLY from recorded events.
 *
 * Events are two kinds, both real database rows:
 *   - price drops: point-to-point decreases in `price_history`
 *     (computed with lib/price-trend's computePriceDrops, per product);
 *   - deal starts: a row in `deals` whose start_at falls on that day
 *     (a deal window opening — the date a deal became available).
 *
 * There are NO probability claims here. The recorded history covers
 * roughly 30 days, so a "high-probability discount window" or any
 * seasonal forecast would be fabrication. The calendar shows
 * RECORDED drops only, and every render carries the coverage note:
 * "Based on N days of recorded price history — seasonal patterns
 * need a full year of data." Months with no events are simply not
 * listed; days with no events are plain cells, never zero-filled
 * claims.
 */

export interface HotspotDropEvent {
  /** ISO date of the lower (newer) point. */
  date: string;
  productId: string;
}

export interface HotspotDealEvent {
  /** ISO date the deal started. */
  date: string;
  dealId: string;
}

export interface HotspotDay {
  /** YYYY-MM-DD (local calendar date of the event). */
  date: string;
  drops: number;
  deals: number;
}

export interface HotspotMonth {
  year: number;
  /** 0-based month (0 = January), matching Date.getMonth(). */
  month: number;
  days: HotspotDay[];
  totalDrops: number;
  totalDeals: number;
}

export interface DealHotspots {
  /** Months with at least one event, newest first. */
  months: HotspotMonth[];
  totalDrops: number;
  totalDeals: number;
  /** Days spanned by the recorded price history (0 when none). */
  historyDays: number;
  coverageNote: string;
}

function dayKey(iso: string): string | null {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function buildDealHotspots(args: {
  drops: HotspotDropEvent[];
  deals: HotspotDealEvent[];
  /** ISO start of the recorded price history, or null when none. */
  historyStart: string | null;
  /** ISO end of the recorded price history, or null when none. */
  historyEnd: string | null;
}): DealHotspots {
  const { drops, deals, historyStart, historyEnd } = args;

  const dayMap = new Map<string, { drops: number; deals: number }>();
  const bump = (date: string, field: 'drops' | 'deals') => {
    const key = dayKey(date);
    if (!key) return;
    const entry = dayMap.get(key) ?? { drops: 0, deals: 0 };
    entry[field] += 1;
    dayMap.set(key, entry);
  };
  for (const d of drops) bump(d.date, 'drops');
  for (const d of deals) bump(d.date, 'deals');

  const monthMap = new Map<string, HotspotMonth>();
  for (const [date, counts] of [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [y, m] = date.split('-').map(Number);
    const key = `${y}-${m}`;
    let month = monthMap.get(key);
    if (!month) {
      month = { year: y, month: m - 1, days: [], totalDrops: 0, totalDeals: 0 };
      monthMap.set(key, month);
    }
    month.days.push({ date, drops: counts.drops, deals: counts.deals });
    month.totalDrops += counts.drops;
    month.totalDeals += counts.deals;
  }

  const months = [...monthMap.values()].sort(
    (a, b) => b.year - a.year || b.month - a.month
  );

  const startMs = historyStart ? new Date(historyStart).getTime() : NaN;
  const endMs = historyEnd ? new Date(historyEnd).getTime() : NaN;
  const historyDays =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
      ? Math.max(1, Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1)
      : 0;

  const coverageNote =
    historyDays > 0
      ? `Based on ${historyDays} day${historyDays === 1 ? '' : 's'} of recorded price history — seasonal patterns need a full year of data.`
      : 'No recorded price history yet — no hotspots to show.';

  return {
    months,
    totalDrops: drops.filter((d) => dayKey(d.date) !== null).length,
    totalDeals: deals.filter((d) => dayKey(d.date) !== null).length,
    historyDays,
    coverageNote,
  };
}
