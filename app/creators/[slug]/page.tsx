/**
 * Creator storefront — /creators/[slug].
 *
 * A storefront is a view over existing rows: the creator's own bio,
 * their derived badge, and their VERIFIED-approved community deals
 * only (see lib/creator-storefront.ts). Unverified and pending deals
 * never appear. No earnings or payout figures are shown — revenue
 * share is unconfigured until the owner sets it, and nothing about
 * it is displayed.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Award, BadgeCheck, Store } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCreatorBySlug } from '@/lib/creator-storefront';

export const dynamic = 'force-dynamic';

export default async function CreatorStorefrontPage({
  params,
}: {
  params: { slug: string };
}) {
  const supabase = await createSupabaseServerClient();
  const creator = await getCreatorBySlug(supabase, params.slug);
  if (!creator) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Store className="h-7 w-7 text-blue-600" /> {creator.displayName ?? 'Creator'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">@{creator.slug}</p>
          {creator.bio && <p className="mt-3 text-muted-foreground">{creator.bio}</p>}
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
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

          <h2 className="mt-10 text-xl font-bold">Verified deals</h2>
          {creator.deals.length === 0 ? (
            <div className="mt-4 rounded-lg border p-6">
              <p className="font-medium">No verified deals yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This creator has not shared a verified deal yet. Only
                deals confirmed by an admin or matched against a real
                merchant price appear here.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {creator.deals.map((deal) => (
                <article key={deal.id} className="rounded-lg border p-6">
                  <p className="inline-flex items-center gap-1 text-sm font-medium text-green-700">
                    <BadgeCheck className="h-4 w-4" /> Verified deal
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">
                    {deal.productSlug ? (
                      <Link href={`/products/${deal.productSlug}`} className="hover:underline">
                        {deal.productName}
                      </Link>
                    ) : (
                      deal.productName
                    )}
                  </h3>
                  {deal.dealText && (
                    <p className="mt-1 text-sm text-muted-foreground">{deal.dealText}</p>
                  )}
                  <p className="mt-2 text-sm">
                    {deal.merchantName ? `${deal.merchantName} · ` : ''}
                    {deal.price !== null ? `$${deal.price.toFixed(2)}` : 'Price not recorded'}
                    {deal.couponCode ? ` · Code: ${deal.couponCode}` : ''}
                  </p>
                  {deal.sourceUrl && (
                    <a
                      href={deal.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-sm font-medium text-blue-600 hover:underline"
                    >
                      View deal
                    </a>
                  )}
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
