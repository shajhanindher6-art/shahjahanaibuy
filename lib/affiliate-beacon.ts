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

/**
 * Wrap an outbound merchant URL in the /go redirect hub (Section 15,
 * A6). Pure string builder — no network, no navigation side effect.
 * The destination is preserved exactly: it travels as one encoded
 * `u` query param, and /go redirects to it byte-for-byte after
 * host validation. Optional `s` (product slug) and `m` (merchant
 * name) are the same tracking context the client beacon used to
 * send; /go records them server-side instead, so callers routing
 * through /go must NOT also fire trackAffiliateClick for the same
 * click (that would double-count it).
 */
export function buildGoUrl(
  targetUrl: string,
  opts?: { productSlug?: string | null; merchantName?: string | null }
): string {
  const params = new URLSearchParams();
  params.set('u', targetUrl);
  if (opts?.productSlug) params.set('s', opts.productSlug);
  if (opts?.merchantName) params.set('m', opts.merchantName);
  return `/go?${params.toString()}`;
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
