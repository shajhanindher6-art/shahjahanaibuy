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
import { SiteFooter } from '@/components/layout/site-footer';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getTopCreators } from '@/lib/creator-storefront';

export const dynamic = 'force-dynamic';

export default async function CreatorsPage() {
  const supabase = await createSupabaseServerClient();
  const creators = await getTopCreators(supabase);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
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
              {creators.map((creator) => (
                <article key={creator.userId} className="rounded-lg border p-6">
                  <h2 className="text-xl font-semibold">
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
