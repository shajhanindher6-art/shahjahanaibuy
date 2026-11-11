import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { SiteHeader } from '@/components/layout/site-header';
import { LocalizedHeading } from '@/components/i18n/localized-heading';
import { SiteFooter } from '@/components/layout/site-footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { appConfig } from '@/lib/config/app';
import { buildFaqJsonLd, toJsonLd } from '@/lib/json-ld';
import { FAQS } from '../help/faqs';

export const metadata: Metadata = {
  title: 'Frequently Asked Questions — SmartBuy AI',
  description:
    'SmartBuy AI frequently asked questions: price alerts, Premium, accounts, coupons, Deal Score, live prices, and reviews.',
  alternates: {
    canonical: `${appConfig.url}/faq`,
  },
};

/**
 * Standalone FAQ page (Section 10, chunk 2). The questions and
 * answers are NOT copied here — they are imported from
 * app/help/faqs.ts, the single source of truth shared with /help,
 * so /faq and /help can never drift apart and no answer is invented.
 * FAQPage JSON-LD is emitted from the same list, mirroring /help.
 */
export default function FaqPage() {
  const nonce = headers().get('x-nonce');
  const faqJsonLd = toJsonLd(buildFaqJsonLd(FAQS));
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{ __html: faqJsonLd }}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <LocalizedHeading dictKey="pageHeadingFaq" className="text-3xl font-bold" />
          <p className="mt-2 text-muted-foreground">
            The same questions and answers as the{' '}
            <Link href="/help" className="underline">
              Help Center
            </Link>
            , on their own page. Still stuck?{' '}
            <Link href="/contact" className="underline">
              Contact us
            </Link>{' '}
            or email{' '}
            <a href={`mailto:${appConfig.supportEmail}`} className="underline">
              {appConfig.supportEmail}
            </a>
            .
          </p>

          <div className="mt-8 space-y-4">
            {FAQS.map((faq) => (
              <Card key={faq.question}>
                <CardHeader>
                  <CardTitle className="text-base">{faq.question}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{faq.answer}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="mt-8 text-sm text-muted-foreground">
            For step-by-step guides, see the{' '}
            <Link href="/help" className="underline">
              Help Center
            </Link>{' '}
            or the{' '}
            <Link href="/docs" className="underline">
              documentation page
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
