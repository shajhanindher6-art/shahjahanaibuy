/**
 * Content Security Policy (nonce-based, Phase 2).
 *
 * One fresh nonce per request (generated in middleware.ts, carried
 * to the page render as the `x-nonce` request header and back to the
 * browser in the CSP response header). Next.js applies that nonce to
 * its own inline scripts; the two JSON-LD script tags get it
 * explicitly (root layout via headers(), product page via
 * NonceContext in components/csp-nonce-context.tsx).
 *
 * What changed vs the old static policy:
 * - script-src: NO 'unsafe-inline', NO 'unsafe-eval'. Only
 *   same-origin scripts and scripts carrying this request's nonce.
 *   (The eval('require') calls in lib/workers/queue.ts are
 *   server-side only — CSP does not apply to them.)
 * - style-src: KEEPS 'unsafe-inline'. React renders style={{...}}
 *   props as style ATTRIBUTES, and CSP has no nonce mechanism for
 *   style attributes — removing it would break inline styles (e.g.
 *   the dashboard's staggered animation delays). This matches the
 *   official Next.js strict-CSP example.
 */

import { getGa4Id, getMetaPixelId } from '@/components/providers/analytics-config';

export function buildCsp(nonce: string): string {
  // PostHog analytics host (P0 fix, 2026-11-09 audit): the configured
  // api_host when set, else the default US cloud host. Without this
  // origin in connect-src the browser silently blocks every PostHog
  // event even though the key is set and consent was granted.
  const posthogHost = (
    process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'
  ).replace(/\/$/, '');
  // GA4 + Meta Pixel (Section 3 item 16): vendor hosts are allowed
  // ONLY when the matching env ID is set and valid — while dormant
  // (no ID, the state on every environment today) the policy stays
  // exactly as tight as before. The provider
  // (components/providers/analytics-provider.tsx) applies the same
  // gate plus cookie-consent gating, so a host here never means
  // tracking runs without consent.
  const scriptSrcHosts: string[] = [];
  const connectSrcHosts: string[] = [];
  if (getGa4Id()) {
    scriptSrcHosts.push('https://www.googletagmanager.com');
    connectSrcHosts.push(
      'https://www.google-analytics.com',
      'https://region1.google-analytics.com'
    );
  }
  if (getMetaPixelId()) {
    scriptSrcHosts.push('https://connect.facebook.net');
    connectSrcHosts.push(
      'https://www.facebook.com',
      'https://graph.facebook.com'
    );
  }
  // img-src already allows https: everywhere, which covers the
  // Meta Pixel noscript image and GA4 beacons.
  // Section 20, §12 #94 — `data:` was removed from img-src: no
  // data: image exists anywhere in the tree (grep: zero hits in
  // app/ components/ lib/ services/), and review-time image
  // validation (lib/image-url.ts) rejects data: URLs before they
  // can be stored, so dropping it cannot break a surface.
  // `https:` stays open deliberately: product images are
  // merchant hotlinks (eBay, Unsplash, Pexels, ...) with no
  // known host list (Section 18 item 39 still blocked), so a
  // host allowlist here would break real product images.
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${scriptSrcHosts.length ? ` ${scriptSrcHosts.join(' ')}` : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'img-src \'self\' blob: https:',
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src 'self' https://*.supabase.co https://*.supabase.in https://*.ingest.sentry.io ${posthogHost}${connectSrcHosts.length ? ` ${connectSrcHosts.join(' ')}` : ''}`,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
