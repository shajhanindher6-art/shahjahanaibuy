import Link from 'next/link';
import { headers } from 'next/headers';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { appConfig } from '@/lib/config/app';
import { buildFaqJsonLd, toJsonLd } from '@/lib/json-ld';

const FAQS = [
  {
    question: 'How do price alerts work?',
    answer:
      'Create a price alert on a product page with your target price. When the price drops to that level, you are notified through your chosen notification channels. Prices are refreshed every six hours, so an alert can take up to six hours to notice a change. Setting an alert needs a SmartBuy account — sign in first.',
  },
  {
    question: 'How do I cancel Premium?',
    answer:
      'Go to Dashboard > Billing and open the customer portal, where you can manage or cancel your subscription.',
  },
  {
    question: 'Why do I need an account?',
    answer:
      'An account saves your wishlists, alerts, preferences, and recommendations so they are available whenever you sign in.',
  },
  {
    question: 'I found a problem with a price or product. What should I do?',
    answer:
      'Contact us through the contact page and include the product name and the store link so we can check it.',
  },
  {
    question: 'How do SmartBuy coupons work?',
    answer:
      'SmartBuy lists exactly two coupons today — SAVE10 (10% off at Amazon) and BESTBUY15 ($15 off at Best Buy), both valid until January 29, 2027. The discount is applied at the retailer\u2019s checkout, not on SmartBuy: note the code, follow the link, and enter it yourself when you check out there.',
  },
  {
    question: 'What is the Deal Score, and why does it differ from the homepage widget?',
    answer:
      'The Deal Score (0–100) is computed from a product\u2019s recorded price history. Discount percentages on product pages use the merchant compare-at price as their basis; the homepage deals widget uses the deals table, so the two can differ for the same product. The full explanation is on the methodology page.',
  },
  {
    question: 'Are the prices on SmartBuy live retailer prices?',
    answer:
      'No. Prices shown are the site\u2019s recorded catalog figures, refreshed every six hours, and the retailer sets the final price on its own page. Always check the retailer\u2019s page before you buy. Local stores are shown as directory entries with a link only — SmartBuy never invents a local price.',
  },
  {
    question: 'Why does a product say "No reviews yet"?',
    answer:
      'Because SmartBuy has no real reviews today — zero — and the site says so instead of inventing any. Reviews will only ever come from real people, and a review is only shown as verified when the purchase behind it has been confirmed.',
  },
];

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

export default function HelpPage() {
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
          <h1 className="text-3xl font-bold">Help Center</h1>
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

          <h2 className="mt-10 text-xl font-semibold">Frequently asked questions</h2>
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
            More help: the{' '}
            <Link href="/support" className="underline">
              support page
            </Link>{' '}
            has the same FAQs in short form, and the{' '}
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
