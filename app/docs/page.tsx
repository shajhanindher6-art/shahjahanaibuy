import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { LocalizedHeading } from '@/components/i18n/localized-heading';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Documentation — SmartBuy AI',
  description:
    'SmartBuy AI documentation: short guides to search, compare, deals, wishlists and alerts, and billing.',
  alternates: {
    canonical: `${appConfig.url}/docs`,
  },
};

const guides = [
  {
    href: '/search',
    title: 'Search products',
    description: 'Search by keyword or describe what you need in plain language.',
  },
  {
    href: '/compare',
    title: 'Compare products',
    description: 'Compare two to five products side by side, with an AI summary.',
  },
  {
    href: '/deals',
    title: 'Find deals',
    description: 'Browse current deals, ranked by value.',
  },
  {
    href: '/dashboard/wishlists',
    title: 'Wishlists and alerts',
    description: 'Save products, organise wishlists, and set price-drop alerts.',
  },
  {
    href: '/dashboard/billing',
    title: 'Billing and Premium',
    description: 'Upgrade to Premium, manage billing, and view billing history.',
  },
];

export default function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Documentation"
        description="SmartBuy AI documentation: short guides to search, compare, deals, wishlists and alerts, and billing."
        path="/docs"
        crumbs={[ { name: "Home", path: "/" }, { name: "Documentation" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <LocalizedHeading dictKey="footerLinkDocumentation" className="text-3xl font-bold" />
          <p className="mt-2 text-muted-foreground">
            A short guide to the main parts of SmartBuy AI. Each card below takes you straight
            to that feature.
          </p>
          <div className="mt-8 space-y-4">
            {guides.map((guide) => (
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
                    Open {guide.title.toLowerCase()}
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
