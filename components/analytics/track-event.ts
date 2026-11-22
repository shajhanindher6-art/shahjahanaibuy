/**
 * Central PostHog event tracker — the ONLY place custom events are
 * sent. Every call site (sign-up, sign-in, search, wishlist,
 * price-alert) goes through here, so the safety rules live in one
 * place instead of being re-implemented (and possibly forgotten) at
 * each call site.
 *
 * Safety rules (all enforced here, not at the call sites):
 * - Consent: an event is sent ONLY when analytics consent is
 *   'granted' (lib/consent). 'denied' or 'unknown' (no choice yet)
 *   means nothing is sent — the banner's reject path is honoured.
 * - Initialized: an event is sent ONLY when the existing PostHog
 *   client has been initialized (isPosthogInitialized). This helper
 *   never calls posthog.init() itself, so a second instance can
 *   never be created.
 * - Fail-safe: any error (including a throwing capture) is caught
 *   and swallowed. Tracking must never interrupt the user's action
 *   or break the page. The helper returns void and never throws.
 * - Privacy: the `EventProps` type only allows the approved
 *   property keys. A call site cannot pass an email, password,
 *   token, raw query, user id or product id — TypeScript rejects
 *   those keys at compile time. Values are still the call site's
 *   responsibility (e.g. never put a raw query into `search_type`),
 *   and the tests pin the approved fields per event.
 *
 * Page views are NOT sent through this helper — the provider's
 * `capture_pageview: true` already handles those.
 */

import posthog from 'posthog-js';
import { getAnalyticsConsent } from '@/lib/consent';
import { isPosthogInitialized } from './posthog-provider';

export type PostHogEventName =
  | 'user_signed_up'
  | 'user_logged_in'
  | 'product_searched'
  | 'product_added_to_wishlist'
  | 'price_alert_created';

/**
 * The complete set of approved event properties across the five
 * events. Every key is optional; a call site passes only the keys
 * its event allows (see the per-event comments at the call sites).
 * No other key can be passed — that is the compile-time privacy
 * guard. Values are primitives only (no objects, no arrays).
 */
export type EventProps = {
  /** Auth method, when reliably known: 'email' (Google is not tracked — see the plan). */
  method?: 'email' | 'google';
  /** Always true on the success path; never sent on a failure path (failures are not tracked). */
  success?: boolean;
  /** Number of results the search returned (the API's filtered total, falling back to the page rows). */
  results_count?: number;
  /** Product-search category, when available as a safe predefined value. Never a raw query. */
  search_type?: string;
  /** Product category, when available and non-sensitive. Never a product id. */
  product_category?: string;
  /** Page / UI location the action came from, when reliably known (e.g. 'product_page', 'search_results'). */
  source?: string;
  /** Alert currency, when available. */
  currency?: string;
  /** Price-alert type, as a predefined safe value (e.g. 'price_drop'). */
  alert_type?: string;
};

export function trackEvent(name: PostHogEventName, props?: EventProps): void {
  try {
    if (getAnalyticsConsent() !== 'granted') return;
    if (!isPosthogInitialized()) return;
    posthog.capture(name, props);
  } catch {
    // Tracking must never interrupt the user's action.
    return;
  }
}
