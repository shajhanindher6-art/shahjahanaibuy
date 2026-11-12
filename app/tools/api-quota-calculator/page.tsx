/**
 * API Quota & Tier Calculator — /tools/api-quota-calculator
 * (Section 16, E3).
 *
 * Enter expected API calls/day → names the tier needed, the
 * headroom on that tier, and the next tier up. Server component,
 * no JavaScript needed: the form submits as a plain GET to this
 * same page (?calls=…), so the result URL is shareable. Quotas
 * from lib/api-quota.ts, tier names/prices from lib/tiers.ts,
 * computed by lib/api-quota-calculator.ts.
 *
 * Honesty: Premium ($9.99) is a PLANNED price — payments are not
 * live (Stripe test mode), Family is "To be announced", Team is
 * "Custom / contact us". Every tier row labels its price status;
 * no price is ever presented as a live charge or a purchasable
 * offer.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { Calculator } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { Button } from '@/components/ui/button';
import { ShareButtons } from '@/components/products/share-buttons';
import { appConfig } from '@/lib/config/app';
import {
  calculateQuotaTier,
  parseQuotaCalls,
  QUOTA_TIERS,
} from '@/lib/api-quota-calculator';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'API Quota & Tier Calculator — SmartBuy AI',
  description:
    'How many API calls a day do you expect? This calculator names the SmartBuy API tier you need, the headroom on it, and the next tier up — with planned prices labelled honestly, never as purchasable.',
  alternates: {
    canonical: `${appConfig.url}/tools/api-quota-calculator`,
  },
  openGraph: {
    title: 'API Quota & Tier Calculator — SmartBuy AI',
    description:
      'How many API calls a day do you expect? Names the API tier you need, the headroom on it, and the next tier up — planned prices labelled honestly.',
    url: `${appConfig.url}/tools/api-quota-calculator`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'API Quota & Tier Calculator — SmartBuy AI',
    description:
      'Enter expected API calls/day — get the tier you need, headroom, and next tier up.',
  },
};

interface ApiQuotaCalculatorProps {
  searchParams: { calls?: string | string[] };
}

export default function ApiQuotaCalculatorPage({
  searchParams,
}: ApiQuotaCalculatorProps) {
  const calls = parseQuotaCalls(searchParams);
  const calculation = calls !== null ? calculateQuotaTier(calls) : null;
  const hasQuery = calls !== null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="API Quota & Tier Calculator"
        description="How many API calls a day do you expect? This calculator names the SmartBuy API tier you need, the headroom on it, and the next tier up — with planned prices labelled honestly, never as purchasable."
        path="/tools/api-quota-calculator"
        crumbs={[ { name: "Home", path: "/" }, { name: "AI tools", path: "/tools" }, { name: "API Quota & Tier Calculator" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Calculator className="h-7 w-7 text-blue-600" /> API Quota &amp; Tier Calculator
          </h1>
          <p className="mt-2 text-muted-foreground">
            How many API calls a day do you expect to make? Enter the
            number and this calculator names the tier you need, how
            much headroom that tier leaves, and the next tier up. Daily
            quotas: anonymous 100, Free 1,000, Premium 10,000, Family
            10,000, Team 100,000 calls per day.
          </p>

          <form
            method="get"
            action="/tools/api-quota-calculator"
            className="mt-8 rounded-lg border p-6"
          >
            <label htmlFor="calls" className="text-sm font-medium">
              Expected API calls per day
            </label>
            <input
              id="calls"
              name="calls"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              defaultValue={calls ?? ''}
              placeholder="e.g. 5000"
              className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
            <Button type="submit" className="mt-4">
              Calculate →
            </Button>
          </form>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Share this view:
            </span>
            <ShareButtons
              title="API Quota & Tier Calculator — SmartBuy AI"
              text="Which API tier do you need? Calculate it from your expected calls/day. — SmartBuy AI"
            />
          </div>

          {!hasQuery && (
            <div className="mt-6 rounded-lg border p-6">
              <h2 className="text-lg font-semibold">No calculation yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter your expected calls per day above and the
                calculator will name the tier you need. Nothing is
                guessed — without a number there is no answer.
              </p>
            </div>
          )}

          {calculation && !calculation.exceedsMax && calculation.neededTier && (
            <div className="mt-6 rounded-lg border p-6">
              <h2 className="text-lg font-semibold">Your tier</h2>
              <p className="mt-3 text-2xl font-bold">
                {calculation.neededTier.name}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {calculation.callsPerDay.toLocaleString('en-US')} calls/day
                fits in the {calculation.neededTier.quota.toLocaleString('en-US')}/day
                quota with {calculation.headroom!.toLocaleString('en-US')} calls/day
                of headroom.
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Tier quota</dt>
                  <dd className="mt-1 font-semibold">
                    {calculation.neededTier.quota.toLocaleString('en-US')} calls/day
                  </dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Price</dt>
                  <dd className="mt-1 font-semibold">
                    {calculation.neededTier.priceLabel}
                    {calculation.neededTier.pricePlanned
                      ? ` (${calculation.neededTier.priceHonesty})`
                      : ''}
                  </dd>
                </div>
              </dl>
              {calculation.nextTier ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Next tier up: {calculation.nextTier.name} —{' '}
                  {calculation.nextTier.quota.toLocaleString('en-US')} calls/day
                  {calculation.nextTier.pricePlanned
                    ? `, ${calculation.nextTier.priceLabel} (${calculation.nextTier.priceHonesty})`
                    : `, ${calculation.nextTier.priceLabel}`}
                  .
                </p>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  You are on the highest quota tier — there is no tier above Team.
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Premium ($9.99) is a planned price — payments are not live
                yet, so no tier can be purchased today. See{' '}
                <Link href="/pricing" className="underline underline-offset-4">
                  /pricing
                </Link>{' '}
                for the full tier list.
              </p>
            </div>
          )}

          {calculation && calculation.exceedsMax && (
            <div className="mt-6 rounded-lg border p-6">
              <h2 className="text-lg font-semibold">Above every tier</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {calculation.callsPerDay.toLocaleString('en-US')} calls/day
                exceeds even the Team quota of 100,000 calls/day. No
                tier covers this volume — contact us to discuss it.
              </p>
            </div>
          )}

          <div className="mt-6 space-y-4">
            <h2 className="text-lg font-semibold">All tiers</h2>
            {QUOTA_TIERS.map((tier) => (
              <article key={tier.id} className="rounded-lg border p-6">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-lg font-semibold">{tier.name}</h3>
                  <p className="text-xl font-bold">
                    {tier.quota.toLocaleString('en-US')}
                    <span className="text-xs font-normal text-muted-foreground"> /day</span>
                  </p>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Price: {tier.priceLabel}
                  {tier.pricePlanned ? ` — ${tier.priceHonesty}` : ' — available now'}.
                </p>
              </article>
            ))}
            <p className="text-xs text-muted-foreground">
              Family shares Premium&apos;s 10,000/day quota, so Premium
              is always named first — Family is never &quot;needed&quot;
              for quota alone. Anonymous callers are capped per IP.
              Quotas reset daily at UTC midnight; see /api-docs for the
              full paywall rules.
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
