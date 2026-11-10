/**
 * Premium tiers 2.0 — S5#17 (pure definitions, no I/O).
 *
 * Free / Premium / Family / Team. Premium keeps the live homepage
 * price ($9.99/month) — the $4.99-vs-$9.99 price decision (Section 2,
 * item 25) is still open with the owner, so no other tier price is
 * invented here:
 * - Family: price "To be announced" (owner decision pending).
 * - Team: "Custom" / contact sales (same as the homepage Business tier).
 *
 * Price-lock and concierge are tier features, not data claims:
 * price-lock is wired env-gated in lib/price-lock.ts (dormant until
 * Stripe is configured) and concierge is human help for large
 * purchases on the Team tier.
 */

export type TierId = 'free' | 'premium' | 'family' | 'team';

export type TierPriceStatus = 'live' | 'to_be_announced' | 'custom';
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
  },
  {
    id: 'premium',
    name: 'Premium',
    priceLabel: '$9.99',
    period: 'per month',
    priceStatus: 'live',
    availability: 'available',
    description: 'Unlock the full power of AI-driven shopping intelligence.',
    features: [
      'Unlimited price alerts',
      'AI recommendations',
      'Review analysis',
      'Price prediction',
      'Price-lock guarantee on eligible deals',
      'Priority support',
    ],
    cta: 'Start Free Trial',
    href: '/sign-up',
    highlighted: true,
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
    cta: 'Join the waitlist',
    href: '/contact',
    highlighted: false,
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
  },
];

export function getTier(id: TierId): TierDefinition | null {
  return TIERS.find((t) => t.id === id) ?? null;
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
