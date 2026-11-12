/**
 * Single pricing config module (Section 15, P2-1 + P2-7).
 *
 * ONE place owns every Stripe price decision. Everything else —
 * services/stripe.ts, the checkout route, the billing page, the
 * pricing page — reads from here and never hardcodes a dollar
 * figure as a chargeable price.
 *
 * Rules (audit P2-1/P2-7):
 * - Every price ID comes from env and is nullable. An unset ID
 *   means that tier cannot be bought — never a hardcoded amount.
 * - `STRIPE_PREMIUM_PRICE_ID` is the current name;
 *   `STRIPE_PRO_PRICE_ID` is kept as a deprecated alias (env.ts
 *   prefers the new name when both are set).
 * - `getPriceDisplay` returns a *planned* label derived from
 *   lib/tiers.ts, never a hardcoded dollar figure presented as a
 *   live charge. The planned price label lives in lib/tiers.ts;
 *   whether it is actually chargeable is `isPurchasable`.
 * - `isPurchasable` = price ID set AND the live launch approved
 *   (`STRIPE_LIVE_LAUNCHED=true`). Test-mode checkout still works
 *   through the checkout route's own guard; this flag is about
 *   *live* purchasability only.
 * - Starter / trial (P2-7) is a CONFIGURABLE option, OFF by
 *   default, never a live claim: `STRIPE_STARTER_PRICE_ID` unset
 *   means no Starter plan exists; `STRIPE_TRIAL_DAYS` defaults to
 *   0 (no trial). The live price decision stays the owner's — no
 *   amount is decided here.
 *
 * SERVER ONLY — reads server env vars (never NEXT_PUBLIC_*), so
 * never import this module from a client component.
 */

import { env } from '@/lib/config/env';
import { isStripeLiveLaunchApproved } from '@/lib/stripe';
import { getTier, normalizeTierId, type TierId } from '@/lib/tiers';

/** Tiers that can be bought through Stripe Checkout. */
export type PurchasableTierId = 'premium' | 'family' | 'team';

/**
 * Stripe price IDs, from env. All nullable — an unset ID means
 * that tier has no configured price and cannot be bought.
 */
export const PRICE_IDS: Record<PurchasableTierId | 'starter', string | null> = {
  premium: env.stripePremiumPriceId ?? null,
  family: env.stripeFamilyPriceId ?? null,
  team: env.stripeTeamPriceId ?? null,
  starter: env.stripeStarterPriceId ?? null,
};

/** Stripe price ID for a purchasable tier (or Starter), or null. */
export function getPriceIdForTier(tier: PurchasableTierId | 'starter'): string | null {
  return PRICE_IDS[tier];
}

/**
 * Display label for a tier's price. Derived from the tier
 * definition in lib/tiers.ts — the label there is the *planned*
 * price, so while the plan is not purchasable the label is
 * always qualified as planned, never presented as a live charge.
 * Free is the only tier whose price is live today.
 */
export function getPriceDisplay(tier: TierId): string {
  const def = getTier(tier);
  if (!def) return 'Price to be announced';
  const label = def.period ? `${def.priceLabel} ${def.period}` : def.priceLabel;
  if (tier === 'free') return label;
  return isPurchasable(tier as PurchasableTierId)
    ? label
    : `${label} — planned price, not a live charge`;
}

/**
 * Display label for the optional Starter plan. Starter is not a
 * TierId (it is config-only — see below), so it has no tier
 * definition and no amount is ever stated: the price ID alone
 * does not tell us the amount, and no dollar figure is invented.
 */
export function getStarterPriceDisplay(): string {
  return 'Price set by the owner — planned, not a live charge';
}

/**
 * True when a tier can actually be bought live: its Stripe price
 * ID is configured AND the owner has approved the live launch.
 * Free is never "purchasable" (it costs nothing); Starter follows
 * the same rule as the paid tiers.
 */
export function isPurchasable(tier: PurchasableTierId | 'starter'): boolean {
  return PRICE_IDS[tier] !== null && isStripeLiveLaunchApproved();
}

/**
 * Free-trial length in days (P2-7). `STRIPE_TRIAL_DAYS`, default
 * 0 = no trial. Non-numeric or negative values fail closed to 0.
 * Only ever honoured when > 0 AND the live launch is approved —
 * see services/stripe.ts.
 */
export function getTrialDays(): number {
  const raw = env.stripeTrialDays;
  if (raw === undefined) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

/** True when a trial is actually offered (trial days > 0 + launch approved). */
export function isTrialOffered(): boolean {
  return getTrialDays() > 0 && isStripeLiveLaunchApproved();
}

/** True when the optional Starter plan exists (its price ID is set). */
export function isStarterConfigured(): boolean {
  return PRICE_IDS.starter !== null;
}

/**
 * Normalize a stored / incoming plan key onto a TierId.
 * Legacy 'pro' (the old Stripe/checkout plan key) maps to
 * 'premium' for one release; unknown values fail closed to the
 * `fallback` ('free' by default). Re-exported here so checkout
 * and webhook code share one mapping with lib/tiers.ts.
 */
export function normalizePlanKey(value: unknown, fallback: TierId = 'free'): TierId {
  return normalizeTierId(value, fallback);
}
