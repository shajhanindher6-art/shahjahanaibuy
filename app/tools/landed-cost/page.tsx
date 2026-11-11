/**
 * Landed Cost Calculator — /tools/landed-cost (Section 14).
 *
 * Product price + destination country + user-entered shipping,
 * duty %, and VAT % → an estimated landed cost. The duty and VAT
 * rates are USER-ENTERED: this page holds no tariff table and
 * presets no rate.
 *
 * Server component, no JavaScript needed: the form submits as a
 * plain GET to this same page
 * (?price=…&country=…&shipping=…&duty=…&vat=…), so the result URL
 * is shareable. Pure math lives in lib/landed-cost.ts.
 *
 * Honesty: the result is an ESTIMATE, labelled as one — never an
 * official duty figure. All amounts are USD as entered; no
 * currency conversion is applied.
 */

import type { Metadata } from 'next';
import { Package } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Button } from '@/components/ui/button';
import { ShareButtons } from '@/components/products/share-buttons';
import { appConfig } from '@/lib/config/app';
import { calculateLandedCost, parseLandedCostParams } from '@/lib/landed-cost';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Landed Cost Calculator — SmartBuy AI',
  description:
    'Estimate the full landed cost of an import — price, shipping, duty and VAT — from rates you enter yourself. An estimate, never an official duty figure.',
  alternates: {
    canonical: `${appConfig.url}/tools/landed-cost`,
  },
  openGraph: {
    title: 'Landed Cost Calculator — SmartBuy AI',
    description:
      'Estimate the full landed cost of an import — price, shipping, duty and VAT — from rates you enter yourself. An estimate, never an official duty figure.',
    url: `${appConfig.url}/tools/landed-cost`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Landed Cost Calculator — SmartBuy AI',
    description:
      'Estimate the full landed cost of an import — price, shipping, duty and VAT — from rates you enter yourself. An estimate, never an official duty figure.',
  },
};

interface LandedCostProps {
  searchParams: {
    price?: string | string[];
    country?: string | string[];
    shipping?: string | string[];
    duty?: string | string[];
    vat?: string | string[];
  };
}

export default function LandedCostPage({ searchParams }: LandedCostProps) {
  const { input, errors, hasQuery } = parseLandedCostParams(searchParams);
  const result = input !== null ? calculateLandedCost(input) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Package className="h-7 w-7 text-blue-600" /> Landed Cost Calculator
          </h1>
          <p className="mt-2 text-muted-foreground">
            What will an import really cost once it lands? Enter the
            product price, the destination country, shipping, and the
            duty and VAT rates — the rates are yours to enter, because
            this calculator holds no tariff table and presets no rate.
            The result is an <strong>estimate</strong>, never an
            official duty figure. All amounts are in USD as entered.
          </p>

          <form
            method="get"
            action="/tools/landed-cost"
            className="mt-8 rounded-lg border p-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="price" className="text-sm font-medium">
                  Product price (USD)
                </label>
                <input
                  id="price"
                  name="price"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 999"
                  defaultValue={input?.price !== undefined ? String(input.price) : (Array.isArray(searchParams.price) ? searchParams.price[0] : searchParams.price) ?? ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="country" className="text-sm font-medium">
                  Destination country
                </label>
                <input
                  id="country"
                  name="country"
                  type="text"
                  placeholder="e.g. Pakistan"
                  defaultValue={input?.country ?? (Array.isArray(searchParams.country) ? searchParams.country[0] : searchParams.country) ?? ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="shipping" className="text-sm font-medium">
                  Shipping (USD)
                </label>
                <input
                  id="shipping"
                  name="shipping"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 25"
                  defaultValue={input?.shipping !== undefined ? String(input.shipping) : (Array.isArray(searchParams.shipping) ? searchParams.shipping[0] : searchParams.shipping) ?? ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="duty" className="text-sm font-medium">
                  Duty rate (%) — you enter it
                </label>
                <input
                  id="duty"
                  name="duty"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 10"
                  defaultValue={input?.dutyPercent !== undefined ? String(input.dutyPercent) : (Array.isArray(searchParams.duty) ? searchParams.duty[0] : searchParams.duty) ?? ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="vat" className="text-sm font-medium">
                  VAT / sales-tax rate (%) — you enter it
                </label>
                <input
                  id="vat"
                  name="vat"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 18"
                  defaultValue={input?.vatPercent !== undefined ? String(input.vatPercent) : (Array.isArray(searchParams.vat) ? searchParams.vat[0] : searchParams.vat) ?? ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            {errors.length > 0 && (
              <div className="mt-3" role="alert">
                {errors.map((e) => (
                  <p key={e} className="text-sm font-medium text-red-600">
                    {e}
                  </p>
                ))}
              </div>
            )}
            <Button type="submit" className="mt-4">
              Estimate landed cost →
            </Button>
          </form>

          {result !== null && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">Estimated landed cost</h2>
              <p className="mt-3 text-3xl font-bold">
                ≈ ${result.total.toFixed(2)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                For delivery to {result.country} — about{' '}
                {result.upliftPercent.toFixed(1)}% above the product
                price alone.
              </p>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between rounded-md bg-muted p-3">
                  <dt>Product price</dt>
                  <dd className="font-semibold">${result.price.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between rounded-md bg-muted p-3">
                  <dt>Shipping</dt>
                  <dd className="font-semibold">${result.shipping.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between rounded-md bg-muted p-3">
                  <dt>Duty ({result.dutyPercent}% of ${result.dutiableBase.toFixed(2)})</dt>
                  <dd className="font-semibold">${result.duty.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between rounded-md bg-muted p-3">
                  <dt>VAT ({result.vatPercent}% of ${result.taxableBase.toFixed(2)})</dt>
                  <dd className="font-semibold">${result.vat.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between rounded-md border p-3">
                  <dt className="font-semibold">Estimated total</dt>
                  <dd className="font-bold">≈ ${result.total.toFixed(2)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Estimate only: duty is charged on price + shipping, VAT
                on price + shipping + duty, using the rates you entered.
                Actual charges depend on the official tariff schedule,
                the item&apos;s classification, and the carrier — check
                those before ordering.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Share this estimate:
                </span>
                <ShareButtons
                  title="Landed Cost Calculator — SmartBuy AI"
                  text={`Estimated landed cost to ${result.country}: ≈ $${result.total.toFixed(2)} (product $${result.price.toFixed(2)}) — SmartBuy AI`}
                />
              </div>
            </section>
          )}

          {!hasQuery && (
            <p className="mt-8 text-sm text-muted-foreground">
              Tip: try a $999 product to Pakistan with $25 shipping, 10%
              duty and 18% VAT — the estimate is ≈ $1,329.15.
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
