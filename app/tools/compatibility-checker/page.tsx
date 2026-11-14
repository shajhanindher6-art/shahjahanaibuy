/**
 * AI Accessory Compatibility Checker — /tools/compatibility-checker.
 *
 * "Will this accessory work with my device?" Pick a device + an
 * accessory from the catalog → a verdict.
 *
 * Server component, no JavaScript needed: the form submits as a
 * plain GET to this same page. Data: getCachedProducts +
 * getLowestMerchantPrices; the verdict comes ONLY from
 * services/compatibility.ts via lib/compatibility-checker.ts.
 *
 * Honesty: "Exact" is NEVER assigned (no compatibility data source
 * exists — no connector/interface fields). Same brand + same
 * category → "Likely", same category only → "Possible", otherwise
 * "Unknown". Every verdict carries "verify before buying". The
 * connector note is always the honest fallback — no connector info
 * is recorded for any product. Picking the same product twice is
 * rejected, never graded "Likely".
 */

import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PlugZap } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { RelatedTools } from '@/components/tools/related-tools';
import { SaveCalculationButton } from '@/components/tools/save-calculation-button';
import { ShareButtons } from '@/components/products/share-buttons';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getLowestMerchantPrices } from '@/services/products';
import { getCachedProducts, parseToolParams } from '@/services/tool-integration';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import {
  checkCompatibility,
  COMPATIBILITY_VERIFY_NOTE,
  parseCompatibilityParams,
  type CompatibilityProductInput,
} from '@/lib/compatibility-checker';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Accessory Compatibility Checker — SmartBuy AI',
  description:
    'Will this accessory work with your device? Pick a device and an accessory from the catalog for an honest verdict — verify before buying.',
  alternates: {
    canonical: `${appConfig.url}/tools/compatibility-checker`,
  },
  openGraph: {
    title: 'AI Accessory Compatibility Checker — SmartBuy AI',
    description:
      'Will this accessory work with your device? Pick a device and an accessory from the catalog for an honest verdict — verify before buying.',
    url: `${appConfig.url}/tools/compatibility-checker`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'AI Accessory Compatibility Checker — SmartBuy AI',
    description:
      'Will this accessory work with your device? Pick a device and an accessory from the catalog for an honest verdict — verify before buying.',
  },
};

interface CompatibilityCheckerPageProps {
  searchParams: { device?: string | string[]; accessory?: string | string[] };
}

