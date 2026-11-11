/**
 * Partners page (Section 14, chunk 9) — /partners.
 *
 * Honesty first: SmartBuy has NO partnership program today and NO
 * partners to list. There are no partner logos, no testimonials, and
 * no paid-placement offers on this page — inventing any of those
 * would be fake content. What the page does say is what kind of
 * enquiry the team will actually read (a store that wants a
 * directory listing, or a business enquiry) and what SmartBuy will
 * not do (paid placement, guaranteed promotion, invented
 * endorsements). Enquiries go to the contact page / support email.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Handshake } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Partners — SmartBuy AI',
  description:
    'SmartBuy AI has no partnership program today and no partners to list. How to enquire about a store listing or a business partnership, and what SmartBuy will not offer.',
  alternates: {
    canonical: `${appConfig.url}/partners`,
  },
  openGraph: {
    title: 'Partners — SmartBuy AI',
    description:
      'SmartBuy AI has no partnership program today and no partners to list. How to enquire about a store listing or a business partnership, and what SmartBuy will not offer.',
    url: `${appConfig.url}/partners`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Partners — SmartBuy AI',
    description:
      'SmartBuy AI has no partnership program today and no partners to list.',
  },
};

export default function PartnersPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Handshake className="h-7 w-7 text-blue-600" /> Partners
          </h1>
          <p className="mt-2 text-muted-foreground">
            SmartBuy AI has no partnership program today — and no partners to list. This page
            says that plainly instead of showing logos or testimonials that do not exist.
          </p>

          <div className="mt-8 rounded-lg border p-6">
            <h2 className="text-lg font-semibold">No partners yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              There is no partner directory, no paid placement, and no revenue-share agreement
              in force. When a partnership is agreed, it will be listed here with the
              partner&apos;s name and what the partnership actually covers — not before.
            </p>
          </div>

          <h2 className="mt-8 text-xl font-semibold">What we will read</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>
              A store or retailer that wants to be listed in the stores directory. Directory
              entries are links to the store — SmartBuy never invents prices, stock, or deals
              for a listed store.
            </li>
            <li>
              A business enquiry about working together — for example, a data or distribution
              question. There is no standing offer to answer, so every enquiry is read on its
              own merits.
            </li>
            <li>
              A creator enquiry. Creators share verified community deals and earn points and
              badges — see the{' '}
              <Link href="/creators" className="font-medium underline underline-offset-4">
                Creators page
              </Link>{' '}
              and the guide{' '}
              <Link
                href="/blog/how-to-become-a-creator-on-smartbuy"
                className="font-medium underline underline-offset-4"
              >
                How to Become a Creator on SmartBuy
              </Link>
              .
            </li>
          </ul>

          <h2 className="mt-8 text-xl font-semibold">What we will not offer</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
            <li>Paid placement — a payment does not buy a better ranking, a badge, or a deal slot.</li>
            <li>Guaranteed promotion — deals are listed when they are verified, not when they are paid for.</li>
            <li>Endorsements — SmartBuy does not claim a partnership that has not been agreed.</li>
          </ul>

          <p className="mt-8 text-muted-foreground">
            To enquire, use the{' '}
            <Link href="/contact" className="font-medium underline underline-offset-4">
              contact page
            </Link>{' '}
            or email{' '}
            <a href={`mailto:${appConfig.supportEmail}`} className="font-medium underline underline-offset-4">
              {appConfig.supportEmail}
            </a>
            . Say who you are, what you are proposing, and what you would need from SmartBuy —
            a short, specific enquiry gets a faster answer than a generic one.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
