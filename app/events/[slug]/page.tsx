import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EventCountdown } from '@/components/seasonal/countdown';
import { SEASONAL_EVENTS, RECORDED_DEALS, getEventBySlug } from '@/components/seasonal/events';
import { appConfig } from '@/lib/config/app';
import { buildEventJsonLd, toJsonLd } from '@/lib/json-ld';

export function generateStaticParams() {
  return SEASONAL_EVENTS.map((event) => ({ slug: event.slug }));
}

// Section 13, Chunk E: per-event metadata — title/description from
// the recorded SEASONAL_EVENTS entry, self-canonical per event.
// An unknown slug 404s (see the component); the fallback title
// covers the metadata call for that slug.
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const event = getEventBySlug(params.slug);
  if (!event) {
    return { title: 'Event not found — SmartBuy AI' };
  }
  const title = `${event.name} — SmartBuy AI`;
  return {
    title,
    description: event.tagline,
    alternates: {
      canonical: `${appConfig.url}/events/${event.slug}`,
    },
    openGraph: {
      title,
      description: event.tagline,
      url: `${appConfig.url}/events/${event.slug}`,
      type: 'website',
      locale: 'en_US',
    },
    twitter: {
      card: 'summary',
      title,
      description: event.tagline,
    },
  };
}

export default function EventPage({ params }: { params: { slug: string } }) {
  const event = getEventBySlug(params.slug);
  if (!event) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 13, Chunk E: Event schema from the recorded event
          (startDate only when the date is confirmed — see
          buildEventJsonLd). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: toJsonLd(buildEventJsonLd(appConfig.url, event)),
        }}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm font-medium text-muted-foreground">
            <Link href="/deals" className="underline">
              Deals
            </Link>
            {' / '}Seasonal events
          </p>
          <h1 className="mt-2 text-3xl font-bold">{event.name}</h1>
          <p className="mt-2 text-muted-foreground">{event.tagline}</p>

          <EventCountdown targetIso={event.startsAt} label={event.name} />
          {event.dateExpected ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Expected date — the exact day of Eid is confirmed by moon sighting, so this
              date may move by a day.
            </p>
          ) : null}

          <p className="mt-6 leading-relaxed text-foreground/90">{event.description}</p>

          <h2 className="mt-8 text-xl font-semibold">How to shop this event</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
            {event.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>

          <h2 className="mt-8 text-xl font-semibold">Event alerts</h2>
          <p className="mt-3 text-muted-foreground">
            There is no separate event-alert system — event alerts use the same price-drop
            alerts as the rest of the site. Before the event, open a product below, sign
            in, and set a price-drop alert at the price you would actually pay. Prices are
            refreshed every six hours, and you are notified by email or push when the price
            reaches your target. The full step-by-step guide is in the{' '}
            <Link href="/blog/how-to-set-up-price-drop-alerts" className="underline">
              price-drop alerts guide
            </Link>
            .
          </p>

          <h2 className="mt-8 text-xl font-semibold">Recorded deals</h2>
          <p className="mt-3 text-muted-foreground">
            The deals below are the six demo launch deals recorded in SmartBuy&apos;s own
            deals table. They are the only deals the site records today, and they are
            labelled demo — no event-specific prices have been invented for this page.
            Discount percentages here are the deals as recorded, measured on the deals
            table basis (see the{' '}
            <Link href="/methodology" className="underline">
              methodology page
            </Link>{' '}
            for why that can differ from product-page percentages).
          </p>
          <div className="mt-4 space-y-3">
            {RECORDED_DEALS.map((deal) => (
              <div key={deal.productSlug} className="rounded-lg border p-4">
                <p className="font-medium">{deal.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {deal.dealType === 'flash' ? 'Flash deal' : 'Seasonal deal'} · {deal.discountValue}% off
                  (recorded demo deal)
                </p>
                <Link
                  href={`/products/${deal.productSlug}`}
                  className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
                >
                  View {deal.productName} →
                </Link>
              </div>
            ))}
          </div>

          <p className="mt-8 text-sm text-muted-foreground">
            More events: see all current deals on the{' '}
            <Link href="/deals" className="underline">
              deals page
            </Link>
            , or read the{' '}
            <Link href="/blog/best-time-to-buy-a-laptop-alerts" className="underline">
              guide to timing a purchase
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
