/**
 * Category index — /categories (Section 12).
 *
 * Lists every category derived from the catalog's product rows
 * (same source as the homepage "Browse by brand or category"
 * section and the sitemap — lib/brand-category-seo.ts), each
 * linking to its /categories/[slug] page. Slugs come from the
 * catalog only, never invented.
 *
 * force-dynamic: the list is read at request time. A static
 * prerender at build time would run against placeholder env and
 * bake in an empty list.
 *
 * Honesty: when the catalog has no categories (or the query fails),
 * the page shows an honest empty state instead of an invented
 * list.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/config/env';
import { appConfig } from '@/lib/config/app';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { deriveTaxonomySlugs } from '@/lib/brand-category-seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Browse by category — SmartBuy AI',
  description:
    'Every category in the SmartBuy AI catalog — pick one to see its products and compare prices across retailers.',
  alternates: {
    canonical: `${appConfig.url}/categories`,
  },
};

async function getCategories(): Promise<Array<{ name: string; slug: string }>> {
  try {
    const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
    });
    const { data } = await supabase
      .from('products')
      .select('category')
      .is('deleted_at', null)
      .limit(500);
    if (!data) return [];
    return deriveTaxonomySlugs(
      (data as Array<{ category: string | null }>).map((row) => row.category)
    );
  } catch {
    return [];
  }
}

export default async function CategoriesIndexPage() {
  const categories = await getCategories();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
            <Link href="/" className="underline">
              Home
            </Link>
            {' / '}
            <span>Categories</span>
          </nav>
          <h1 className="text-3xl font-bold">Browse by category</h1>
          <p className="mt-2 text-muted-foreground">
            Every category in the catalog — pick one to see its products and
            compare prices across retailers.
          </p>

          {categories.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                eyebrow="No categories yet"
                title="No categories in the catalog yet"
                description="No products have been added to the catalog yet, so there are no categories to browse. Check back later, or browse the full catalog."
                action={
                  <Link
                    href="/search"
                    className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Browse the catalog
                  </Link>
                }
              />
            </div>
          ) : (
            <>
              <p className="mt-4 text-sm text-muted-foreground">
                {categories.length}{' '}
                {categories.length === 1 ? 'category' : 'categories'} in the
                catalog
              </p>
              <ul className="mt-6 space-y-2">
                {categories.map((category) => (
                  <li key={category.slug}>
                    <Link
                      href={`/categories/${category.slug}`}
                      className="flex min-h-[44px] items-center justify-between rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:border-blue-300 hover:text-primary"
                    >
                      {category.name}
                      <span aria-hidden="true">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
