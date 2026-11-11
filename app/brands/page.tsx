/**
 * Brand index — /brands (Section 12).
 *
 * Lists every brand derived from the catalog's product rows
 * (same source as the homepage "Browse by brand or category"
 * section and the sitemap — lib/brand-category-seo.ts), each
 * linking to its /brands/[slug] page. Slugs come from the catalog
 * only, never invented.
 *
 * force-dynamic: the list is read at request time. A static
 * prerender at build time would run against placeholder env and
 * bake in an empty list.
 *
 * Honesty: when the catalog has no brands (or the query fails),
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
  title: 'Browse by brand — SmartBuy AI',
  description:
    'Every brand in the SmartBuy AI catalog — pick one to see its products and compare prices across retailers.',
  alternates: {
    canonical: `${appConfig.url}/brands`,
  },
};

async function getBrands(): Promise<Array<{ name: string; slug: string }>> {
  try {
    const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
    });
    const { data } = await supabase
      .from('products')
      .select('brand')
      .is('deleted_at', null)
      .limit(500);
    if (!data) return [];
    return deriveTaxonomySlugs(
      (data as Array<{ brand: string | null }>).map((row) => row.brand)
    );
  } catch {
    return [];
  }
}

export default async function BrandsIndexPage() {
  const brands = await getBrands();

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
            <span>Brands</span>
          </nav>
          <h1 className="text-3xl font-bold">Browse by brand</h1>
          <p className="mt-2 text-muted-foreground">
            Every brand in the catalog — pick one to see its products and
            compare prices across retailers.
          </p>

          {brands.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                eyebrow="No brands yet"
                title="No brands in the catalog yet"
                description="No products have been added to the catalog yet, so there are no brands to browse. Check back later, or browse the full catalog."
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
                {brands.length} {brands.length === 1 ? 'brand' : 'brands'} in
                the catalog
              </p>
              <ul className="mt-6 space-y-2">
                {brands.map((brand) => (
                  <li key={brand.slug}>
                    <Link
                      href={`/brands/${brand.slug}`}
                      className="flex min-h-[44px] items-center justify-between rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:border-blue-300 hover:text-primary"
                    >
                      {brand.name}
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
