'use client';

import { useEffect, useRef } from 'react';
import * as CookieConsent from 'vanilla-cookieconsent';
import 'vanilla-cookieconsent/dist/cookieconsent.css';
import { setAnalyticsConsent } from '@/lib/consent';

/**
 * Cookie-consent banner (vanilla-cookieconsent v3).
 *
 * Two categories only, and honest about each:
 * - necessary (read-only, always on): the sb-country / sb-language
 *   cookies that remember the visitor's region and language.
 * - analytics: anonymous usage statistics. Vercel Analytics is
 *   cookie-free so it needs no consent; PostHog only runs when this
 *   category is accepted (see components/analytics/posthog-provider).
 * No advertising cookies exist on this site.
 *
 * The choice is stored by the library itself (cc_cookie) and mirrored
 * to localStorage (sb-consent-analytics) so PostHog can gate on it.
 */
export default function CookieConsentBanner() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const syncChoice = () => {
      setAnalyticsConsent(
        CookieConsent.acceptedCategory('analytics') ? 'granted' : 'denied'
      );
    };

    CookieConsent.run({
      guiOptions: {
        consentModal: { layout: 'box', position: 'bottom left' },
        preferencesModal: { layout: 'box' },
      },
      categories: {
        necessary: { readOnly: true },
        analytics: {},
      },
      language: {
        default: 'en',
        translations: {
          en: {
            consentModal: {
              title: 'We use cookies',
              description:
                'SmartBuy uses strictly necessary cookies to remember your country and language, and — only if you agree — analytics cookies that help us understand how the site is used. There are no advertising cookies.',
              acceptAllBtn: 'Accept all',
              acceptNecessaryBtn: 'Reject all',
              showPreferencesBtn: 'Manage preferences',
            },
            preferencesModal: {
              title: 'Cookie preferences',
              acceptAllBtn: 'Accept all',
              acceptNecessaryBtn: 'Reject all',
              savePreferencesBtn: 'Save preferences',
              closeIconLabel: 'Close',
              sections: [
                {
                  title: 'Strictly necessary',
                  description:
                    'Your country and language choices (sb-country, sb-language). Always on — the site cannot remember your region without them.',
                  linkedCategory: 'necessary',
                },
                {
                  title: 'Analytics',
                  description:
                    'Anonymous usage statistics. Vercel Analytics is cookie-free; PostHog only starts if you accept this category.',
                  linkedCategory: 'analytics',
                },
              ],
            },
          },
        },
      },
      onFirstConsent: syncChoice,
      onConsent: syncChoice,
      onChange: syncChoice,
    });
  }, []);

  return null;
}
