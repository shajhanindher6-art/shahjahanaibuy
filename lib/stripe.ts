/**
 * Stripe server-side client.
 * Lazily initialized — only activates when STRIPE_SECRET_KEY is set.
 * In test mode, uses test keys; in live mode, uses live keys.
 */

import Stripe from 'stripe';
import { env } from '@/lib/config/env';

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!env.stripeSecretKey) return null;
  if (!stripeInstance) {
    stripeInstance = new Stripe(env.stripeSecretKey, {
      apiVersion: '2023-10-16',
      typescript: true,
    });
  }
  return stripeInstance;
}

export function isStripeConfigured(): boolean {
  return !!env.stripeSecretKey;
}

export function isStripeLiveMode(): boolean {
  return env.stripeSecretKey?.startsWith('sk_live_') ?? false;
}

/**
 * Deliberate live-launch approval (S2#11).
 *
 * A bare `sk_live_` key must NEVER enable real charges on its own:
 * live mode only counts as launched when the owner explicitly sets
 * `STRIPE_LIVE_LAUNCHED=true` in the hosting dashboard as part of a
 * deliberate launch. Read directly from process.env (not env.ts) so
 * this guard works even if the env layer is not extended — a future
 * cleanup may move the flag into lib/config/env.ts.
 */
export function isStripeLiveLaunchApproved(): boolean {
  return process.env.STRIPE_LIVE_LAUNCHED === 'true';
}

/**
 * True when a live secret key is configured but the launch has not
 * been deliberately approved. Checkout and portal routes must refuse
 * in this state (503 + loud log) — never silently take real money.
 * Test mode is never blocked by this guard.
 */
export function isStripeLiveModeBlocked(): boolean {
  return isStripeLiveMode() && !isStripeLiveLaunchApproved();
}
