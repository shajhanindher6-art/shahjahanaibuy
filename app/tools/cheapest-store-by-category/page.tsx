/**
 * Cheapest Store by Category — /tools/cheapest-store-by-category
 * (Section 16, E11).
 *
 * Table of which store has the lowest recorded price per
 * category, with the product behind each low named.
 *
 * Server component, no JavaScript needed: the table is rendered
 * from recorded merchant_products rows (getMerchantProducts per
 * catalog product) composed by
 * lib/cheapest-store-by-category.ts.
 *
 * Honesty: only Amazon + Best Buy carry priced rows, so the
 * table is honestly a two-store comparison — the page says so.
 * A store with no recorded price in a category shows "No recorded
 * price", never a guessed price, and categories with no priced
 * product at any store are listed separately.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { Store } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCategories, getProducts } from '@/services/products';
import { getMerchantProducts, getMerchants } from '@/services/commerce';
import {
  buildCheapestStoreTable,
  type CheapestStoreRowInput,
} from '@/lib/cheapest-store-by-category';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cheapest Store by Category — SmartBuy AI',
  description:
    'Which store has the lowest recorded price in each category? An honest two-store comparison from recorded prices only — Amazon vs Best Buy, product named behind every low.',
  alternates: {
    canonical: `${appConfig.url}/tools/cheapest-store-by-category`,
  },
  openGraph: {
    title: 'Cheapest Store by Category — SmartBuy AI',
    description:
      'Which store has the lowest recorded price in each category? An honest two-store comparison from recorded prices only — Amazon vs Best Buy, product named behind every low.',
    url: `${appConfig.url}/tools/cheapest-store-by-category`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Cheapest Store by Category — SmartBuy AI',
    description:
      'Which store has the lowest recorded price in each category? An honest two-store comparison from recorded prices only — Amazon vs Best Buy, product named behind every low.',
  },
};

export default async function CheapestStoreByCategoryPage() {
  const supabase = await createSupabaseServerClient();
  const [{ products }, merchants, categories] = await Promise.all([
    getProducts(supabase, { page: 1, pageSize: 100 }),
    getMerchants(supabase),
    getCategories(supabase),
  ]);

  const merchantNameById = new Map(merchants.map((m) => [m.id, m.name]));
  const listingsByProduct = await Promise.all(
    products.map(async (p) => ({
      product: p,
      listings: await getMerchantProducts(supabase, p.id),
    }))
  );

  const inputs: CheapestStoreRowInput[] = [];
  for (const { product, listings } of listingsByProduct) {
    for (const l of listings) {
      inputs.push({
        category: product.category,
        merchantName: merchantNameById.get(l.merchantId) ?? 'Unknown store',
        price: Number(l.price),
        inStock: l.inStock,
        productName: product.name,
        productSlug: product.slug,
      });
    }
  }

  const table = buildCheapestStoreTable(inputs, categories);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Cheapest Store by Category"
        description="Which store has the lowest recorded price in each category? An honest two-store comparison from recorded prices only — Amazon vs Best Buy, product named behind every low."
        path="/tools/cheapest-store-by-category"
        crumbs={[ { name: "Home", path: "/" }, { name: "AI tools", path: "/tools" }, { name: "Cheapest Store by Category" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Store className="h-7 w-7 text-blue-600" /> Cheapest Store by Category
          </h1>
          <p className="mt-2 text-muted-foreground">
            Which store has the lowest recorded price in each
            category? Only Amazon and Best Buy carry priced listings
            in the catalog today, so this is honestly a two-store
            comparison — every low names the product behind it, and a
            store with no recorded price in a category says so
            instead of showing a guessed price.
          </p>

          {table.rows.length === 0 ? (
            <div className="mt-6">
              <EmptyState
                eyebrow="No recorded prices"
                title="No category has a recorded price yet"
                description="There are no in-stock merchant prices recorded for any category right now, so there is no cheapest store to name."
              />
            </div>
          ) : (
            <div className="mt-8 overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Category
                    </th>
                    {table.merchants.map((m) => (
                      <th key={m} scope="col" className="px-4 py-3 font-semibold">
                        {m} lowest
                      </th>
                    ))}
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Cheapest store
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <tr key={row.category} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{row.category}</td>
                      {table.merchants.map((m) => {
                        const entry = row.byMerchant.find((e) => e.merchantName === m);
                        return (
                          <td key={m} className="px-4 py-3">
                            {entry ? (
                              <>
                                <span className="font-semibold">
                                  ${entry.price.toFixed(2)}
                                </span>{' '}
                                <Link
                                  href={`/products/${entry.productSlug}`}
                                  className="text-muted-foreground underline-offset-4 hover:underline"
                                >
                                  {entry.productName}
                                </Link>
                              </>
                            ) : (
                              <span className="text-muted-foreground">No recorded price</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3">
                        {row.cheapest ? (
                          <span className="font-semibold">{row.cheapest.merchantName}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {table.categoriesWithNoPrices.length > 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              No recorded prices in:{' '}
              {table.categoriesWithNoPrices.join(', ')} — these
              categories have no in-stock merchant price recorded
              yet.
            </p>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            Lowest means the lowest recorded in-stock merchant price
            for any product in the category. Prices are recorded
            prices only — the directory&apos;s other 82 stores are
            search-link stores with no priced listings, so they do
            not appear in this table.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
