'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import { getAnalyticsConsent } from '@/lib/consent';

/**
 * PostHog product analytics — dormant until TWO things are true:
 * 1. the owner created a PostHog account and set NEXT_PUBLIC_POSTHOG_KEY
 *    in Vercel (no key → this component does nothing), and
 * 2. the visitor accepted analytics in the cookie-consent banner
 *    (sb-consent-analytics === 'granted').
 *
 * Consent granted after this component mounted is picked up via the
 * sb-consent-changed event, so no page reload is needed.
 */
let initialized = false;

function tryInit(): void {
  if (initialized) return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  if (getAnalyticsConsent() !== 'granted') return;
  posthog.init(key, {
    api_host:
      process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    capture_pageview: true,
    persistence: 'localStorage',
  });
  initialized = true;
}

export default function PostHogProvider() {
  useEffect(() => {
    tryInit();
    window.addEventListener('sb-consent-changed', tryInit);
    return () => window.removeEventListener('sb-consent-changed', tryInit);
  }, []);

  return null;
}
