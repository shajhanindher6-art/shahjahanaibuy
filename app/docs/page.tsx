import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">Documentation</h1>
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
