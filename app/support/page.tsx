/**
 * Support page (Section 10, chunk 2). This page used to repeat four
 * of the Help Center's FAQs in shortened form; that duplication is
 * removed — the full questions and answers live in exactly one
 * place, /help (mirrored on /faq), and this page links there
 * instead of keeping a second copy that could drift.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { LocalizedHeading } from '@/components/i18n/localized-heading';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Support — SmartBuy AI',
  description:
    'SmartBuy AI support: answers to common questions, links to the help center, FAQ, and documentation — and how to contact us.',
  alternates: {
    canonical: `${appConfig.url}/support`,
  },
};

const SUPPORT_LINKS = [
  {
    href: '/help',
    title: 'Help Center',
    description:
      'The full answers: how price alerts work, how to cancel Premium, why you need an account, and what to do about a wrong price — plus step-by-step guides.',
  },
  {
    href: '/faq',
    title: 'Frequently asked questions',
    description:
      'The same questions and answers as the Help Center, on their own page — price alerts, Premium, accounts, coupons, Deal Score, live prices, and reviews.',
  },
  {
    href: '/docs',
    title: 'Documentation',
    description:
      'Short guides to search, compare, deals, wishlists and alerts, and billing.',
  },
  {
    href: '/methodology',
    title: 'How SmartBuy AI works',
    description:
      'Where prices come from, how the Deal Score is calculated, how reviews are verified, and how the site earns money — in plain language.',
  },
];

export default function SupportPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Support"
        description="SmartBuy AI support: answers to common questions, links to the help center, FAQ, and documentation — and how to contact us."
        path="/support"
        crumbs={[ { name: "Home", path: "/" }, { name: "Support" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <LocalizedHeading dictKey="footerLinkSupport" className="text-3xl font-bold" />
          <p className="mt-2 text-muted-foreground">
            Answers to common questions. Still stuck?{' '}
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
            {SUPPORT_LINKS.map((link) => (
              <Card key={link.href}>
                <CardHeader>
                  <CardTitle className="text-base">
                    <Link href={link.href} className="underline-offset-4 hover:underline">
                      {link.title}
                    </Link>
                  </CardTitle>
                  <CardDescription>{link.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href={link.href} className="text-sm font-medium underline">
                    Go to {link.title.toLowerCase()}
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
