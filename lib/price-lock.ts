/**
 * Price-lock guarantee — S5#17 (env-gated wiring, dormant by default).
 *
 * The promise: a Premium/Family/Team member who buys through a
 * SmartBuy deal at the shown price is covered if the same retailer
 * listing drops within the guarantee window — the difference is
 * credited back. The guarantee window (30 days) is a program rule
 * stated here, not a measured value.
 *
 * DORMANT UNTIL STRIPE IS CONFIGURED: this module never charges,
 * refunds, or calls Stripe. `requestPriceLock` only reports status:
 * - Stripe not configured (or PRICE_LOCK_ENABLED is not 'true') →
 *   { status: 'dormant', ... } — the feature is off, honestly.
 * - Stripe configured + enabled → { status: 'requires_checkout', ... }
 *   — the Stripe Checkout / refund wiring is wave 2 (needs the
 *   owner's Stripe price IDs and payout decision). No lock is ever
 *   claimed as active before that wiring exists.
 *
 * This module does NOT edit lib/stripe.ts (owned by another worker);
 * it only reads `isStripeConfigured()` from it.
 */

import { isStripeConfigured } from '@/lib/stripe';
import { isPriceLockIncluded, type TierId } from '@/lib/tiers';

/** Guarantee window in days — program rule, stated not measured. */
export const PRICE_LOCK_GUARANTEE_DAYS = 30;

export type PriceLockStatus = 'dormant' | 'requires_checkout';

export interface PriceLockConfig {
  enabled: boolean;
  stripeConfigured: boolean;
  guaranteeDays: number;
  eligibleTiers: TierId[];
}

export function getPriceLockConfig(): PriceLockConfig {
  const enabled = process.env.PRICE_LOCK_ENABLED === 'true';
  return {
    enabled,
    stripeConfigured: isStripeConfigured(),
    guaranteeDays: PRICE_LOCK_GUARANTEE_DAYS,
    eligibleTiers: ['premium', 'family', 'team'],
  };
}

/**
 * Pure eligibility check: tier must include price-lock and the price
 * must be a positive finite amount. Says nothing about Stripe.
 */
export function evaluatePriceLock(input: {
  tierId: TierId;
  priceCents: number;
}): { eligible: boolean; reason: string } {
  if (!isPriceLockIncluded(input.tierId)) {
    return { eligible: false, reason: 'Price-lock is not included in the Free tier.' };
  }
  if (!Number.isFinite(input.priceCents) || input.priceCents <= 0) {
    return { eligible: false, reason: 'A valid price is required for a price lock.' };
  }
  return {
    eligible: true,
    reason: `Eligible — covered for ${PRICE_LOCK_GUARANTEE_DAYS} days once price-lock is active.`,
  };
}

export interface PriceLockRequest {
  status: PriceLockStatus;
  eligible: boolean;
  reason: string;
  guaranteeDays: number;
}

/**
 * Request a price lock. Never creates a charge, a refund, or a
 * Stripe object — it reports whether the feature can run at all.
 * Until Stripe is configured and PRICE_LOCK_ENABLED=true, every
 * request is honestly 'dormant'.
 */
export function requestPriceLock(input: { tierId: TierId; priceCents: number }): PriceLockRequest {
  const evaluation = evaluatePriceLock(input);
  const config = getPriceLockConfig();
  if (!evaluation.eligible) {
    return {
      status: 'dormant',
      eligible: false,
      reason: evaluation.reason,
      guaranteeDays: PRICE_LOCK_GUARANTEE_DAYS,
    };
  }
  if (!config.stripeConfigured || !config.enabled) {
    return {
      status: 'dormant',
      eligible: true,
      reason:
        'Price-lock is not active yet — Stripe is not configured or PRICE_LOCK_ENABLED is not set. No lock is in force.',
      guaranteeDays: PRICE_LOCK_GUARANTEE_DAYS,
    };
  }
  return {
    status: 'requires_checkout',
    eligible: true,
    reason:
      'Price-lock is enabled — the Stripe checkout wiring that issues a lock is still to be connected.',
    guaranteeDays: PRICE_LOCK_GUARANTEE_DAYS,
  };
}
