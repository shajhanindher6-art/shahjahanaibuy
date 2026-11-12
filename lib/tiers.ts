/**
 * Premium tiers 2.0 — S5#17 (pure definitions, no I/O).
 *
 * Free / Premium / Family / Team. Premium's "$9.99/month" is the
 * PLANNED price label, not a live charge (Section 15 P2-5:
 * priceStatus 'planned', availability 'planned' — payments are not
 * live yet, Stripe is in test mode). The $4.99-vs-$9.99 price
 * decision (Section 2, item 25) is still open with the owner, so
 * no other tier price is invented here:
 * - Family: price "To be announced" (owner decision pending).
 * - Team: "Custom" / contact sales (same as the homepage Business tier).
 *
 * Price-lock and concierge are tier features, not data claims:
 * price-lock is wired env-gated in lib/price-lock.ts (dormant until
 * Stripe is configured) and concierge is human help for large
 * purchases on the Team tier.
 */

export type TierId = 'free' | 'premium' | 'family' | 'team';

export type TierPriceStatus = 'live' | 'planned' | 'to_be_announced' | 'custom';
export type TierAvailability = 'available' | 'planned' | 'custom';

export interface TierDefinition {
  id: TierId;
  name: string;
  priceLabel: string;
  period: string;
  priceStatus: TierPriceStatus;
  availability: TierAvailability;
  description: string;
  features: string[];
  cta: string;
  href: string;
  highlighted: boolean;
  /**
   * Maximum signed-in price alerts on this tier (`null` = unlimited).
   * Section 15 B14: the Free cap is 5 — canonical per the Section 12
   * decision (lib/tiers.ts is the canonical source; the billing copy
   * "Up to 5 price alerts" agrees). Premium / Family / Team advertise
   * "Unlimited price alerts" (Family and Team via "Everything in
   * Premium"), so they are `null`. This is the SIGNED-IN tier cap —
   * it is unrelated to MAX_LOCAL_ALERTS (20) in lib/local-alerts.ts,
   * which caps the guest localStorage store only.
   */
  maxAlerts: number | null;
}

export const TIERS: TierDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    priceLabel: '$0',
    period: 'forever',
    priceStatus: 'live',
    availability: 'available',
    description: 'Perfect for getting started with smarter shopping.',
    features: ['Basic search', 'Up to 5 price alerts', 'Community support'],
    cta: 'Get Started',
    href: '/sign-up',
    highlighted: false,
    maxAlerts: 5,
  },
  {
    id: 'premium',
    name: 'Premium',
    priceLabel: '$9.99',
    period: 'per month',
    // Section 15 P2-5: 'planned', not 'live' — the $9.99 label is
    // the planned price; payments are not live yet (Stripe test
    // mode), so nothing is chargeable today. availabilityLabel()
    // renders this as "Planned — price to be announced".
    priceStatus: 'planned',
    availability: 'planned',
    description: 'Unlock the full power of AI-driven shopping intelligence.',
    features: [
      'Unlimited price alerts',
      'AI recommendations',
      'Review analysis',
      'Price prediction',
      'Price-lock guarantee on eligible deals',
      'Priority support',
    ],
    // Section 12: no trial exists (no trial terms defined anywhere),
    // so the Premium CTA must not promise one. It points at the
    // canonical /pricing page, which states payments aren't live yet.
    cta: 'See Premium plans',
    href: '/pricing',
    highlighted: true,
    // "Unlimited price alerts" (see features above).
    maxAlerts: null,
  },
  {
    id: 'family',
    name: 'Family',
    priceLabel: 'To be announced',
    period: '',
    priceStatus: 'to_be_announced',
    availability: 'planned',
    description: 'Share SmartBuy with your household — one plan, everyone covered.',
    features: [
      'Everything in Premium, for up to 5 members',
      'Shared wishlists and price alerts',
      'Price-lock guarantee on eligible deals',
      'Family deal digest',
    ],
    cta: 'Email us about Family',
    href: '/contact',
    highlighted: false,
    // "Everything in Premium" → unlimited price alerts.
    maxAlerts: null,
  },
  {
    id: 'team',
    name: 'Team',
    priceLabel: 'Custom',
    period: 'contact us',
    priceStatus: 'custom',
    availability: 'custom',
    description: 'For teams and businesses that need advanced capabilities.',
    features: [
      'Everything in Premium',
      'API access',
      'Team management',
      'Price-lock guarantee on eligible deals',
      'Concierge help for large purchases',
      'Dedicated support',
    ],
    cta: 'Contact Sales',
    href: '/contact',
    highlighted: false,
    // "Everything in Premium" → unlimited price alerts.
    maxAlerts: null,
  },
];

export function getTier(id: TierId): TierDefinition | null {
  return TIERS.find((t) => t.id === id) ?? null;
}

/**
 * Normalize a stored / incoming plan key onto a TierId
 * (Section 15 P2-2). The old Stripe/checkout plan key was 'pro';
 * it maps onto 'premium' for one release so legacy `subscriptions`
 * rows and old checkout calls keep working. Unknown values fail
 * closed to `fallback` ('free' by default) — a lookup failure
 * must never grant a paid tier.
 */
export function normalizeTierId(value: unknown, fallback: TierId = 'free'): TierId {
  if (value === 'pro') return 'premium';
  if (value === 'free' || value === 'premium' || value === 'family' || value === 'team') {
    return value;
  }
  return fallback;
}

/**
 * Signed-in price-alert cap for a tier (`null` = unlimited).
 * Unknown tier ids fail closed to the Free cap (5) — a lookup
 * failure must never grant unlimited alerts.
 */
export function getMaxAlerts(tierId: TierId): number | null {
  const tier = getTier(tierId);
  // Unknown tier → fail closed to the Free cap. `null` is a real
  // value (unlimited), so it must NOT fall through to the default.
  if (!tier) return 5;
  return tier.maxAlerts;
}

/** True when `currentCount` alerts already reach the tier's cap. */
export function isAlertCapReached(tierId: TierId, currentCount: number): boolean {
  const max = getMaxAlerts(tierId);
  return max !== null && currentCount >= max;
}

/** Tiers that include the price-lock guarantee (see lib/price-lock.ts). */
export function isPriceLockIncluded(tierId: TierId): boolean {
  return tierId === 'premium' || tierId === 'family' || tierId === 'team';
}

/** Tiers that include concierge help for large purchases. */
export function isConciergeIncluded(tierId: TierId): boolean {
  return tierId === 'team';
}

/** Display label for a tier's availability state. */
export function availabilityLabel(tier: TierDefinition): string {
  if (tier.availability === 'planned') return 'Planned — price to be announced';
  if (tier.availability === 'custom') return 'Custom pricing';
  return 'Available now';
}
