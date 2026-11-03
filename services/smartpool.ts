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
