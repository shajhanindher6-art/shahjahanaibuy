/**
 * Homepage "Browse by brand / category" links (Section 9, chunk 2).
 *
 * Async server component: reads the distinct `brand` / `category`
 * text values from the products table (anon client, same pattern as
 * app/sitemap.ts) and links each one to its /brands/[slug] or
 * /categories/[slug] page. Slugs are derived from the catalog only
 * (lib/brand-category-seo.ts) — no hardcoded brand or category
 * names. Renders nothing when the catalog has no brands/categories
 * or the query fails, so a DB outage never breaks the homepage.
 */

import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/config/env';
import { deriveTaxonomySlugs } from '@/lib/brand-category-seo';

export async function BrowseByTaxonomy() {
  let brands: Array<{ name: string; slug: string }> = [];
  let categories: Array<{ name: string; slug: string }> = [];
  try {
    const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
    });
    const { data } = await supabase
      .from('products')
      .select('brand, category')
      .is('deleted_at', null)
      .limit(500);
    if (data) {
      brands = deriveTaxonomySlugs(
        (data as Array<{ brand: string | null }>).map((row) => row.brand)
      );
      categories = deriveTaxonomySlugs(
        (data as Array<{ category: string | null }>).map(
          (row) => row.category
        )
      );
    }
  } catch {
    return null;
  }

  if (brands.length === 0 && categories.length === 0) return null;

  return (
    <section className="border-t py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Browse by brand or category
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Every brand and category in the catalog — pick one to see its
            products and compare prices.
          </p>
        </div>
        {brands.length > 0 && (
          <div className="mx-auto mt-10 max-w-3xl">
            <h3 className="mb-3 text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Brands
            </h3>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {brands.map((brand) => (
                <Link
                  key={brand.slug}
                  href={`/brands/${brand.slug}`}
                  className="flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-medium transition-all hover:border-blue-300 hover:text-primary"
                >
                  {brand.name}
                </Link>
              ))}
            </div>
          </div>
        )}
        {categories.length > 0 && (
          <div className="mx-auto mt-8 max-w-3xl">
            <h3 className="mb-3 text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Categories
            </h3>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {categories.map((category) => (
                <Link
                  key={category.slug}
                  href={`/categories/${category.slug}`}
                  className="flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-medium transition-all hover:border-blue-300 hover:text-primary"
                >
                  {category.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