export default async function CompatibilityCheckerPage({
  searchParams,
}: CompatibilityCheckerPageProps) {
  const { deviceSlug, accessorySlug, hasQuery } = parseCompatibilityParams(searchParams);

  const supabase = await createSupabaseServerClient();
  const { products } = await getCachedProducts(supabase, { page: 1, pageSize: 100 });
  const lowest = await getLowestMerchantPrices(
    supabase,
    products.map((p) => p.id)
  );
  const options: Array<CompatibilityProductInput & { dataFreshness: string }> =
    products.map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      category: product.category,
      priceUsd: lowest.get(product.id)?.price ?? null,
      dataFreshness: product.dataFreshness,
    }));

  const device = deviceSlug ? options.find((p) => p.slug === deviceSlug) ?? null : null;
  const accessory = accessorySlug
    ? options.find((p) => p.slug === accessorySlug) ?? null
    : null;
  const bothPicked = device !== null && accessory !== null;
  const result = bothPicked ? checkCompatibility(device, accessory) : null;
  const unknownSlug =
    hasQuery &&
    ((deviceSlug !== null && device === null) ||
      (accessorySlug !== null && accessory === null));

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: WebPage + BreadcrumbList
          (Home → AI tools → this tool). */}
      <PageJsonLd
        name="AI Accessory Compatibility Checker"
        description="Will this accessory work with your device? Pick a device and an accessory from the catalog for an honest verdict — verify before buying."
        path="/tools/compatibility-checker"
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'AI tools', path: '/tools' },
          { name: 'AI Accessory Compatibility Checker' },
        ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <PlugZap className="h-7 w-7 text-blue-600" /> AI Accessory Compatibility Checker
          </h1>
          <p className="mt-2 text-muted-foreground">
            Will this accessory work with your device? Pick a device
            and an accessory from the catalog. The verdict is based
            only on recorded brand and category — no compatibility
            data source exists, so no pair is ever called confirmed
            compatible. {COMPATIBILITY_VERIFY_NOTE}
          </p>

          <form
            method="get"
            action="/tools/compatibility-checker"
            className="mt-8 rounded-lg border p-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="device" className="text-sm font-medium">
                  Your device
                </label>
                <select
                  id="device"
                  name="device"
                  defaultValue={deviceSlug ?? ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Pick a device</option>
                  {options.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="accessory" className="text-sm font-medium">
                  Accessory
                </label>
                <select
                  id="accessory"
                  name="accessory"
                  defaultValue={accessorySlug ?? ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Pick an accessory</option>
                  {options.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="submit" className="mt-4">
              Check compatibility →
            </Button>
          </form>

          {hasQuery && unknownSlug && (
            <div className="mt-6">
              <EmptyState
                eyebrow="Product not found"
                title="One of the picked products is not in the catalog"
                description="The link may name a product that was removed, or a slug that was typed by hand. Pick both products from the lists above."
                action={
                  <Link
                    href="/tools/compatibility-checker"
                    className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Clear and try again
                  </Link>
                }
              />
            </div>
          )}

          {hasQuery && !unknownSlug && bothPicked && result !== null && !result.ok && (
            <div className="mt-6">
              <EmptyState
                eyebrow="Same product twice"
                title="Pick two different products"
                description="A product is not checked against itself — pick a device and a different accessory to compare."
                action={
                  <Link
                    href="/tools/compatibility-checker"
                    className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Clear and try again
                  </Link>
                }
              />
            </div>
          )}

          {hasQuery && !unknownSlug && bothPicked && result !== null && result.ok && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">
                {result.check.device.name} + {result.check.accessory.name}
              </h2>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Share this check:
                </span>
                <ShareButtons
                  title={`${result.check.device.name} + ${result.check.accessory.name} — SmartBuy AI`}
                  text={`${result.check.device.name} + ${result.check.accessory.name}: ${result.check.grade} — SmartBuy AI`}
                />
              </div>

              <article className="mt-6 rounded-lg border p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Verdict
                </p>
                <p className="mt-1 text-2xl font-bold">{result.check.grade}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {result.check.gradeNote}
                </p>
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  {COMPATIBILITY_VERIFY_NOTE}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  {result.check.connectorNote}
                </p>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Device</dt>
                    <dd className="mt-1 font-semibold">
                      <Link
                        href={`/products/${result.check.device.slug}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {result.check.device.name}
                      </Link>
                    </dd>
                    <dd className="mt-1 text-muted-foreground">
                      {result.check.device.brand ?? 'Unknown brand'}
                      {result.check.device.category
                        ? ` · ${result.check.device.category}`
                        : ''}
                      {result.check.device.priceUsd !== null
                        ? ` · $${result.check.device.priceUsd.toFixed(2)}`
                        : ' · Price not recorded'}
                    </dd>
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Accessory</dt>
                    <dd className="mt-1 font-semibold">
                      <Link
                        href={`/products/${result.check.accessory.slug}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {result.check.accessory.name}
                      </Link>
                    </dd>
                    <dd className="mt-1 text-muted-foreground">
                      {result.check.accessory.brand ?? 'Unknown brand'}
                      {result.check.accessory.category
                        ? ` · ${result.check.accessory.category}`
                        : ''}
                      {result.check.accessory.priceUsd !== null
                        ? ` · $${result.check.accessory.priceUsd.toFixed(2)}`
                        : ' · Price not recorded'}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  Prices are recorded prices (see the product pages for
                  their last-checked age). This verdict is a brand +
                  category signal only — it is never a confirmed-compatible
                  verdict, because no compatibility data is recorded.
                </p>
              </article>
              <div className="mt-6">
                <SaveCalculationButton
                  tool="compatibility-checker"
                  label={`${result.check.device.name} + ${result.check.accessory.name} — ${result.check.grade}`.slice(0, 100)}
                  params={{ device: deviceSlug ?? '', accessory: accessorySlug ?? '' }}
                />
              </div>
            </section>
          )}

          {hasQuery && !bothPicked && !unknownSlug && (
            <p className="mt-8 text-sm text-muted-foreground">
              Pick both a device and an accessory above to see the verdict.
            </p>
          )}

          {!hasQuery && options.length > 0 && (
            <p className="mt-8 text-sm text-muted-foreground">
              Tip: try{' '}
              <Link
                href="/tools/compatibility-checker?device=macbook-air-13&accessory=logitech-mx-master-3s"
                className="underline underline-offset-4"
              >
                MacBook Air 13 + Logitech MX Master 3S
              </Link>{' '}
              or{' '}
              <Link
                href="/tools/compatibility-checker?device=galaxy-s24-ultra&accessory=sony-wh-1000xm5"
                className="underline underline-offset-4"
              >
                Galaxy S24 Ultra + Sony WH-1000XM5
              </Link>
              .
            </p>
          )}

          {!hasQuery && options.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No products yet"
                title="No products to check"
                description="The catalog is empty right now, so there is no device or accessory to compare."
              />
            </div>
          )}
          <RelatedTools tool="compatibility-checker" productSlug={deviceSlug ?? null} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
