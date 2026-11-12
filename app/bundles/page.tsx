'use client';

import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { ShoppingBasket } from 'lucide-react';
import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import { BundleAllocator } from '@/components/bundle/bundle-allocator';
import { ComboBundles } from '@/components/bundle/combo-bundles';

/**
 * Budget-to-Cart Allocator page — Enterprise feature #4.
 *
 * Given a total budget and a list of categories, the allocator finds
 * the best product combination from the real catalog: as many
 * categories covered as fit under the budget, at the lowest recorded
 * prices. No price is invented and the total never exceeds the budget.
 */
export default function BundlesPage() {
  const { language } = useRegion();
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Budget-to-Cart Allocator"
        description="One bundle, one budget — the best combination across the categories you need, from recorded prices only."
        path="/bundles"
        crumbs={[ { name: "Home", path: "/" }, { name: "Budget-to-Cart Allocator" } ]}
      />
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="flex items-center justify-center gap-2 text-3xl font-bold sm:text-4xl">
            <ShoppingBasket className="h-8 w-8 text-blue-600" />
            {tFor(language, 'pageHeadingBundles')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            One bundle, one budget — the best combination across the categories you need
          </p>
        </div>
        <BundleAllocator />
        <div className="mt-8">
          <ComboBundles />
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
