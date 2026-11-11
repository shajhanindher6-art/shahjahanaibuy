/**
 * Sustainability platform page (Section 5, item 18).
 *
 * Carbon labels at scale, the repairability database, and certified
 * refurbished listings — every claim sourced:
 * - Carbon: recorded footprint first (migration 020), estimate
 *   labeled as an estimate (Option 8), nothing when neither exists.
 * - Repairability: Option 16 recorded data only, ranked best first.
 * - Refurbished: verified listings only (migration 029) — honest
 *   empty state until one exists. No greenwashing anywhere.
 *
 * Server component; all reads fail-safe to empty states when a
 * migration has not been run yet.
 */

import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Leaf } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { getMerchantProducts } from '@/services/commerce';
import { getProductEndurance } from '@/services/hardware-endurance';
import {
  resolveCarbonLabel,
  getRepairabilityDatabase,
  getRefurbishedListings,
} from '@/lib/sustainability';
import { CarbonLabelCard } from '@/components/sustainability/carbon-label';
import { RepairabilityTable } from '@/components/sustainability/repairability-table';
import { RefurbishedList } from '@/components/sustainability/refurbished-list';
import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';

// Live DB data must never be served from a stale edge cache.
export const dynamic = 'force-dynamic';

// Section 13, Chunk E: self-canonical + Open Graph metadata (the
// root layout's canonical points at the homepage, so without this
// the page self-canonicalizes to /).
export const metadata: Metadata = {
  title: 'Sustainability — SmartBuy AI',
  description:
    'Carbon labels, repairability, and refurbished options — every claim sourced, every estimate labeled. No greenwashing.',
  alternates: {
    canonical: `${appConfig.url}/sustainability`,
  },
  openGraph: {
    title: 'Sustainability — SmartBuy AI',
    description:
      'Carbon labels, repairability, and refurbished options — every claim sourced, every estimate labeled. No greenwashing.',
    url: `${appConfig.url}/sustainability`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Sustainability — SmartBuy AI',
    description:
      'Carbon labels, repairability, and refurbished options — every claim sourced, every estimate labeled. No greenwashing.',
  },
};

export default async function SustainabilityPage() {
  const supabase = await createSupabaseServerClient();

  const [{ products }, repairability, refurbished] = await Promise.all([
    getProducts(supabase, { pageSize: 100 }),
    getRepairabilityDatabase(supabase),
    getRefurbishedListings(supabase),
  ]);

  const carbonLabels = await Promise.all(
    products
      .filter((p) => p.slug !== 'sample-laptop')
      .map(async (product) => {
        const [endurance, listings] = await Promise.all([
          getProductEndurance(supabase, product.id),
          getMerchantProducts(supabase, product.id),
        ]);
        const lowestPriceUsd = listings.length > 0 ? listings[0].price : null;
        return {
          product,
          carbon: resolveCarbonLabel({
            recordedKg: endurance.carbonFootprintKg,
            category: product.category,
            priceUsd: lowestPriceUsd,
          }),
        };
      })
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <SiteHeader />
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="flex items-center justify-center gap-2 text-3xl font-bold sm:text-4xl">
            <Leaf className="h-8 w-8 text-emerald-600" />
            Sustainability
          </h1>
          <p className="mt-2 text-muted-foreground">
            Carbon labels, repairability, and refurbished options — every claim sourced, every
            estimate labeled. No greenwashing.
          </p>
        </div>

        <div className="space-y-8">
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Carbon labels</h2>
            <p className="text-sm text-muted-foreground">
              Recorded footprints are shown first. Where nothing is recorded, the label shows the
              Option 8 estimate — always marked &ldquo;Estimate only — not a certified lifecycle
              assessment&rdquo;. Where neither exists, no number is shown.
            </p>
            {carbonLabels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No products in the catalogue yet.
              </p>
            ) : (
              carbonLabels.map(({ product, carbon }) => (
                <CarbonLabelCard key={product.id} carbon={carbon} productName={product.name} />
              ))
            )}
          </section>

          <section>
            <RepairabilityTable
              rows={repairability.rows}
              recordedCount={repairability.recordedCount}
              totalCount={repairability.totalCount}
            />
          </section>

          <section>
            <RefurbishedList listings={refurbished} />
          </section>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
