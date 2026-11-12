/**
 * Store Trust Checker — /tools/store-trust-checker (Section 16, E5).
 *
 * Pick any of the 84 directory stores and see its trust grade
 * (A–D) with the recorded evidence behind it — or an honest
 * "Not enough data" listing the missing policy facts.
 *
 * Server component, no JavaScript needed: the store picker is a
 * plain GET form (?store=<slug|countryCode>), so a checked store
 * is a shareable URL. The grade comes from lib/merchant-trust.ts
 * via the same reads as GET /api/v1/merchants/[slug]/trust.
 *
 * Honesty: only the priced merchants in the `merchants` table
 * can have a policy record at all, and the policy columns are
 * NULL until the owner verifies the real policy facts — so most
 * stores honestly show "Not enough data". That is the point of
 * this page: it shows what is recorded, never a guessed grade.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getMerchants } from '@/services/commerce';
import { computeTrustGrade, getMerchantPolicy } from '@/lib/merchant-trust';
import {
  ALL_DIRECTORY_STORES,
  describeStoreTrust,
  directoryStoreKey,
  findDirectoryStore,
  parseStoreTrustParams,
} from '@/lib/store-trust-checker';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Store Trust Checker — SmartBuy AI',
  description:
    'Pick any of the 84 stores and see its trust grade (A–D) with recorded evidence — or an honest "Not enough data" listing the policy facts still missing.',
  alternates: {
    canonical: `${appConfig.url}/tools/store-trust-checker`,
  },
  openGraph: {
    title: 'Store Trust Checker — SmartBuy AI',
    description:
      'Pick any of the 84 stores and see its trust grade (A–D) with recorded evidence — or an honest "Not enough data" listing the policy facts still missing.',
    url: `${appConfig.url}/tools/store-trust-checker`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Store Trust Checker — SmartBuy AI',
    description:
      'Pick any of the 84 stores and see its trust grade (A–D) with recorded evidence — or an honest "Not enough data" listing the policy facts still missing.',
  },
};

interface StoreTrustCheckerProps {
  searchParams: { store?: string | string[] };
}

export default async function StoreTrustCheckerPage({
  searchParams,
}: StoreTrustCheckerProps) {
  const { storeKey } = parseStoreTrustParams(searchParams);
  const store = findDirectoryStore(storeKey);

  let merchantFound = false;
  let grade: ReturnType<typeof computeTrustGrade> | null = null;
  let recorded: {
    returnWindowDays: number | null;
    warrantyMonths: number | null;
    reputationScore: number | null;
  } | null = null;

  if (store !== null) {
    const supabase = await createSupabaseServerClient();
    const merchants = await getMerchants(supabase);
    const merchant = merchants.find((m) => m.slug === store.slug) ?? null;
    merchantFound = merchant !== null;
    if (merchant) {
      const policy = await getMerchantPolicy(supabase, merchant.id);
      grade = computeTrustGrade(policy);
      recorded = {
        returnWindowDays: policy.returnWindowDays,
        warrantyMonths: policy.warrantyMonths,
        reputationScore: policy.reputationScore,
      };
    }
  }

  const display = describeStoreTrust({ store, storeKey, merchantFound, grade });

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Store Trust Checker"
        description="Pick any of the 84 stores and see its trust grade (A–D) with recorded evidence — or an honest &quot;Not enough data&quot; listing the policy facts still missing."
        path="/tools/store-trust-checker"
        crumbs={[ { name: "Home", path: "/" }, { name: "AI tools", path: "/tools" }, { name: "Store Trust Checker" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <ShieldCheck className="h-7 w-7 text-blue-600" /> Store Trust Checker
          </h1>
          <p className="mt-2 text-muted-foreground">
            Pick any of the {ALL_DIRECTORY_STORES.length} stores in the
            directory and see its trust grade — A (≥85), B (≥70), C
            (≥50), D (&lt;50) — computed only from recorded policy
            facts: return window, warranty length, and reputation.
            When any fact is still missing, the page says so plainly
            instead of showing a grade.
          </p>

          <form
            method="get"
            action="/tools/store-trust-checker"
            className="mt-8 rounded-lg border p-6"
          >
            <label htmlFor="store" className="text-sm font-medium">
              Store
            </label>
            <select
              id="store"
              name="store"
              defaultValue={storeKey ?? ''}
              className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">Choose a store…</option>
              {ALL_DIRECTORY_STORES.map((s) => (
                <option key={directoryStoreKey(s)} value={directoryStoreKey(s)}>
                  {s.name} ({s.countryCode})
                </option>
              ))}
            </select>
            <Button type="submit" className="mt-4">
              Check trust →
            </Button>
          </form>

          {store !== null && (
            <section className="mt-10" aria-live="polite">
              <h2 className="text-xl font-semibold">
                {store.name} ({store.countryCode})
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                <Link href={store.websiteUrl} className="underline-offset-4 hover:underline">
                  {store.websiteUrl}
                </Link>
              </p>
              <div className="mt-4 rounded-lg border p-6">
                <p className="text-2xl font-bold">{display.heading}</p>
                {display.lines.map((line) => (
                  <p key={line} className="mt-2 text-sm text-muted-foreground">
                    {line}
                  </p>
                ))}
                {grade !== null && grade.breakdown !== null && (
                  <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-md bg-muted p-3">
                      <dt className="text-muted-foreground">Return window</dt>
                      <dd className="mt-1 font-semibold">
                        {grade.breakdown.returnWindowPoints}/40
                      </dd>
                    </div>
                    <div className="rounded-md bg-muted p-3">
                      <dt className="text-muted-foreground">Warranty</dt>
                      <dd className="mt-1 font-semibold">
                        {grade.breakdown.warrantyPoints}/30
                      </dd>
                    </div>
                    <div className="rounded-md bg-muted p-3">
                      <dt className="text-muted-foreground">Reputation</dt>
                      <dd className="mt-1 font-semibold">
                        {grade.breakdown.reputationPoints}/30
                      </dd>
                    </div>
                  </dl>
                )}
                {recorded !== null && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Recorded policy facts: return window{' '}
                    {recorded.returnWindowDays === null
                      ? 'not recorded'
                      : `${recorded.returnWindowDays} days`}
                    ; warranty{' '}
                    {recorded.warrantyMonths === null
                      ? 'not recorded'
                      : `${recorded.warrantyMonths} months`}
                    ; reputation{' '}
                    {recorded.reputationScore === null
                      ? 'not recorded'
                      : `${recorded.reputationScore}/5`}
                    . Policy facts are recorded only after the owner
                    verifies them against the store&apos;s own
                    published policy.
                  </p>
                )}
              </div>
            </section>
          )}

          {store === null && storeKey !== null && (
            <div className="mt-6">
              <EmptyState
                eyebrow="Unknown store"
                title="That store is not in the directory"
                description="Pick a store from the list — the directory holds 84 stores, and only those can be checked."
              />
            </div>
          )}

          <p className="mt-8 text-xs text-muted-foreground">
            The same grade is available as data at GET
            /api/v1/merchants/[slug]/trust. Grades are computed only
            from recorded policy data — no values are assumed or
            guessed.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
