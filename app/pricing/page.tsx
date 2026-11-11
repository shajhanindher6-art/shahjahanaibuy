/**
 * Pricing page (Section 12, chunk C) — the shareable/canonical
 * pricing page. The plans themselves come from lib/tiers.ts (the
 * same definitions the homepage TiersSection renders), so the two
 * can never drift apart on price or features.
 *
 * HONESTY — read before changing the CTAs:
 * - Payments are NOT live yet: Stripe is in test mode, so no paid
 *   plan can be bought today and no free trial is offered. No trial
 *   terms exist anywhere in the code. The tier definitions still
 *   carry a trial CTA for Premium (lib/tiers.ts), so this page does
 *   NOT render tier.cta verbatim — HONEST_CTA below replaces it with
 *   copy that promises nothing. Do not "fix" this by rendering
 *   tier.cta until a real trial (with terms) exists.
 * - Premium $9.99/month is the planned price, not a live charge.
 *   Family is "To be announced" and Team is custom — both are owner
 *   decisions, never invented numbers (see lib/tiers.ts).
 * - The price-lock guarantee on Premium/Family/Team is dormant
 *   until Stripe is configured (lib/price-lock.ts) — the box below
 *   says so in plain sight, and the feature bullet is footnoted.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { appConfig } from '@/lib/config/app';
import { TIERS, availabilityLabel, type TierId } from '@/lib/tiers';
import { getPriceLockConfig } from '@/lib/price-lock';

export const metadata: Metadata = {
  title: 'Pricing — SmartBuy AI',
  description:
    'SmartBuy AI plans: Free, Premium ($9.99/month, planned price), Family (to be announced) and Team (custom). Payments are not live yet — Stripe is in test mode.',
  alternates: {
    canonical: `${appConfig.url}/pricing`,
  },
};

/**
 * Honest CTAs, per tier. Only the Premium entry differs from
 * lib/tiers.ts: its stored CTA promises a free trial that does
 * not exist, so it is replaced with "Create a free account" —
 * signing up is free, and no trial (or charge) starts.
 */
const HONEST_CTA: Record<TierId, { label: string; href: string }> = {
  free: { label: 'Get Started', href: '/sign-up' },
  premium: { label: 'Create a free account', href: '/sign-up' },
  family: { label: 'Email us about Family', href: '/contact' },
  team: { label: 'Contact Sales', href: '/contact' },
};

export default function PricingPage() {
  const priceLock = getPriceLockConfig();
  const priceLockActive = priceLock.stripeConfigured && priceLock.enabled;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-3xl font-bold">Pricing</h1>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            Free to start, Premium when you want the full AI toolkit — and Family and Team plans
            for households and businesses.
          </p>

          {/* Payments status — stated before any price, so no plan
              below can be read as something you can buy today. */}
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
            <p className="font-semibold">Payments aren&apos;t live yet</p>
            <p className="mt-1 text-muted-foreground">
              Stripe is in test mode, so no paid plan can be bought today and no free trial is
              offered — there are no trial terms yet. Creating an account is free. The
              $9.99/month Premium price below is the planned price, not a live charge; Family
              pricing is still to be announced and Team pricing is custom.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((tier) => {
              const cta = HONEST_CTA[tier.id];
              return (
                <div
                  key={tier.id}
                  className={`flex flex-col rounded-xl border p-6 ${
                    tier.highlighted ? 'border-blue-600 shadow-lg' : 'border-slate-200'
                  }`}
                >
                  <h2 className="text-xl font-bold">{tier.name}</h2>
                  <p className="mt-1 text-3xl font-extrabold">
                    {tier.priceLabel}
                    {tier.period ? (
                      <span className="ml-1 text-sm font-normal text-muted-foreground">
                        {tier.period}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{availabilityLabel(tier)}</p>
                  <p className="mt-3 text-sm text-muted-foreground">{tier.description}</p>
                  <ul className="mt-4 flex-1 space-y-2 text-sm">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <span aria-hidden="true" className="text-green-600">
                          ✓
                        </span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {tier.id === 'premium' ? (
                    <p className="mt-4 text-xs text-muted-foreground">
                      No trial starts today — signing up creates a free account. Premium billing
                      starts only once payments go live.
                    </p>
                  ) : null}
                  <Link
                    href={cta.href}
                    className={`mt-6 inline-block rounded-lg px-4 py-2 text-center text-sm font-semibold ${
                      tier.highlighted
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-muted text-foreground hover:bg-accent'
                    }`}
                  >
                    {cta.label}
                  </Link>
                </div>
              );
            })}
          </div>

          {/* Price-lock is a listed feature on Premium, Family and
              Team — footnoted here so the bullet above is never read
              as a live guarantee. */}
          <p className="mt-6 text-sm text-muted-foreground">
            The price-lock guarantee listed on Premium, Family and Team is{' '}
            {priceLockActive
              ? 'enabled — checkout wiring is being connected.'
              : 'dormant until Stripe is configured — no lock is in force today.'}{' '}
            If the same retailer listing drops within {priceLock.guaranteeDays} days of your
            purchase, the difference is credited back — once price-lock is active.
          </p>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-6">
              <h2 className="text-lg font-bold">Price-lock guarantee</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Premium, Family, and Team members are covered on eligible deals: if the same
                retailer listing drops within {priceLock.guaranteeDays} days of your purchase, the
                difference is credited back.
              </p>
              <p className="mt-2 text-sm font-medium">
                {priceLockActive
                  ? 'Price-lock is enabled — checkout wiring is being connected.'
                  : 'Price-lock is not active yet — it starts once Stripe is configured. No lock is in force today.'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-6">
              <h2 className="text-lg font-bold">Building with the API?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                The public API is free and key-optional, with daily quotas per tier — 100
                requests/day anonymous, up to 100,000/day on Team. See the quota table in the{' '}
                <Link href="/api-docs" className="font-medium underline underline-offset-4">
                  API docs
                </Link>
                .
              </p>
              <p className="mt-2 text-sm font-medium">
                API access is included with the Team plan.
              </p>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
