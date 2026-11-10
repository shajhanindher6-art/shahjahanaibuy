/**
 * Pool quantity helpers (Section 6, Item 8 — Group buying 2.0).
 *
 * Pure functions, no I/O. Per-member quantities come from the
 * `pool_member_quantities` table (migration 033, owner runs it once);
 * until then every member counts as 1 unit — today's behaviour.
 *
 * No discount %, no "you save" figure, no order/checkout state:
 * quantities only change how a cost is SPLIT, never what anything
 * costs. Product cost is derived live from recorded
 * merchant_products prices at view time, never stored here.
 */

/** Clamp a raw quantity to a whole number of units (>= 1). Unknown / invalid counts as 1. */
export function normalizeQuantity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
}

/**
 * Total units committed by the pool. Each entry is one member's
 * quantity; null/undefined/invalid counts as 1 (today's behaviour).
 */
export function totalQuantity(quantities: Array<number | null | undefined>): number {
  return quantities.reduce<number>((sum, q) => sum + normalizeQuantity(q), 0);
}

/**
 * A member's share of a quantity-based split: member qty / pool
 * total qty, 0–1. Returns 0 when the total is not positive.
 */
export function quantityShare(memberQty: number, totalQty: number): number {
  const qty = normalizeQuantity(memberQty);
  const total = Number.isFinite(totalQty) ? totalQty : 0;
  if (total <= 0) return 0;
  return qty / total;
}

/**
 * A member's product cost: recorded unit price x their quantity,
 * rounded to cents. Returns null when there is no valid recorded
 * unit price — never a guessed price.
 */
export function productCostSplit(unitPrice: number | null | undefined, memberQty: number): number | null {
  const price = typeof unitPrice === 'number' ? unitPrice : NaN;
  if (!Number.isFinite(price) || price <= 0) return null;
  return Math.round(price * normalizeQuantity(memberQty) * 100) / 100;
}

/**
 * A member's share of the pool's shipping estimate, by quantity
 * share. Returns null when there is no valid estimate or no
 * committed quantity — the UI renders "No shipping estimate
 * available" instead of a number.
 */
export function shippingShareForMember(
  totalShippingUsd: number | null | undefined,
  memberQty: number,
  totalQty: number
): number | null {
  const total = typeof totalShippingUsd === 'number' ? totalShippingUsd : NaN;
  if (!Number.isFinite(total) || total <= 0) return null;
  const share = quantityShare(memberQty, totalQty);
  if (share <= 0) return null;
  return Math.round(total * share * 100) / 100;
}

export interface PoolQuantityProgress {
  /** Real member count. */
  members: number;
  /** Member threshold from the pool (0 when unknown). */
  memberThreshold: number;
  /** Total units committed. */
  totalQuantity: number;
  /** Optional target quantity from the pool (null = no target set). */
  targetQuantity: number | null;
  /** Units progress toward the target, 0–100 (null without a target). */
  quantityPercent: number | null;
  /** True once committed units reach the target (false without one). */
  quantityReached: boolean;
}

export function poolQuantityProgress(
  members: number,
  quantities: Array<number | null | undefined>,
  memberThreshold: number,
  targetQuantity: number | null | undefined
): PoolQuantityProgress {
  const safeMembers = Math.max(0, Math.floor(members) || 0);
  const safeThreshold = Math.max(0, Math.floor(memberThreshold) || 0);
  const total = totalQuantity(quantities);
  const target =
    typeof targetQuantity === 'number' && Number.isFinite(targetQuantity) && targetQuantity >= 2
      ? Math.floor(targetQuantity)
      : null;
  return {
    members: safeMembers,
    memberThreshold: safeThreshold,
    totalQuantity: total,
    targetQuantity: target,
    quantityPercent: target ? Math.min(100, Math.round((total / target) * 100)) : null,
    quantityReached: target ? total >= target : false,
  };
}

/**
 * Human-readable pool progress, built only from real rows:
 * "N of M members · Q of T units committed" (with a target), or
 * "N of M members · Q units committed" (without one).
 */
export function poolQuantityProgressText(
  members: number,
  quantities: Array<number | null | undefined>,
  memberThreshold: number,
  targetQuantity: number | null | undefined
): string {
  const progress = poolQuantityProgress(members, quantities, memberThreshold, targetQuantity);
  const memberPart = `${progress.members} of ${progress.memberThreshold} members`;
  const quantityPart =
    progress.targetQuantity !== null
      ? `${progress.totalQuantity} of ${progress.targetQuantity} units committed`
      : `${progress.totalQuantity} units committed`;
  return `${memberPart} · ${quantityPart}`;
}
