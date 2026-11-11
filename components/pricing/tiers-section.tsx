/**
 * Premium tiers 2.0 — pricing section (S5#17).
 *
 * Free / Premium / Family / Team, rendered from lib/tiers.ts.
 * Premium keeps the live $9.99/month price. Family's price is "To
 * be announced" (owner decision pending — never an invented number)
 * and Team is custom/contact sales. The section also states the
 * price-lock guarantee and concierge honestly: price-lock is
 * included on Premium/Family/Team but dormant until Stripe is
 * configured (lib/price-lock.ts); concierge is a Team-tier human
 * help offer, not an automated service.
 *
 * Server component, no client JS. NOT wired into app/page.tsx yet —
 * homepage wiring is wave 2 (another worker owns app/page.tsx).
 */

import Link from 'next/link';
import { TIERS, availabilityLabel } from '@/lib/tiers';
import { getPriceLockConfig } from '@/lib/price-lock';

export function TiersSection() {
  const priceLock = getPriceLockConfig();
  return (
    <section id="pricing-tiers" className="py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Choose your plan</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Free to start, Premium when you want the full AI toolkit — and Family and Team plans
            for households and businesses.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={`flex flex-col rounded-xl border p-6 ${
                tier.highlighted ? 'border-blue-600 shadow-lg' : 'border-slate-200'
              }`}
            >
              <h3 className="text-xl font-bold">{tier.name}</h3>
              <p className="mt-1 text-3xl font-extrabold">
                {tier.priceLabel}
                {tier.period ? (
                  <span className="ml-1 text-sm font-normal text-muted-foreground">{tier.period}</span>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{availabilityLabel(tier)}</p>
              <p className="mt-3 text-sm text-muted-foreground">{tier.description}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span aria-hidden="true" className="text-green-600">✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={tier.href}
                className={`mt-6 inline-block rounded-lg px-4 py-2 text-center text-sm font-semibold ${
                  tier.highlighted
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-muted text-foreground hover:bg-accent'
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-10 max-w-5xl grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-bold">Price-lock guarantee</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Premium, Family, and Team members are covered on eligible deals: if the same
              retailer listing drops within {priceLock.guaranteeDays} days of your purchase, the
              difference is credited back.
            </p>
            <p className="mt-2 text-sm font-medium">
              {priceLock.stripeConfigured && priceLock.enabled
                ? 'Price-lock is enabled — checkout wiring is being connected.'
                : 'Price-lock is not active yet — it starts once Stripe is configured. No lock is in force today.'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-bold">Concierge for large purchases</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Buying in bulk or spending big on one item? Team members get human help — a person
              who checks the deal, the seller, and the timing with you before you buy.
            </p>
            <p className="mt-2 text-sm font-medium">Included with the Team plan.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
