import type { Metadata } from 'next';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { LocalizedHeading } from '@/components/i18n/localized-heading';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Cookie Policy — SmartBuy AI',
  description:
    'Which cookies SmartBuy AI actually uses — region, language, consent, and sign-in session — and what is stored on your device instead.',
  alternates: {
    canonical: `${appConfig.url}/cookies`,
  },
};

/**
 * Cookie inventory (Section 10, chunk 2). Every row below traces
 * to code that sets the cookie — nothing is listed that the site
 * does not actually use:
 * - sb-country / sb-language: components/region/region-provider.tsx
 *   (+ middleware.ts seeds sb-country from geo detection).
 * - cc_cookie: the vanilla-cookieconsent library used by
 *   components/privacy/cookie-consent.tsx stores the visitor's
 *   consent choice under its default name.
 * - sb-…-auth-token: @supabase/ssr session cookie, written by
 *   lib/supabase/server.ts and lib/supabase/middleware.ts; the
 *   middle part is the Supabase project reference. Only set once
 *   you sign in.
 * What is deliberately NOT in this table: sb-consent-analytics
 * (localStorage, lib/consent.ts), the theme choice (localStorage,
 * next-themes), and PostHog (persistence: 'localStorage' in
 * components/analytics/posthog-provider.tsx, and dormant until a
 * key is set AND analytics consent is granted). Vercel Analytics
 * is cookie-free. There are no advertising cookies on this site.
 */
const COOKIES: Array<{ name: string; purpose: string; category: string }> = [
  {
    name: 'sb-country',
    purpose:
      'Remembers the country/region you chose (or the one detected from your visit) so prices, stores, and currency stay local. Set by the server when your region is detected and when you change it.',
    category: 'Strictly necessary',
  },
  {
    name: 'sb-language',
    purpose:
      'Remembers the language you chose for the site interface, so it stays selected on your next visit.',
    category: 'Strictly necessary',
  },
  {
    name: 'cc_cookie',
    purpose:
      'Stores your cookie-consent choice (whether you accepted analytics) so the banner does not ask again on every visit. Set by the consent banner itself.',
    category: 'Strictly necessary',
  },
  {
    name: 'sb-…-auth-token',
    purpose:
      'Keeps you signed in. Only set when you sign in with an account; guests never get this cookie. The "…" is the Supabase project reference, so the full name is sb-<project>-auth-token.',
    category: 'Strictly necessary',
  },
];

export default function CookiesPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-4 text-muted-foreground">
          <LocalizedHeading dictKey="footerLinkCookiePolicy" className="text-3xl font-bold text-foreground" />
          <p>
            SmartBuy AI uses cookies and similar storage to keep you signed in, remember
            your theme and preferences, and understand how the site is used so it can be
            improved.
          </p>
          <p>
            Essential cookies are needed for sign-in and security and cannot be switched
            off in the site itself. You can still control cookies through your browser
            settings, although blocking essential cookies may stop some features from
            working.
          </p>

          <h2 className="pt-4 text-xl font-semibold text-foreground">
            Cookies this site actually uses
          </h2>
          <p>
            This is the complete list. Every cookie below is strictly necessary — there
            are no advertising cookies, and no analytics cookie is set today.
          </p>
          <div className="space-y-3">
            {COOKIES.map((cookie) => (
              <div key={cookie.name} className="rounded-lg border p-4">
                <p className="font-medium text-foreground">
                  <code className="rounded bg-muted px-1 py-0.5 text-sm">{cookie.name}</code>
                  {' · '}
                  <span className="text-sm">{cookie.category}</span>
                </p>
                <p className="mt-1 text-sm">{cookie.purpose}</p>
              </div>
            ))}
          </div>

          <h2 className="pt-4 text-xl font-semibold text-foreground">
            Stored on your device, not as cookies
          </h2>
          <p>
            Your analytics-consent choice (<code className="rounded bg-muted px-1 py-0.5 text-xs">sb-consent-analytics</code>)
            and your theme choice are kept in your browser&apos;s local storage, not in
            cookies. PostHog product analytics also stores its data in local storage —
            and it only runs at all once the owner sets a PostHog key and you accept
            analytics in the consent banner; until then it sets nothing. Vercel
            Analytics, which counts page views, is cookie-free.
          </p>
          <p>
            If analytics or advertising cookies are added in future, this page will be
            updated to list them and explain how to opt out.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
