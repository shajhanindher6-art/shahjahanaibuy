/**
 * Cookie-consent choice, shared by the consent banner and PostHog.
 *
 * The banner (components/privacy/cookie-consent.tsx) writes this key
 * whenever the visitor accepts or rejects analytics. Anything that
 * sets a non-essential cookie (PostHog) must read it first.
 */
export type AnalyticsConsent = 'granted' | 'denied' | 'unknown';

const KEY = 'sb-consent-analytics';

export function getAnalyticsConsent(): AnalyticsConsent {
  if (typeof window === 'undefined') return 'unknown';
  const v = window.localStorage.getItem(KEY);
  return v === 'granted' || v === 'denied' ? v : 'unknown';
}

export function setAnalyticsConsent(value: 'granted' | 'denied'): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, value);
  window.dispatchEvent(new Event('sb-consent-changed'));
}
