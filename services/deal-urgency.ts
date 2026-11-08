/**
 * Deal Urgency Indicator (Enterprise #11) — deterministic, from real
 * signals only.
 *
 * Urgency derives ONLY from three recorded signals:
 *   1. an offer end time (a coupon's validUntil or a deal's end_at),
 *   2. stock state (in_stock + stock_quantity from merchant_products),
 *   3. recorded price-drop magnitude (merchant-basis saving vs
 *      compare_at_price, via lib/deal-math discountPercent).
 *
 * There is NO demand/velocity data in this project — no views, no
 * sales rates, no carts. This module never computes or displays
 * "demand velocity", views, or sales rates. A level of 'none' means
 * "no urgency signal exists", and the UI renders nothing at all
 * (no fake urgency, no placeholder badge).
 */

/** Stated thresholds — change them here and the UI text follows. */
export const DEAL_URGENCY_THRESHOLDS = {
  /** Hours left at or under which an ending offer is HIGH urgency. */
  highHoursLeft: 24,
  /** Hours left at or under which an ending offer is MEDIUM urgency. */
  mediumHoursLeft: 72,
  /** Hours left at or under which an ending offer is LOW urgency. */
  lowHoursLeft: 168,
  /** Stock at or under which a listing is HIGH urgency (when in stock). */
  highStockAtMost: 3,
  /** Stock at or under which a listing is MEDIUM urgency (when in stock). */
  mediumStockAtMost: 10,
  /** Drop % at or above which a saving is HIGH urgency. */
  highDropPercent: 20,
  /** Drop % at or above which a saving is MEDIUM urgency. */
  mediumDropPercent: 10,
};

export type DealUrgencyLevel = 'high' | 'medium' | 'low' | 'none';

export interface DealUrgencyInput {
  /** Offer end time (coupon validUntil or deal end_at). Null = no end signal. */
  endsAt?: string | null;
  /** Whether the listing can actually be bought right now. */
  inStock: boolean;
  /** Recorded units left. Null = unknown (no stock signal). */
  stockQuantity?: number | null;
  /** Recorded saving vs compare_at_price, in percent (0–100). Null = no drop signal. */
  dropPercent?: number | null;
  /** Human label for the end signal, e.g. 'Coupon expires'. Defaults to 'Offer ends'. */
  endLabel?: string;
  /** Reference time (defaults to now). Tests pass a fixed clock. */
  now?: Date;
}

export interface DealUrgency {
  level: DealUrgencyLevel;
  /** Human-readable reasons, one per firing signal (for the badge title). */
  reasons: string[];
}

function hoursLeft(endsAt: string, now: Date): number | null {
  const t = new Date(endsAt).getTime();
  if (!Number.isFinite(t)) return null;
  return (t - now.getTime()) / (1000 * 60 * 60);
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.max(0, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * Pure urgency. Deterministic: same inputs in → same level out.
 * Invalid inputs (bad dates, NaN, negative drop) are treated as
 * absent signals, never as urgency and never as a crash.
 */
export function getDealUrgency(input: DealUrgencyInput): DealUrgency {
  const now = input.now ?? new Date();
  const none: DealUrgency = { level: 'none', reasons: [] };

  // Nothing to buy → no urgency, however good the (unusable) signals look.
  if (!input.inStock) return none;

  const endLabel = input.endLabel ?? 'Offer ends';
  const hours = input.endsAt ? hoursLeft(input.endsAt, now) : null;
  // An expired offer is not urgency — it is over.
  const liveHours = hours !== null && hours >= 0 ? hours : null;

  const stock =
    typeof input.stockQuantity === 'number' && Number.isFinite(input.stockQuantity)
      ? Math.floor(input.stockQuantity)
      : null;
  const drop =
    typeof input.dropPercent === 'number' &&
    Number.isFinite(input.dropPercent) &&
    input.dropPercent > 0
      ? input.dropPercent
      : null;

  const highReasons: string[] = [];
  const mediumReasons: string[] = [];
  const lowReasons: string[] = [];

  if (liveHours !== null) {
    const label = `${endLabel} in ${formatHours(liveHours)}`;
    if (liveHours <= DEAL_URGENCY_THRESHOLDS.highHoursLeft) highReasons.push(label);
    else if (liveHours <= DEAL_URGENCY_THRESHOLDS.mediumHoursLeft) mediumReasons.push(label);
    else if (liveHours <= DEAL_URGENCY_THRESHOLDS.lowHoursLeft) lowReasons.push(label);
  }
  if (stock !== null) {
    if (stock <= DEAL_URGENCY_THRESHOLDS.highStockAtMost) {
      highReasons.push(`Only ${stock} left in stock`);
    } else if (stock <= DEAL_URGENCY_THRESHOLDS.mediumStockAtMost) {
      mediumReasons.push(`Only ${stock} left in stock`);
    }
  }
  if (drop !== null) {
    if (drop >= DEAL_URGENCY_THRESHOLDS.highDropPercent) {
      highReasons.push(`${Math.round(drop)}% below compare-at price`);
    } else if (drop >= DEAL_URGENCY_THRESHOLDS.mediumDropPercent) {
      mediumReasons.push(`${Math.round(drop)}% below compare-at price`);
    } else {
      lowReasons.push(`${Math.round(drop)}% below compare-at price`);
    }
  }

  if (highReasons.length > 0) return { level: 'high', reasons: highReasons };
  if (mediumReasons.length > 0) return { level: 'medium', reasons: mediumReasons };
  if (lowReasons.length > 0) return { level: 'low', reasons: lowReasons };
  return none;
}
