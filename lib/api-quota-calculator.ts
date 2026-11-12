/**
 * API Quota & Tier Calculator — pure helpers for
 * /tools/api-quota-calculator (Section 16, E3).
 *
 * Enter expected API calls/day → names the tier needed, the
 * headroom on that tier, and the next tier up. Quotas come from
 * lib/api-quota.ts (API_QUOTAS + ANONYMOUS_DAILY_QUOTA); tier
 * names/prices come from lib/tiers.ts.
 *
 * HONESTY: Premium ($9.99) is a PLANNED price — payments are not
 * live (Stripe test mode), so nothing here is purchasable today.
 * Family is "To be announced" and Team is "Custom / contact us".
 * Every tier row carries its priceStatus so the page can label it;
 * no price is ever presented as a live charge.
 */

import {
  ANONYMOUS_DAILY_QUOTA,
  API_QUOTAS,
} from '@/lib/api-quota';
import { availabilityLabel, getTier, type TierDefinition, type TierId } from '@/lib/tiers';

export type QuotaTierId = 'anonymous' | TierId;

/** One quota tier as the calculator presents it. */
export interface QuotaTierRow {
  id: QuotaTierId;
  name: string;
  /** Daily API-call cap for this tier. */
  quota: number;
  priceLabel: string;
  /** Honesty label: "Available now" / "Planned — price to be announced" / "Custom pricing". */
  priceHonesty: string;
  /** True when the price is only planned (not purchasable today). */
  pricePlanned: boolean;
}

function tierRow(id: TierId): QuotaTierRow {
  const tier: TierDefinition | null = getTier(id);
  return {
    id,
    name: tier?.name ?? id,
    quota: API_QUOTAS[id],
    priceLabel: tier?.priceLabel ?? '—',
    priceHonesty: tier ? availabilityLabel(tier) : '—',
    pricePlanned: tier ? tier.priceStatus !== 'live' : true,
  };
}

/** All quota tiers, smallest quota first. */
export const QUOTA_TIERS: QuotaTierRow[] = [
  {
    id: 'anonymous',
    name: 'Anonymous (no key)',
    quota: ANONYMOUS_DAILY_QUOTA,
    priceLabel: '$0',
    priceHonesty: 'Available now',
    pricePlanned: false,
  },
  tierRow('free'),
  tierRow('premium'),
  tierRow('family'),
  tierRow('team'),
];

/**
 * Parse ?calls=… from the page's search params. Returns the
 * integer calls/day, or null when missing/invalid (page shows the
 * empty state, never a guessed number).
 */
export function parseQuotaCalls(
  searchParams: { calls?: string | string[] } | undefined
): number | null {
  const raw = searchParams?.calls;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

export interface QuotaCalculation {
  callsPerDay: number;
  /** Smallest tier whose daily quota covers the calls, or null when none does. */
  neededTier: QuotaTierRow | null;
  /** Unused calls/day on the needed tier, or null when no tier fits. */
  headroom: number | null;
  /** Next tier up from the needed tier, or null at the top / when none fits. */
  nextTier: QuotaTierRow | null;
  /** True when the calls exceed even the Team quota (100,000/day). */
  exceedsMax: boolean;
}

/**
 * Name the tier for an expected daily call volume. Family shares
 * Premium's 10,000/day quota, so Premium (the smaller tier) is
 * named first — Family is never "needed" for quota alone.
 */
export function calculateQuotaTier(callsPerDay: number): QuotaCalculation {
  // Skip Family when searching for the smallest fitting tier: it
  // has the same quota as Premium, so Premium always wins on size.
  const fitting = QUOTA_TIERS.filter(
    (t) => t.id !== 'family' && callsPerDay <= t.quota
  );
  const neededTier = fitting[0] ?? null;
  if (!neededTier) {
    return {
      callsPerDay,
      neededTier: null,
      headroom: null,
      nextTier: null,
      exceedsMax: true,
    };
  }
  const idx = QUOTA_TIERS.indexOf(neededTier);
  const nextTier = QUOTA_TIERS.slice(idx + 1).find((t) => t.quota > neededTier.quota) ?? null;
  return {
    callsPerDay,
    neededTier,
    headroom: neededTier.quota - callsPerDay,
    nextTier,
    exceedsMax: false,
  };
}
