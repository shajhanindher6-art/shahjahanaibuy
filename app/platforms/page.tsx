/**
 * Section 8 — Platforms hub (/platforms).
 *
 * One honest page for every platform SmartBuy connects to: priced
 * merchants, the eBay live API, search-link retailers, the
 * Skimlinks aggregator, and the local-stores directory. Statuses
 * come from services/platform-status.ts (booleans and counts from
 * real configuration only) — a platform with no configured account
 * is shown as "Not configured" or "Search links only", never as
 * "connected". No secret value is ever rendered.
 *
 * Also explains, in plain language, how country detection works:
 * the Vercel geo header (IP-derived country code only — the IP
 * itself is never stored), then the visitor's own saved choice
 * (which always wins), then the US fallback.
 */

import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { LocalizedHeading } from '@/components/i18n/localized-heading';
import {
  describePlatformStatus,
  type PlatformKind,
  type PlatformStatus,
} from '@/services/platform-status';

export const metadata = {
  title: 'Platforms — SmartBuy AI',
  description:
    'Every platform SmartBuy connects to, with honest status: priced merchants, live eBay search, search-link retailers, and the local stores directory.',
};

const KIND_LABELS: Record<PlatformKind, string> = {
  'priced-merchant': 'Priced merchant',
  'live-api': 'Live API',
  'search-link': 'Search link',
  aggregator: 'Affiliate aggregator',
  directory: 'Directory',
};

const STATUS_LABELS: Record<PlatformStatus, string> = {
  live: 'Live',
  configured: 'Configured',
  'not-configured': 'Not configured',
  'search-links-only': 'Search links only',
};

const STATUS_STYLES: Record<PlatformStatus, string> = {
  live: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  configured: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  'not-configured':
    'bg-muted text-foreground dark:bg-muted dark:text-foreground',
  'search-links-only':
    'bg-muted text-foreground dark:bg-muted dark:text-foreground',
};

export default function PlatformsPage() {
  const platforms = describePlatformStatus();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Platforms"
        description="Every platform SmartBuy connects to, with honest status: priced merchants, live eBay search, search-link retailers, and the local stores directory."
        path="/platforms"
        crumbs={[ { name: "Home", path: "/" }, { name: "Platforms" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <LocalizedHeading dictKey="footerLinkPlatforms" className="text-3xl font-bold" />
          <p className="mt-2 text-muted-foreground">
            Every platform SmartBuy connects to — and what you actually get
            from each one. A platform is only shown as connected when its
            account is really configured. Everything else says so plainly.
          </p>

          <div className="mt-8 space-y-4">
            {platforms.map((platform) => (
              <div
                key={platform.id}
                className="rounded-lg border border-slate-200 p-5 dark:border-slate-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">{platform.name}</h2>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[platform.status]}`}
                  >
                    {STATUS_LABELS[platform.status]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {KIND_LABELS[platform.kind]} · {platform.coverage}
                </p>
                <p className="mt-3 text-muted-foreground">
                  {platform.whatYouGet}
                </p>
              </div>
            ))}
          </div>

          <h2 className="mt-12 text-xl font-semibold">
            How your country is detected
          </h2>
          <p className="mt-3 text-muted-foreground">
            SmartBuy shows your country&apos;s stores first, then
            international retailers. Your country is detected from the
            location of your visit (the hosting platform supplies a
            country code from your connection); your own Country
            Switcher choice always wins over detection, and when nothing
            can be detected the site falls back to worldwide stores.
            Your IP address is never stored — only the country code is
            used, and click records keep product, retailer, link, and
            country only.
          </p>
          <p className="mt-3 text-muted-foreground">
            Local stores are search links to the store&apos;s own website.
            SmartBuy never invents a local price, stock state, or deal,
            and a store is added to the directory only after its search
            pattern is verified. See{' '}
            <Link href="/methodology" className="underline">
              how SmartBuy works
            </Link>{' '}
            for the full methodology.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
