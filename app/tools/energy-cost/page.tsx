/**
 * AI Energy Cost Calculator — /tools/energy-cost.
 *
 * What does this device cost to run per year (and over 5 years)?
 * Math: watts × hours/day × 365 ÷ 1000 × tariff = annual cost.
 *
 * Server component, no JavaScript needed: the form submits as a
 * plain GET to this same page, so the result URL is shareable.
 * Pure math lives in lib/energy-cost.ts.
 *
 * Honesty: there is NO tariff default — the tariff varies by
 * country and provider, so the field is left empty with an
 * "enter your tariff" prompt. The catalog has no wattage data
 * (0 specs rows) — watts are ALWAYS user-entered, never looked
 * up. Picking a catalog product only labels the result; it
 * changes no number. The result is labelled "based on the watts
 * and tariff you entered" — never a measured consumption figure.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import {
  calculateEnergyCost,
  ENERGY_COST_BASIS_LABEL,
  parseEnergyCostParams,
} from '@/lib/energy-cost';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Energy Cost Calculator — SmartBuy AI',
  description:
    'What does a device cost to run per year — and over 5 years? Enter watts, hours per day and your electricity tariff. No default tariff, no looked-up wattage.',
  alternates: {
    canonical: `${appConfig.url}/tools/energy-cost`,
  },
  openGraph: {
    title: 'AI Energy Cost Calculator — SmartBuy AI',
    description:
      'What does a device cost to run per year — and over 5 years? Enter watts, hours per day and your electricity tariff. No default tariff, no looked-up wattage.',
    url: `${appConfig.url}/tools/energy-cost`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'AI Energy Cost Calculator — SmartBuy AI',
    description:
      'What does a device cost to run per year — and over 5 years? Enter watts, hours per day and your electricity tariff. No default tariff, no looked-up wattage.',
  },
};

interface EnergyCostProps {
  searchParams: {
    watts?: string | string[];
    hours?: string | string[];
    tariff?: string | string[];
    product?: string | string[];
  };
}

export default async function EnergyCostPage({
  searchParams,
}: EnergyCostProps): Promise<JSX.Element> {
  const params = parseEnergyCostParams(searchParams);
  const supabase = await createSupabaseServerClient();
  const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });

  const labelledProduct =
    params.productSlug !== ''
      ? (products.find((p) => p.slug === params.productSlug) ?? null)
      : null;

  const result =
    params.watts !== null &&
    params.hoursPerDay !== null &&
    params.tariffPerKwh !== null
      ? calculateEnergyCost(params.watts, params.hoursPerDay, params.tariffPerKwh)
      : null;
  const hasQuery =
    params.watts !== null ||
    params.hoursPerDay !== null ||
    params.tariffPerKwh !== null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: WebPage + BreadcrumbList
          (Home → AI tools → this tool). */}
      <PageJsonLd
        name="AI Energy Cost Calculator"
        description="What does a device cost to run per year — and over 5 years? Enter watts, hours per day and your electricity tariff. No default tariff, no looked-up wattage."
        path="/tools/energy-cost"
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'AI tools', path: '/tools' },
          { name: 'AI Energy Cost Calculator' },
        ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Zap className="h-7 w-7 text-blue-600" /> AI Energy Cost
            Calculator
          </h1>
          <p className="mt-2 text-muted-foreground">
            What does a device cost to run per year — and over 5
            years? Enter the watts, how many hours a day it runs,
            and your electricity tariff (price per kWh). There is no
            default tariff: it varies by country and provider, so
            enter the one on your bill.
          </p>

          <form
            method="get"
            action="/tools/energy-cost"
            className="mt-8 rounded-lg border p-6"
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="watts" className="text-sm font-medium">
                  Watts
                </label>
                <input
                  id="watts"
                  name="watts"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 100"
                  defaultValue={params.watts !== null ? String(params.watts) : ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="hours" className="text-sm font-medium">
                  Hours per day
                </label>
                <input
                  id="hours"
                  name="hours"
                  type="number"
                  min="0.01"
                  max="24"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 8"
                  defaultValue={
                    params.hoursPerDay !== null ? String(params.hoursPerDay) : ''
                  }
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="tariff" className="text-sm font-medium">
                  Tariff per kWh (USD)
                </label>
                <input
                  id="tariff"
                  name="tariff"
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  inputMode="decimal"
                  placeholder="Enter your tariff"
                  defaultValue={
                    params.tariffPerKwh !== null ? String(params.tariffPerKwh) : ''
                  }
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-4">
              <label htmlFor="product" className="text-sm font-medium">
                Catalog product (label only — optional)
              </label>
              <select
                id="product"
                name="product"
                defaultValue={params.productSlug}
                className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">No product — just the numbers</option>
                {products.map((p) => (
                  <option key={p.id} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                The catalog has no wattage data, so watts are always
                typed in by you — picking a product only names the
                result, it never fills in the watts.
              </p>
            </div>
            {params.wattsError && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {params.wattsError}
              </p>
            )}
            {params.hoursError && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {params.hoursError}
              </p>
            )}
            {params.tariffError && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {params.tariffError}
              </p>
            )}
            <Button type="submit" className="mt-4">
              Calculate running cost →
            </Button>
          </form>

          {products.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No products yet"
                title="No catalog products to label with"
                description="The catalog is empty right now, so there is no product to pick for the label — the calculator still works with the numbers you enter."
              />
            </div>
          )}

          {result !== null && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">
                Running cost
                {labelledProduct ? ` — ${labelledProduct.name}` : ''}
              </h2>
              <p className="mt-3 text-3xl font-bold">
                ${result.annualCost.toFixed(2)} / year
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.annualKwh.toLocaleString('en-US')} kWh per year ·{' '}
                {ENERGY_COST_BASIS_LABEL}.
              </p>
              <dl className="mt-6 grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Per day</dt>
                  <dd className="mt-1 font-semibold">
                    ${result.dailyCost.toFixed(2)}
                  </dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Per month</dt>
                  <dd className="mt-1 font-semibold">
                    ${result.monthlyCost.toFixed(2)}
                  </dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Over 5 years</dt>
                  <dd className="mt-1 font-semibold">
                    ${result.fiveYearCost.toFixed(2)}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-xs text-muted-foreground">
                {result.watts}W × {result.hoursPerDay} hours/day × 365 ÷
                1000 × ${result.tariffPerKwh} per kWh ={' '}
                {result.annualKwh.toLocaleString('en-US')} kWh/year. This
                is arithmetic on the watts and tariff you entered —
                not a measured consumption figure
                {labelledProduct
                  ? ` for ${labelledProduct.name}`
                  : ' for any product'}
                .
              </p>
              {labelledProduct && (
                <p className="mt-3">
                  <Link
                    href={`/products/${labelledProduct.slug}`}
                    className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    View product →
                  </Link>
                </p>
              )}
            </section>
          )}

          {!hasQuery && (
            <p className="mt-8 text-sm text-muted-foreground">
              Tip: try 100 watts, 8 hours a day, and a $0.15 tariff —
              that is 292 kWh a year, about $43.80.
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
