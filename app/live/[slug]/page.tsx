/**
 * Live shopping session detail — /live/[slug].
 *
 * Shows the session (status derived from dates + stream_url presence),
 * a countdown while it is upcoming, and — once a stream URL is
 * recorded — a LINK OUT to the provider's stream. The stream is never
 * embedded (no iframe, no CSP change). Linked products are listed at
 * their recorded prices (lowest in-stock merchant listing,
 * re-read at view time — a re-read, not a live check); a product
 * with no recorded listing says so honestly instead of showing an
 * invented price. Each product row carries the stale-price badge,
 * so a stale recorded price never reads as current.
 *
 * 'Notify me' reuses the existing price-drop alert chain: the page
 * points visitors at the product pages, where a signed-in visitor
 * sets an alert at the price they would actually pay.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ExternalLink, Radio } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EventCountdown } from '@/components/seasonal/countdown';
import { StalePriceBadge } from '@/components/products/stale-price-badge';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getLiveSessionDetail, liveSessionStatusLabel } from '@/lib/live-sessions';
import { appConfig } from '@/lib/config/app';
import { buildLiveSessionEventJsonLd, toJsonLd } from '@/lib/json-ld';

export const dynamic = 'force-dynamic';

// Section 14, Chunk 6: per-session metadata — title/description
// from the recorded session (host note when one exists), self-
// canonical per session. Until migration 033 runs there is no
// session to read, so the fallback title covers that case.
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const supabase = await createSupabaseServerClient();
  const { session, liveEnabled } = await getLiveSessionDetail(supabase, params.slug);
  if (!liveEnabled || !session) {
    return { title: 'Live shopping — SmartBuy AI' };
  }
  const title = `${session.title} — SmartBuy AI`;
  const description =
    session.hostNote ??
    'A scheduled live shopping session — a host walks through real products, each linking to its product page with its recorded price.';
  return {
    title,
    description,
    alternates: {
      canonical: `${appConfig.url}/live/${session.slug}`,
    },
    openGraph: {
      title,
      description,
      url: `${appConfig.url}/live/${session.slug}`,
      type: 'website',
      locale: 'en_US',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

/**
 * Recorded merchant prices are USD unless a 3-letter currency code
 * was recorded on the listing; currency_id is NULL on the seed rows,
 * so the USD format is the default, not an assumption about a
 * specific listing.
 */
function formatPrice(price: number, currencyId: string | null): string {
  if (currencyId && /^[A-Za-z]{3}$/.test(currencyId)) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyId.toUpperCase(),
      }).format(price);
    } catch {
      // Fall through to the USD format below.
    }
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(price);
}

export default async function LiveSessionPage({ params }: { params: { slug: string } }) {
  const supabase = await createSupabaseServerClient();
  const { session, products, liveEnabled } = await getLiveSessionDetail(supabase, params.slug);

  if (!liveEnabled) {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="container mx-auto flex-1 px-4 py-12">
          <div className="mx-auto max-w-2xl">
            <h1 className="text-3xl font-bold">Live shopping</h1>
            <p className="mt-2 text-muted-foreground">
              Live shopping is not set up yet — no sessions have been
              scheduled. Sessions will appear on the{' '}
              <Link href="/live" className="underline">
                live shopping page
              </Link>{' '}
              once they exist.
            </p>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (!session) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 14, Chunk 6: Event schema from the recorded session
          (scheduled start, recorded end, host note as description). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: toJsonLd(buildLiveSessionEventJsonLd(appConfig.url, session)),
        }}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm font-medium text-muted-foreground">
            <Link href="/live" className="underline">
              Live shopping
            </Link>
          </p>
          <h1 className="mt-2 flex items-center gap-2 text-3xl font-bold">
            <Radio className="h-7 w-7 text-blue-600" /> {session.title}
          </h1>
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            {liveSessionStatusLabel(session.status)}
          </p>
          {session.hostNote ? (
            <p className="mt-2 text-muted-foreground">{session.hostNote}</p>
          ) : null}

          <p className="mt-4 text-sm text-muted-foreground">
            Starts{' '}
            <time dateTime={session.startsAt}>
              {new Date(session.startsAt).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </time>
            {session.endsAt ? (
              <>
                {' — ends '}
                <time dateTime={session.endsAt}>
                  {new Date(session.endsAt).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </time>
              </>
            ) : null}
          </p>

          {session.status === 'upcoming' ? (
            <EventCountdown targetIso={session.startsAt} label={session.title} />
          ) : null}

          {session.status === 'live_now' && session.streamUrl ? (
            <div className="mt-6 rounded-lg border p-6">
              <p className="font-medium">This session is live now.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The stream plays on the provider&apos;s own site — SmartBuy
                does not host or embed the video.
              </p>
              <a
                href={session.streamUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Watch the live stream <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          ) : null}

          {session.status === 'scheduled_no_stream' ? (
            <div className="mt-6 rounded-lg border p-6">
              <p className="font-medium">Scheduled — no stream yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This session is scheduled, but no stream link has been
                recorded yet. The link will appear here once the host
                provides it — check back closer to the start time.
              </p>
            </div>
          ) : null}

          {session.status === 'ended' ? (
            <p className="mt-6 text-sm text-muted-foreground">
              This session has ended. The products below are still listed
              at their recorded prices.
            </p>
          ) : null}

          <h2 className="mt-8 text-xl font-semibold">Products in this session</h2>
          {products.length === 0 ? (
            <p className="mt-3 text-muted-foreground">
              No products have been linked to this session yet.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {products.map(({ product, lowestPrice, currencyId, inStock }) => (
                <div key={product.id} className="rounded-lg border p-4">
                  <p className="font-medium">{product.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {lowestPrice !== null ? (
                      <>
                        From {formatPrice(lowestPrice, currencyId)}
                        {inStock ? '' : ' (not currently in stock at that listing)'}
                      </>
                    ) : (
                      'No current price recorded for this product.'
                    )}
                  </p>
                  {/* Final 100% (F-P1-03): the session price is a
                      recorded price — the stale badge + age render
                      under it, as on the product card. */}
                  {lowestPrice !== null && (
                    <p className="mt-1">
                      <StalePriceBadge dataFreshness={product.dataFreshness} />
                    </p>
                  )}
                  <Link
                    href={`/products/${product.slug}`}
                    className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
                  >
                    View {product.name} →
                  </Link>
                </div>
              ))}
            </div>
          )}

          <h2 className="mt-8 text-xl font-semibold">Notify me</h2>
          <p className="mt-3 text-muted-foreground">
            There is no separate live-session notification — notifications
            use the same price-drop alerts as the rest of the site. Open a
            product above, sign in, and set a price-drop alert at the price
            you would actually pay. The full step-by-step guide is in the{' '}
            <Link href="/blog/how-to-set-up-price-drop-alerts" className="underline">
              price-drop alerts guide
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
