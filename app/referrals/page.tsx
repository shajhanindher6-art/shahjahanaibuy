/**
 * Referrals explainer (Section 14, chunk 9) — /referrals.
 *
 * How referrals actually work, from lib/referral.ts and the
 * /api/v1/referrals routes — nothing more:
 * - A link is `/?ref=sb-` + 10 lowercase alphanumerics. The code is
 *   random and never contains a user id, email, or any personal data.
 * - One link per owner: signed-in users are keyed by account, guests
 *   by a browser token.
 * - Clicks are counted only. No IP address or user agent is stored,
 *   and there is NO signup attribution — SmartBuy cannot tell whether
 *   a click became a sign-up, so no "X friends joined" figure is ever
 *   shown anywhere.
 * - Referral clicks earn NO points. Points and badges come only from
 *   verified deals shared as a creator (10 points per verified deal);
 *   no code awards points for referral clicks, and this page does not
 *   pretend otherwise. Rewards are non-monetary: there is no cash,
 *   credit, or payout for referrals.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Share2 } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { LocalizedHeading } from '@/components/i18n/localized-heading';
import { appConfig } from '@/lib/config/app';
import { ReferralLinkCard } from '@/components/referrals/referral-link-card';

export const metadata: Metadata = {
  title: 'Referrals — SmartBuy AI',
  description:
    'How SmartBuy referrals work: one shareable link per account, clicks counted only, no signup tracking, no cash rewards — points and badges come from verified deals, not referrals.',
  alternates: {
    canonical: `${appConfig.url}/referrals`,
  },
  openGraph: {
    title: 'Referrals — SmartBuy AI',
    description:
      'How SmartBuy referrals work: one shareable link per account, clicks counted only, no signup tracking, no cash rewards.',
    url: `${appConfig.url}/referrals`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Referrals — SmartBuy AI',
    description:
      'How SmartBuy referrals work: one shareable link per account, clicks counted only, no signup tracking, no cash rewards.',
  },
};

export default function ReferralsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Referrals"
        description="How SmartBuy referrals work: one shareable link per account, clicks counted only, no signup tracking, no cash rewards — points and badges come from verified deals, not referrals."
        path="/referrals"
        crumbs={[ { name: "Home", path: "/" }, { name: "Referrals" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <LocalizedHeading
              dictKey="footerLinkReferrals"
              className="flex items-center gap-2 text-3xl font-bold"
              icon={<Share2 className="h-7 w-7 text-blue-600" />}
            />
            <p className="mt-2 text-muted-foreground">
              Share SmartBuy with a link, and see how many people clicked it. That is the whole
              program: clicks counted, nothing else claimed.
            </p>
          </div>

          <ReferralLinkCard />

          <div className="rounded-lg border p-6">
            <h2 className="text-lg font-semibold">How it works</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                Get your link above. It looks like{' '}
                <code className="rounded bg-muted px-1">smartbuy.ai/?ref=sb-xxxxxxxxxx</code>{' '}
                — the code is random and contains no personal data: no user id, no email,
                nothing about you.
              </li>
              <li>
                Share the link anywhere. Each visit through it counts as one click on your link.
              </li>
              <li>
                Your click count is public in aggregate only — anyone can look up a code&apos;s
                click count, but the lookup never reveals who owns the link.
              </li>
            </ol>
          </div>

          <div className="rounded-lg border p-6">
            <h2 className="text-lg font-semibold">What is counted — and what is not</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                Counted: clicks on your link. Nothing else. No IP address or user agent is
                stored with a click.
              </li>
              <li>
                Not counted, because it is not tracked: whether a click became a sign-up. There
                is no signup attribution, so SmartBuy never shows &ldquo;X friends
                joined&rdquo; — any such figure would be invented.
              </li>
              <li>
                One link per owner: signed-in users get one link per account, guests get one
                per browser. Creating a second link does not create a second count — the
                existing link is returned instead.
              </li>
            </ul>
          </div>

          <div className="rounded-lg border p-6">
            <h2 className="text-lg font-semibold">Rewards: points and badges only — and not for referrals</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              There is no cash, credit, or payout for referrals — rewards on SmartBuy are
              non-monetary. And referral clicks themselves earn no points: points and badges
              come only from verified deals you share as a creator — 10 points per verified
              deal, Bronze at 1 verified deal, Silver at 5, Gold at 15, Platinum at 30. If
              you want to earn, share a deal that can be verified; if you want to share,
              share your link.
            </p>
            <p className="mt-3 text-sm">
              <Link href="/creators" className="font-medium text-blue-600 hover:underline">
                See how the creator program works →
              </Link>
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
