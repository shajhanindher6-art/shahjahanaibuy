'use client';

import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { ShoppingBasket } from 'lucide-react';
import { BundleAllocator } from '@/components/bundle/bundle-allocator';

/**
 * Budget-to-Cart Allocator page — Enterprise feature #4.
 *
 * Given a total budget and a list of categories, the allocator finds
 * the best product combination from the real catalog: as many
 * categories covered as fit under the budget, at the lowest recorded
 * prices. No price is invented and the total never exceeds the budget.
 */
export default function BundlesPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <SiteHeader />
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="flex items-center justify-center gap-2 text-3xl font-bold sm:text-4xl">
            <ShoppingBasket className="h-8 w-8 text-blue-600" />
            Budget-to-Cart Allocator
          </h1>
          <p className="mt-2 text-muted-foreground">
            One bundle, one budget — the best combination across the categories you need
          </p>
        </div>
        <BundleAllocator />
      </div>
      <SiteFooter />
    </div>
  );
}
