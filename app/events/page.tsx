/**
 * Seasonal events index — /events.
 *
 * Lists the five event landing pages (Black Friday, Cyber Monday, 11.11, Eid al-Fitr, Eid al-Adha)
 * from the same SEASONAL_EVENTS data the [slug] pages render, so
 * the list and the pages can never disagree. Dates are calendar
 * facts from that data; the Eid date is labelled "expected" there
 * and here. No event prices are invented on this page — the only
 * deals named anywhere are the six recorded demo deals, and this
 * page does not repeat them.
 */

import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { LocalizedHeading } from '@/components/i18n/localized-heading';
import { SiteFooter } from '@/components/layout/site-footer';
import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';
import { SEASONAL_EVENTS } from '@/components/seasonal/events';

// Section 13, Chunk E: self-canonical + Open Graph metadata (the
// root layout's canonical points at the homepage, so without this
// the page self-canonicalizes to /).
export const metadata: Metadata = {
  title: 'Seasonal events — SmartBuy AI',
  description:
    'The year’s big sale events, and how to shop each one without trusting the badge — check the price history, set an alert at the price you would actually pay, and let the alert decide.',
  alternates: {
    canonical: `${appConfig.url}/events`,
  },
  openGraph: {
    title: 'Seasonal events — SmartBuy AI',
    description:
      'The year’s big sale events, and how to shop each one without trusting the badge — check the price history, set an alert at the price you would actually pay, and let the alert decide.',
    url: `${appConfig.url}/events`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Seasonal events — SmartBuy AI',
    description:
      'The year’s big sale events, and how to shop each one without trusting the badge — check the price history, set an alert at the price you would actually pay, and let the alert decide.',
  },
};

export default function EventsIndexPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <LocalizedHeading
            dictKey="pageHeadingEvents"
            className="flex items-center gap-2 text-3xl font-bold"
            icon={<CalendarDays className="h-7 w-7 text-blue-600" />}
          />
          <p className="mt-2 text-muted-foreground">
            The year&apos;s big sale events, and how to shop each one without trusting the
            badge — check the price history, set an alert at the price you would actually
            pay, and let the alert decide.
          </p>

          <div className="mt-8 space-y-4">
            {SEASONAL_EVENTS.map((event) => (
              <article key={event.slug} className="rounded-lg border p-6">
                <h2 className="text-xl font-semibold">
                  <Link
                    href={`/events/${event.slug}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {event.name}
                  </Link>
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{event.tagline}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Starts{' '}
                  <time dateTime={event.startsAt}>
                    {new Date(event.startsAt).toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </time>
                  {event.dateExpected ? ' (expected date — confirmed by moon sighting)' : ''}
                </p>
                <Link
                  href={`/events/${event.slug}`}
                  className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Plan for {event.name} →
                </Link>
              </article>
            ))}
          </div>

          <p className="mt-8 text-sm text-muted-foreground">
            Looking for deals right now instead? See the{' '}
            <Link href="/deals" className="underline">
              deals page
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
