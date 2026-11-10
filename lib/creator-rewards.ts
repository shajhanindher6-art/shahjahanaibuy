/**
 * Creator & community rewards — S5#10 (pure helpers, no I/O).
 *
 * Verified deal submitters earn points and badges, appear on a
 * public leaderboard, and — once affiliate revenue share is
 * configured — a share of the revenue their deals generate.
 *
 * VERIFICATION RULE (do not weaken): rewards are earned ONLY for
 * deals verified via admin confirmation (`is_verified`) OR the
 * merchant-price match (catalog product + merchant_products row
 * within 5% of the deal price — see services/community-deals.ts
 * `isDealVerified`). Upvotes NEVER verify a deal and NEVER earn
 * points: this module takes a precomputed `verified` boolean plus
 * its method, and deliberately has no input for votes at all.
 *
 * POINTS + BADGES are program rules (constants below), not measured
 * data: 10 points per verified deal. A badge needs the verified-deal
 * count, not just points, so a badge can never be earned any other way.
 *
 * REVENUE SHARE is env-gated wiring only: `CREATOR_REVENUE_SHARE_PERCENT`
 * (0–100) must be set by the owner; unset = share not configured and
 * every share computation returns null. No payout is ever made by
 * this code — amounts are computed for display/admin use only, and
 * real payouts need the owner's Stripe/affiliate payout decision.
 */

export const POINTS_PER_VERIFIED_DEAL = 10;

export type CreatorBadge = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum';

export interface BadgeThreshold {
  badge: Exclude<CreatorBadge, 'none'>;
  verifiedDeals: number;
  points: number;
  label: string;
}

/** Badge ladder — verified-deal counts are the gate, points follow. */
export const BADGE_THRESHOLDS: BadgeThreshold[] = [
  { badge: 'bronze', verifiedDeals: 1, points: 10, label: 'Bronze Contributor' },
  { badge: 'silver', verifiedDeals: 5, points: 50, label: 'Silver Contributor' },
  { badge: 'gold', verifiedDeals: 15, points: 150, label: 'Gold Contributor' },
  { badge: 'platinum', verifiedDeals: 30, points: 300, label: 'Platinum Contributor' },
];

export function badgeForVerifiedDeals(verifiedDeals: number): CreatorBadge {
  if (!Number.isFinite(verifiedDeals) || verifiedDeals < 1) return 'none';
  let badge: CreatorBadge = 'none';
  for (const t of BADGE_THRESHOLDS) {
    if (verifiedDeals >= t.verifiedDeals) badge = t.badge;
  }
  return badge;
}

export function badgeLabel(badge: CreatorBadge): string {
  if (badge === 'none') return 'No badge yet';
  return BADGE_THRESHOLDS.find((t) => t.badge === badge)?.label ?? 'No badge yet';
}

/**
 * Points a deal earns. `verified` must already be the result of
 * `isDealVerified` (admin flag OR price match). Unverified deals
 * earn 0 — including popular ones: votes are not an input here.
 */
export function pointsForDeal(verified: boolean): number {
  return verified ? POINTS_PER_VERIFIED_DEAL : 0;
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string | null;
  points: number;
  verifiedDeals: number;
  badge: CreatorBadge;
}

/**
 * Rank leaderboard entries: points desc, then verified deals desc,
 * then user id asc (deterministic tie-break, never random).
 * Entries with no points and no verified deals are dropped — the
 * leaderboard shows contributors only.
 */
export function rankLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries]
    .filter((e) => e.points > 0 || e.verifiedDeals > 0)
    .sort(
      (a, b) =>
        b.points - a.points || b.verifiedDeals - a.verifiedDeals || a.userId.localeCompare(b.userId)
    );
}

/** Next badge a contributor is working toward, or null at the top. */
export function nextBadge(verifiedDeals: number): BadgeThreshold | null {
  for (const t of BADGE_THRESHOLDS) {
    if (verifiedDeals < t.verifiedDeals) return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Revenue share (env-gated wiring — no payouts)
// ---------------------------------------------------------------------------

function readSharePercent(): number | null {
  const raw = process.env.CREATOR_REVENUE_SHARE_PERCENT;
  if (!raw) return null;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  return value;
}

export interface RevenueShareConfig {
  configured: boolean;
  percent: number | null;
}

/** Owner configuration for creator revenue share. */
export function getCreatorRevenueShareConfig(): RevenueShareConfig {
  const percent = readSharePercent();
  return { configured: percent !== null, percent };
}

/**
 * Creator's share of an affiliate revenue amount (both in cents).
 * Returns null when the share is not configured, the revenue is not
 * a positive finite amount, or the percent is invalid — never a
 * guessed payout. Rounding is down to whole cents.
 */
export function computeRevenueShare(input: {
  affiliateRevenueCents: number;
  sharePercent?: number | null;
}): number | null {
  const percent = input.sharePercent ?? readSharePercent();
  if (percent === null || percent === undefined) return null;
  if (!Number.isFinite(input.affiliateRevenueCents) || input.affiliateRevenueCents <= 0) return null;
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
  return Math.floor((input.affiliateRevenueCents * percent) / 100);
}
