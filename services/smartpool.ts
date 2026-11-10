/**
 * SmartPool helpers (Option 8, Feature 2) — pure progress math.
 * No members are ever invented: a pool starts at its real creator count
 * (the creator is member #1) and only grows by real joins.
 */

export interface PoolProgress {
  members: number;
  threshold: number;
  percent: number;
  remaining: number;
  reached: boolean;
}

export function poolProgress(members: number, threshold: number): PoolProgress {
  const safeThreshold = Math.max(1, Math.floor(threshold) || 1);
  const safeMembers = Math.max(0, Math.floor(members) || 0);
  return {
    members: safeMembers,
    threshold: safeThreshold,
    percent: Math.min(100, Math.round((safeMembers / safeThreshold) * 100)),
    remaining: Math.max(0, safeThreshold - safeMembers),
    reached: safeMembers >= safeThreshold,
  };
}

/** The pool's honest purpose, shown on every pool UI. */
export const POOL_NO_GUARANTEE_NOTE =
  'Reaching the threshold expresses collective buying interest only. It does not guarantee a discount or a retailer offer — SmartBuy has no retailer partnership for group pricing, and any future retailer offer would be a separate step.';

/**
 * Volume-tier MILESTONES (Option 11, Phase 3) — illustrative group-size
 * targets only. These sizes are NOT discount tiers and must never be
 * worded as offers: there is no retailer partnership, so no size
 * "unlocks" any % off. A milestone only marks how big the group has
 * grown (5 / 10 / 20 members), on the way to — and beyond — the pool's
 * own threshold, which is always included as a milestone too.
 */
export const POOL_MILESTONE_SIZES = [5, 10, 20] as const;

export interface PoolMilestone {
  /** Group size this milestone marks. */
  size: number;
  /** True once the real member count has reached this size. */
  reached: boolean;
  /** True when this milestone is the pool's own threshold. */
  isThreshold: boolean;
}

export interface PoolMilestones {
  milestones: PoolMilestone[];
  /** Largest milestone size; the progress bar is scaled to this. */
  largestTarget: number;
  /** Progress toward the largest milestone, 0–100. */
  percent: number;
  /** Next milestone not yet reached, or null when all are reached. */
  next: PoolMilestone | null;
}

export function poolMilestones(members: number, threshold: number): PoolMilestones {
  const safeMembers = Math.max(0, Math.floor(members) || 0);
  const safeThreshold = Math.max(1, Math.floor(threshold) || 1);
  const sizes = Array.from(
    new Set([...POOL_MILESTONE_SIZES, safeThreshold])
  ).sort((a, b) => a - b);
  const milestones: PoolMilestone[] = sizes.map((size) => ({
    size,
    reached: safeMembers >= size,
    isThreshold: size === safeThreshold,
  }));
  const largestTarget = sizes[sizes.length - 1];
  return {
    milestones,
    largestTarget,
    percent: Math.min(100, Math.round((safeMembers / largestTarget) * 100)),
    next: milestones.find((m) => !m.reached) ?? null,
  };
}

/**
 * Shared international shipping split (Option 11, Phase 3).
 * The shipping total comes ONLY from an estimate the pool creator
 * supplied (stored on the pool) — the same user-entered convention
 * as the Option 11 landed-cost calculator, where shipping is 0 when
 * unknown and no carrier rate is ever invented. This function never
 * invents a rate: a missing / zero / negative estimate, or a pool
 * with no members yet, returns null and the UI must render the
 * honest empty state instead of a number.
 */
export interface ShippingSplit {
  /** The estimated total international shipping, USD. */
  totalUsd: number;
  /** Real member count the total is split across. */
  members: number;
  /**
   * Each member's share, USD, rounded to cents.
   * With no quantities this is the even split (total / members).
   * With quantities it is the AVERAGE share (total / members) — the
   * per-member breakdown lives in `sharesUsd`.
   */
  perMemberUsd: number;
  /** True when the split was computed by quantity share. */
  byQuantity: boolean;
  /** Total units committed across the pool, or null without quantities. */
  totalQuantity: number | null;
  /**
   * Per-member share in the same order as the `quantities` argument,
   * rounded to cents, adjusted so the shares sum exactly to
   * `totalUsd`. Null without quantities.
   */
  sharesUsd: number[] | null;
}

export function splitShippingEstimate(
  totalShippingUsd: number | null | undefined,
  memberCount: number,
  quantities?: Array<number | null | undefined>
): ShippingSplit | null {
  const total = typeof totalShippingUsd === 'number' ? totalShippingUsd : NaN;
  const members = Math.max(0, Math.floor(memberCount) || 0);
  if (!Number.isFinite(total) || total <= 0 || members < 1) return null;
  const totalUsd = Math.round(total * 100) / 100;
  const perMemberUsd = Math.round((totalUsd / members) * 100) / 100;

  const hasQuantities =
    Array.isArray(quantities) && quantities.length > 0;
  if (!hasQuantities) {
    return { totalUsd, members, perMemberUsd, byQuantity: false, totalQuantity: null, sharesUsd: null };
  }
  // Unknown quantity counts as 1 unit (today's behaviour: every
  // member counts once). Quantities are clamped to >= 1.
  const qtys = quantities!.map((q) =>
    Number.isFinite(q) && (q as number) >= 1 ? Math.floor(q as number) : 1
  );
  const totalQuantity = qtys.reduce((sum, q) => sum + q, 0);
  if (totalQuantity < 1) {
    return { totalUsd, members, perMemberUsd, byQuantity: false, totalQuantity: null, sharesUsd: null };
  }
  const rawShares = qtys.map((q) => (totalUsd * q) / totalQuantity);
  const sharesUsd = rawShares.map((s) => Math.round(s * 100) / 100);
  // Fix penny drift so the shares sum exactly to the total: put the
  // residual on the largest-quantity member's share.
  const drift = Math.round((totalUsd - sharesUsd.reduce((s, v) => s + v, 0)) * 100) / 100;
  if (drift !== 0) {
    let largestIdx = 0;
    for (let i = 1; i < qtys.length; i++) {
      if (qtys[i] > qtys[largestIdx]) largestIdx = i;
    }
    sharesUsd[largestIdx] = Math.round((sharesUsd[largestIdx] + drift) * 100) / 100;
  }
  return { totalUsd, members, perMemberUsd, byQuantity: true, totalQuantity, sharesUsd };
}

/** Shown on every shipping-split render. */
export const POOL_SHIPPING_NOTE =
  'Shared shipping split is an estimate only — not a carrier quote. The shipping total is an estimate supplied by the pool creator (or entered by you to preview); SmartBuy has no carrier rate and no retailer partnership. Splitting a shipment can increase the total shipping cost versus a single shipment.';
