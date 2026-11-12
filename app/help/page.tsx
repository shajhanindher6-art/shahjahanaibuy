import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { LocalizedHeading } from '@/components/i18n/localized-heading';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { appConfig } from '@/lib/config/app';
import { buildFaqJsonLd, toJsonLd } from '@/lib/json-ld';
import { FAQS } from './faqs';
import { tFor } from '@/lib/i18n';
import { isSupportedLanguage, type Language } from '@/lib/region';

export const metadata: Metadata = {
  title: 'Help Center — SmartBuy AI',
  description:
    'Answers to common SmartBuy AI questions — price alerts, Premium, accounts, prices, reviews — plus guides to the features that save you money.',
  alternates: {
    canonical: `${appConfig.url}/help`,
  },
};

const GUIDES = [
  {
    href: '/blog/how-to-set-up-price-drop-alerts',
    title: 'How to set up price-drop alerts',
    description: 'Step by step: pick a target price, choose a channel, and let the alert watch for you.',
  },
  {
    href: '/blog/how-to-read-price-history-chart-laptop',
    title: 'How to read a price history chart',
    description: 'What the current, lowest, highest, and average prices tell you before you buy.',
  },
  {
    href: '/blog/how-to-spot-a-fake-sale',
    title: 'How to spot a fake sale',
    description: 'The rise-then-drop pattern SmartBuy checks for, and what to do when you see a flag.',
  },
  {
    href: '/blog/buy-now-or-wait-how-to-decide',
    title: 'Buy now or wait?',
    description: 'How the Buy vs Wait confidence score works, and what to do at each level.',
  },
  {
    href: '/blog/how-smartbuy-coupons-work-save10-bestbuy15',
    title: 'How SmartBuy coupons work',
    description: 'SAVE10 and BESTBUY15 explained — what each is worth and where the discount happens.',
  },
  {
    href: '/blog/warranty-returns-guide-online-shopping',
    title: 'Warranty and returns guide',
    description: 'What to check about warranties and returns before you order, including across borders.',
  },
  {
    href: '/methodology',
    title: 'How SmartBuy AI works',
    description: 'Prices, Deal Score, review verification, and affiliate disclosure in plain language.',
  },
  {
    href: '/docs',
    title: 'Feature documentation',
    description: 'Short guides to search, compare, deals, wishlists, alerts, and billing.',
  },
];

/**
 * Section 16, #42: server-page language from the same sb-language
 * cookie the root layout uses for dir/lang (see app/page.tsx
 * homepageLanguage). No new dict keys — existing keys only.
 */
function pageLanguage(): Language {
  const saved = cookies().get('sb-language')?.value ?? null;
  return saved && isSupportedLanguage(saved) ? saved : 'en';
}

export default function HelpPage() {
  // Section 16, #42: the FAQ section heading renders through tFor
  // (existing key only) — same sb-language cookie pattern as the
  // homepage/server tools. The H1 already translates via
  // LocalizedHeading; this covers the H2.
  const language = pageLanguage();
  // FAQ JSON-LD (S4#15 builder, imported only) from the FAQ content
  // already on this page — no invented Q&A. Same CSP nonce source
  // as the blog/product pages (middleware sets x-nonce per request).
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
          <LocalizedHeading dictKey="footerLinkHelpCenter" className="text-3xl font-bold" />
          <p className="mt-2 text-muted-foreground">
            Answers to common questions, and guides to the features that save you money.
            Still stuck?{' '}
            <Link href="/contact" className="underline">
              Contact us
            </Link>{' '}
            or email{' '}
            <a href={`mailto:${appConfig.supportEmail}`} className="underline">
              {appConfig.supportEmail}
            </a>
            .
          </p>

          <h2 className="mt-10 text-xl font-semibold">Ask the AI assistant</h2>
          <p className="mt-3 text-muted-foreground">
            The AI deal-finder chat — the floating chat button on every page — can also
            answer support questions: ask it how price alerts work, how to compare two
            products, or how to find a deal under your budget, and it will point you to the
            right page or product. It is the same assistant that helps you shop, in support
            mode: it explains and links, and it never pretends to know something it cannot
            check. For anything it cannot answer, use the guides below or{' '}
            <Link href="/contact" className="underline">
              contact us
            </Link>
            .
          </p>

          <h2 className="mt-10 text-xl font-semibold">Guides</h2>
          <div className="mt-4 space-y-4">
            {GUIDES.map((guide) => (
              <Card key={guide.href}>
                <CardHeader>
                  <CardTitle className="text-base">
                    <Link href={guide.href} className="underline-offset-4 hover:underline">
                      {guide.title}
                    </Link>
                  </CardTitle>
                  <CardDescription>{guide.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href={guide.href} className="text-sm font-medium underline">
                    Read the guide
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>

          <h2 className="mt-10 text-xl font-semibold">{tFor(language, 'pageHeadingFaq')}</h2>
          <div className="mt-4 space-y-4">
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
            Short on time? The{' '}
            <Link href="/faq" className="underline">
              FAQ page
            </Link>{' '}
            lists the same questions and answers on their own, and the{' '}
            <Link href="/docs" className="underline">
              documentation page
            </Link>{' '}
            links straight to each feature.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
