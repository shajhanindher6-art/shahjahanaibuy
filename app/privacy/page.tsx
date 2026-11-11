import type { Metadata } from 'next';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Privacy Policy — SmartBuy AI',
  description:
    'SmartBuy AI Privacy Policy (draft for owner review): what is collected, how it is used, and what stays on your own device.',
  alternates: {
    canonical: `${appConfig.url}/privacy`,
  },
};

/**
 * Privacy Policy — DRAFT for owner review before launch (see the
 * note at the bottom of the page). Every practice described here
 * is one the codebase actually has: Supabase email/Google auth,
 * account data + wishlists/alerts/search history in Supabase,
 * recent searches and region/language choices on the visitor's own
 * device, Resend for alert emails, VAPID web-push subscriptions,
 * SerpAPI Google Shopping for the web-search fallback (query
 * terms only), and affiliate links with anonymous click logging
 * (see "Affiliate links and click logging" below). Nothing here
 * claims a practice the code does not have, and nothing invents a
 * retention period, a data-sale claim beyond the stated policy, or
 * a jurisdiction — the owner must confirm those before relying on
 * this text.
 */
export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-3xl space-y-6 text-muted-foreground">
          <h1 className="text-3xl font-bold text-foreground">Privacy Policy</h1>
          <p className="text-sm">Last updated: November 2026</p>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">What we collect</h2>
            <p>
              <strong className="text-foreground">Account information.</strong> If you create an
              account, we store the details you provide to sign in — your email address and
              password (handled by our authentication provider, Supabase; passwords are never
              stored in plain text by SmartBuy) — or, if you sign in with Google, the basic
              profile information Google shares for sign-in. Your profile, preferences, wishlists,
              price alerts, and notification settings are stored with your account.
            </p>
            <p>
              <strong className="text-foreground">Activity you generate on the site.</strong>{' '}
              For signed-in users, searches, products viewed, and alert activity may be recorded
              so features such as recommendations, price-drop alerts, and your dashboard work.
              Guests are not tracked this way: a guest&apos;s recent searches are kept only in
              that browser&apos;s own storage (see below) and are never sent to an account.
            </p>
            <p>
              <strong className="text-foreground">Notification endpoints.</strong> If you turn on
              email alerts, we store your email address for that purpose; if you turn on push
              notifications, we store your browser&apos;s push subscription so alerts can reach
              that browser. Turning either off stops future messages to that endpoint.
            </p>
            <p>
              <strong className="text-foreground">What we do not collect from your device.</strong>{' '}
              Product photos you upload to the scanner are previewed locally in your browser and
              are never sent to or stored on our servers. Voice search uses your browser&apos;s
              built-in speech recognition; the transcript is treated like a typed search and no
              audio recording is uploaded by SmartBuy.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Stored on your device, not with us</h2>
            <p>
              Your country and language choices, your recent searches as a guest, whether you
              dismissed the region banner, and your light/dark theme preference are stored in your
              browser (local storage and cookies) so the site remembers them between visits.
              Clearing your browser storage removes them; they are not an account record we hold
              about you. A first-visit country guess from your network location may be used to
              suggest a region and currency — that guess is not stored as personal data beyond
              the country choice itself.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">How we use it</h2>
            <p>
              Your information is used to run the service you asked for: recommendations, deal
              rankings, price tracking and alerts, wishlists, and keeping your account secure. We
              do not sell your personal information. Service providers that help run the site only
              receive the data needed for their service: hosting and database (Supabase), payment
              processing for subscriptions (Stripe — card details go to Stripe, not to SmartBuy),
              alert emails (Resend), and, for the optional live web-search fallback, the search
              terms you typed (sent to SerpAPI&apos;s Google Shopping service; no account data is
              sent with them).
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Affiliate links and click logging</h2>
            <p>
              Some links to retailers may carry an affiliate tag. If you buy through such a link,
              SmartBuy may earn a commission from the retailer at no extra cost to you. The price
              you see and pay is the retailer&apos;s price; the tag does not change it. A tag is
              only added when SmartBuy has a real affiliate account configured for that retailer
              and region — with nothing configured, retailer links are plain links with no tag,
              and no commission is earned.
            </p>
            <p>
              <strong className="text-foreground">Zero-logging policy for link clicks.</strong>{' '}
              When you click a retailer Buy link, SmartBuy records one anonymous event: the
              product, the retailer name, the link clicked, and your country (from your network
              location or your saved region choice). That event is used only for aggregate
              analytics, such as which regions click which retailers. It is never linked to an
              account, and SmartBuy deliberately does <em>not</em> record your IP address, your
              browser&apos;s user-agent string, or any user identifier with it.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Prices and product data</h2>
            <p>
              Prices, availability, and product details shown on SmartBuy come from retailer
              listings, recorded price history, and other data sources, and can change at any time.
              Some catalog prices are launch/demo placeholders rather than live retailer prices;
              the retailer sets the final price and purchase terms at checkout, so always check
              them before buying. SmartBuy does not collect payment card details.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Your choices</h2>
            <p>
              You can update your profile and notification preferences from your dashboard, turn
              off email or push alerts at any time, and clear the on-device data described above
              from your browser settings. You can ask for your account and its stored data to be
              deleted by contacting support at{' '}
              <a href={`mailto:${appConfig.supportEmail}`} className="underline">
                {appConfig.supportEmail}
              </a>
              . We will confirm what was deleted and what, if anything, must be kept for legal or
              security reasons.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Security and changes</h2>
            <p>
              Account access is protected by your sign-in credentials, which you are responsible
              for keeping safe, and by the access controls of our hosting and database providers.
              No internet service is completely secure, so we cannot guarantee absolute security.
              If this policy changes in a way that affects how your data is used, the updated
              version will be posted here with a new &ldquo;Last updated&rdquo; date.
            </p>
          </section>

          <p className="border-t pt-4 text-sm">
            This policy is provided as a starting draft for the site owner to review — including
            retention periods, applicable data-protection law, any cookie-consent or
            children&apos;s-privacy requirements, and affiliate-disclosure requirements for the
            owner&apos;s jurisdiction — before it is relied on at launch.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
