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
import { LocalizedHeading } from '@/components/i18n/localized-heading';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { deriveTaxonomySlugs, slugify } from '@/lib/brand-category-seo';
import { buildItemListJsonLd, toJsonLd } from '@/lib/json-ld';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Browse by brand — SmartBuy AI',
  description:
    'Every brand in the SmartBuy AI catalog — pick one to see its products and compare prices across retailers.',
  alternates: {
    canonical: `${appConfig.url}/brands`,
  },
};

async function getBrands(): Promise<Array<{ name: string; slug: string; count: number }>> {
  try {
    const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
    });
    const { data } = await supabase
      .from('products')
      .select('brand')
      .neq('slug', 'sample-laptop')
      .is('deleted_at', null)
      .limit(500);
    if (!data) return [];
    // Section 13, Chunk A — product counts from the same query:
    // one row per product, tallied by slug (names that slugify
    // identically collapse to one entry, same as the list itself).
    const rows = data as Array<{ brand: string | null }>;
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.brand) continue;
      const slug = slugify(row.brand);
      if (!slug) continue;
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    return deriveTaxonomySlugs(rows.map((row) => row.brand)).map((brand) => ({
      ...brand,
      count: counts.get(brand.slug) ?? 0,
    }));
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
          <LocalizedHeading dictKey="pageHeadingBrands" className="text-3xl font-bold" />
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
              {/* Section 13, Chunk E: ItemList of the real brand
                  listing URLs on this page. */}
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                  __html: toJsonLd(
                    buildItemListJsonLd(
                      appConfig.url,
                      brands.map((brand) => ({
                        name: brand.name,
                        path: `/brands/${brand.slug}`,
                      }))
                    )
                  ),
                }}
              />
              <ul className="mt-6 space-y-2">
                {brands.map((brand) => (
                  <li key={brand.slug}>
                    <Link
                      href={`/brands/${brand.slug}`}
                      className="flex min-h-[44px] items-center justify-between rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:border-blue-300 hover:text-primary"
                    >
                      {brand.name}
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-normal text-muted-foreground">
                          {brand.count} product{brand.count !== 1 ? 's' : ''}
                        </span>
                        <span aria-hidden="true">→</span>
                      </span>
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
