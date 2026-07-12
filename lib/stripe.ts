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
