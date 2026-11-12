/**
 * Creator storefronts index — /creators.
 *
 * Lists creators who have a public slug and at least one verified
 * deal, ranked by points (see lib/creator-storefront.ts
 * `getTopCreators`). Until migration 031/033 data exists, the
 * honest empty state below is shown — no creators, bios, follower
 * counts, or earnings are ever invented. No revenue-share figures
 * appear anywhere on this page.
 */

import Link from 'next/link';
import { Store, Award } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';
import { getTopCreators } from '@/lib/creator-storefront';
import { BADGE_THRESHOLDS, nextBadge } from '@/lib/creator-rewards';

export const dynamic = 'force-dynamic';

// Section 13, Chunk E: self-canonical + Open Graph metadata (the
// root layout's canonical points at the homepage, so without this
// the page self-canonicalizes to /).
export const metadata: Metadata = {
  title: 'Creators — SmartBuy AI',
  description:
    'Community members who share verified deals. A creator appears here once they have a public storefront and at least one verified deal.',
  alternates: {
    canonical: `${appConfig.url}/creators`,
  },
  openGraph: {
    title: 'Creators — SmartBuy AI',
    description:
      'Community members who share verified deals. A creator appears here once they have a public storefront and at least one verified deal.',
    url: `${appConfig.url}/creators`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Creators — SmartBuy AI',
    description:
      'Community members who share verified deals. A creator appears here once they have a public storefront and at least one verified deal.',
  },
};

export default async function CreatorsPage() {
  const supabase = await createSupabaseServerClient();
  const creators = await getTopCreators(supabase);

  // Section 13, item 60 — the signed-in visitor's own rank in
  // this same ranked list (index + 1, so it always matches the
  // #N shown next to each creator). Null when signed out or not
  // listed — no rank is ever shown for someone who has none.
  let myRank: number | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const idx = creators.findIndex((c) => c.userId === user.id);
      if (idx >= 0) myRank = idx + 1;
    }
  } catch {
    // Signed-out or auth unavailable — no "your rank" line.
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList, ItemList). */}
      <PageJsonLd
        name="Creators"
        description="Community members who share verified deals. A creator appears here once they have a public storefront and at least one verified deal."
        path="/creators"
        crumbs={[ { name: "Home", path: "/" }, { name: "Creators" } ]}
        items={creators.map((creator) => ({ name: creator.displayName ?? 'Creator', path: `/creators/${creator.slug}` }))}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Store className="h-7 w-7 text-blue-600" /> Creators
          </h1>
          <p className="mt-2 text-muted-foreground">
            Community members who share verified deals. A creator appears
            here once they have a public storefront and at least one
            verified deal — verification comes from an admin confirmation
            or a merchant-price match, never from votes.
          </p>

          {/* Section 14, chunk 9 — badge ladder. The thresholds are
              program rules from lib/creator-rewards.ts (10 points per
              verified deal; a badge needs verified deals, never
              votes), so the ladder is honest even when no creator is
              listed yet: it describes the rules, not invented holders.
              No revenue-share figure appears — the share is not
              configured (see lib/creator-rewards.ts). */}
          <div className="mt-8 rounded-lg border p-6">
            <h2 className="text-lg font-semibold">Badge ladder</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Badges are earned only with verified deals — 10 points per verified deal, and a
              badge needs the verified-deal count, not just points. Upvotes never earn points
              or badges.
            </p>
            <ol className="mt-4 space-y-2 text-sm">
              {BADGE_THRESHOLDS.map((t) => (
                <li key={t.badge} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.label}</span>
                  <span className="text-muted-foreground">
                    — {t.verifiedDeals} verified deal{t.verifiedDeals !== 1 ? 's' : ''} ·{' '}
                    {t.points} points
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-sm text-muted-foreground">
              No badge yet below 1 verified deal. There is no higher badge than Platinum
              Contributor — 30 verified deals is the top of the ladder.
            </p>
          </div>

          {creators.length === 0 ? (
            <div className="mt-8 rounded-lg border p-6">
              <p className="font-medium">No creator storefronts yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                No creator has a public storefront with a verified deal
                yet. Creators can set a public slug on their profile, and
                their storefront will appear here once they share a
                verified deal.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-4">
              {/* Section 13, item 60 — your rank in this list. */}
              {myRank !== null && (
                <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
                  Your rank: <strong>#{myRank}</strong> of {creators.length} creators.
                </p>
              )}
              {creators.map((creator, index) => (
                <article key={creator.userId} className="rounded-lg border p-6">
                  <h2 className="text-xl font-semibold">
                    <span className="mr-2 text-muted-foreground">#{index + 1}</span>
                    <Link href={`/creators/${creator.slug}`} className="hover:underline">
                      {creator.displayName ?? 'Creator'}
                    </Link>
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Award className="h-4 w-4" />
                      {creator.badgeLabel}
                    </span>
                    <span>·</span>
                    <span>
                      {creator.verifiedDeals} verified deal{creator.verifiedDeals !== 1 ? 's' : ''}
                    </span>
                    <span>·</span>
                    <span>{creator.points} points</span>
                    <span>·</span>
                    <span>
                      {(() => {
                        const next = nextBadge(creator.verifiedDeals);
                        return next
                          ? `Next: ${next.label} at ${next.verifiedDeals} verified deals (${next.verifiedDeals - creator.verifiedDeals} to go)`
                          : 'Top of the ladder — Platinum Contributor';
                      })()}
                    </span>
                  </p>
                  <Link
                    href={`/creators/${creator.slug}`}
                    className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline"
                  >
                    View storefront
                  </Link>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
