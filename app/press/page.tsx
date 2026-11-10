import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { appConfig } from '@/lib/config/app';

const FACTS: Array<[string, string]> = [
  ['Live site', 'https://shahjahanaibuy-b1zp.vercel.app'],
  ['Products in the catalog', '11'],
  ['Merchant listings', '20'],
  ['Recorded price-history rows', '40'],
  ['Deals listed', '6'],
  ['Stores in the directory', '72'],
  ['Regions covered', '60'],
  ['Languages', '8 (English, Urdu, German, French, Spanish, Italian, Portuguese, Turkish)'],
  ['Currencies', '37+ (approximate static rates; live FX in the landed-cost calculator)'],
  ['Price refresh schedule', 'Every 6 hours'],
  ['Recorded price history span', 'About 30 days (October 3 – November 2, 2026)'],
  ['Coupons listed', '2 — SAVE10 and BESTBUY15, both valid until January 29, 2027'],
  ['Blog articles', '20 original English guides'],
  ['Database access policies (RLS)', '194 active'],
  ['Security headers', 'Grade A+ (securityheaders.com), nonce-based Content Security Policy'],
  ['Automated tests passing', '372 (as of November 2026)'],
  ['Founder', 'Independent developer, GitHub: shajhanindher6-art'],
  ['Public repository', 'https://github.com/shajhanindher6-art/shahjahanaibuy'],
];

export default function PressPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">Press</h1>
          <p className="mt-2 text-muted-foreground">
            Facts, assets, and contact details for journalists, bloggers, and anyone writing
            about SmartBuy AI. Every number below is a real figure from the live site as of
            November 2026 — nothing here is rounded up or estimated without a label.
          </p>

          <h2 className="mt-8 text-xl font-semibold">What SmartBuy AI is</h2>
          <p className="mt-3 text-muted-foreground">
            SmartBuy AI is an AI-powered shopping and price-tracking site. It tracks prices
            across retailers, alerts shoppers when a price drops, compares products side by
            side, and explains its own reasoning — including a published methodology for its
            Deal Score. It works across 60 regions and in 8 languages, with local stores
            listed by directory and link, never with invented local prices.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Fact sheet</h2>
          <dl className="mt-4 space-y-3">
            {FACTS.map(([label, value]) => (
              <div key={label} className="border-b pb-3 last:border-b-0">
                <dt className="text-sm font-medium">{label}</dt>
                <dd className="mt-0.5 text-sm text-muted-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">
            Prices in the catalog are the site&apos;s recorded figures, not live retailer
            prices. See the{' '}
            <Link href="/methodology" className="underline">
              methodology page
            </Link>{' '}
            for how every number on this page is produced.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Logo pack</h2>
          <p className="mt-3 text-muted-foreground">
            The SmartBuy AI app icons below are the site&apos;s own public assets. You are
            welcome to use them when writing about SmartBuy AI, at the sizes shown, without
            altering them.
          </p>
          <div className="mt-4 flex items-end gap-6">
            <figure className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon-192.png" alt="SmartBuy AI app icon, 192 pixels" width={96} height={96} />
              <figcaption className="mt-2 text-xs text-muted-foreground">
                <a href="/icon-192.png" className="underline">
                  icon-192.png
                </a>
              </figcaption>
            </figure>
            <figure className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon-512.png" alt="SmartBuy AI app icon, 512 pixels" width={128} height={128} />
              <figcaption className="mt-2 text-xs text-muted-foreground">
                <a href="/icon-512.png" className="underline">
                  icon-512.png
                </a>
              </figcaption>
            </figure>
          </div>

          <h2 className="mt-8 text-xl font-semibold">Screenshots</h2>
          <p className="mt-3 text-muted-foreground">
            There is no prepared screenshot pack yet. The live site itself is the best
            reference — visit{' '}
            <a
              href={appConfig.url}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {appConfig.url}
            </a>{' '}
            and capture the pages you need. If you need a specific screenshot or a quote,
            contact us and we will provide it.
          </p>

          <h2 className="mt-8 text-xl font-semibold">Contact</h2>
          <p className="mt-3 text-muted-foreground">
            For press enquiries, corrections, or interview requests, email{' '}
            <a href={`mailto:${appConfig.supportEmail}`} className="underline">
              {appConfig.supportEmail}
            </a>{' '}
            or use the{' '}
            <Link href="/contact" className="underline">
              contact page
            </Link>
            . Please include your publication, your deadline, and what you need.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
