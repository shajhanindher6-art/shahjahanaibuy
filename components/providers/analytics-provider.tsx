'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { getAnalyticsConsent } from '@/lib/consent';
import { getGa4Id, getMetaPixelId } from './analytics-config';

/**
 * GA4 + Meta Pixel (Section 3 item 16).
 *
 * Dormant until THREE things are true — the same consent model as
 * the PostHog provider (components/analytics/posthog-provider.tsx):
 * 1. the owner set NEXT_PUBLIC_GA4_ID and/or
 *    NEXT_PUBLIC_META_PIXEL_ID in Vercel (no ID → that vendor
 *    loads nothing), and
 * 2. the visitor accepted analytics in the cookie-consent banner
 *    (sb-consent-analytics === 'granted' — see lib/consent.ts),
 * 3. the ID passes validation (analytics-config.ts); a malformed
 *    value is treated as unset, never injected into a script.
 *
 * Consent granted after mount is picked up via the
 * `sb-consent-changed` event, so no reload is needed. No tracking
 * runs without analytics consent — ever.
 *
 * CSP: the vendor hosts are added to lib/csp.ts ONLY when the
 * matching ID is set, so the policy stays tight while dormant.
 * The inline Meta Pixel snippet carries this request's nonce
 * (from the root layout, via the `nonce` prop).
 *
 * Privacy: GA4 is configured with IP anonymization
 * (`anonymize_ip: true`). No user IDs, emails, or product-view
 * details are sent — only page views.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

export function AnalyticsProvider({ nonce }: { nonce?: string | null }) {
  const pathname = usePathname();
  const [consented, setConsented] = useState(false);
  const ga4Initialized = useRef(false);
  const pixelInitialized = useRef(false);

  const ga4Id = getGa4Id();
  const pixelId = getMetaPixelId();

  useEffect(() => {
    const sync = () => setConsented(getAnalyticsConsent() === 'granted');
    sync();
    window.addEventListener('sb-consent-changed', sync);
    return () => window.removeEventListener('sb-consent-changed', sync);
  }, []);

  // SPA page views on route change (after the initial config).
  useEffect(() => {
    if (!consented) return;
    if (ga4Id && ga4Initialized.current && window.gtag) {
      window.gtag('config', ga4Id, { page_path: pathname, anonymize_ip: true });
    }
    if (pixelId && pixelInitialized.current && window.fbq) {
      window.fbq('track', 'PageView');
    }
  }, [pathname, consented, ga4Id, pixelId]);

  if (!consented) return null;

  return (
    <>
      {ga4Id && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga4Id}`}
            strategy="afterInteractive"
            nonce={nonce ?? undefined}
            onLoad={() => {
              window.dataLayer = window.dataLayer || [];
              window.gtag = window.gtag || function (...args: unknown[]) {
                window.dataLayer?.push(args);
              };
              window.gtag('js', new Date());
              window.gtag('config', ga4Id, { anonymize_ip: true });
              ga4Initialized.current = true;
            }}
          />
        </>
      )}
      {pixelId && (
        <Script
          id="meta-pixel"
          strategy="afterInteractive"
          nonce={nonce ?? undefined}
          onLoad={() => {
            pixelInitialized.current = true;
          }}
        >
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '${pixelId}');fbq('track', 'PageView');`}
        </Script>
      )}
    </>
  );
}
