/**
 * Client-side affiliate click beacon — Phase 3 Prep / Step B.
 *
 * One shared helper for every Buy/search link on the site (product
 * page, gifts, arbitrage table). Fire-and-forget: navigator.sendBeacon
 * never blocks navigation, and failures are silent by design.
 *
 * No location, IP, or user id is ever sent — the server derives the
 * country from its own geo signal (see /api/v1/affiliate/geo-click).
 * The payload is the merchant link the shopper actually opened.
 */

export interface AffiliateClickPayload {
  productId?: string | null;
  productSlug?: string | null;
  merchantName?: string | null;
  targetUrl: string;
}

export function trackAffiliateClick(payload: AffiliateClickPayload): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
      return;
    }
    navigator.sendBeacon(
      '/api/v1/affiliate/geo-click',
      new Blob(
        [
          JSON.stringify({
            productId: payload.productId ?? null,
            productSlug: payload.productSlug ?? null,
            merchantName: payload.merchantName ?? null,
            targetUrl: payload.targetUrl,
          }),
        ],
        { type: 'application/json' }
      )
    );
  } catch {
    // Silent by design — tracking must never disturb navigation.
  }
}
