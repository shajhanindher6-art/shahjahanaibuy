/**
 * Coming soon — /coming-soon (Section 11, Chunk D).
 *
 * An honest roadmap hub. STATIC page: no API route, no database,
 * no signup form of any kind.
 *
 * Honesty rules enforced here (same pattern as /mobile-app):
 * - NO launch date is promised for anything on this page — ever.
 * - NOTHING is labelled "in development": every item is either
 *   Blocked (a named blocker stands between it and being built)
 *   or Planned — needs owner decision.
 * - NO per-feature signup: collecting interest per feature would
 *   need a new generic-interest table, and that needs a new
 *   migration, which is blocked for this batch. The only waitlist
 *   that exists is the native-app one on /mobile-app, linked below.
 * - The 13 live AI tools are NOT listed here — they are live, on
 *   /tools. This page lists only genuinely planned or blocked
 *   items; anything not confirmed planned is left out rather
 *   than invented.
 * - Shipped work is not duplicated here — see /changelog.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { appConfig } from '@/lib/config/app';

export const metadata: Metadata = {
  title: 'Coming soon — SmartBuy AI',
  description:
    'What SmartBuy AI has planned next, and what is blocking each item. No launch dates are promised.',
  alternates: {
    canonical: `${appConfig.url}/coming-soon`,
  },
};

type RoadmapStatus = 'Blocked' | 'Planned — needs owner decision';

interface RoadmapItem {
  name: string;
  status: RoadmapStatus;
  /** The specific, named blocker — never a vague "coming soon". */
  blocker: string;
  /** Optional link to the one place that already exists for this item. */
  href?: string;
  linkLabel?: string;
}

const ROADMAP_ITEMS: RoadmapItem[] = [
  {
    name: 'Native mobile app',
    status: 'Planned — needs owner decision',
    blocker:
      'No native app is built yet. It needs a separate native build, store accounts, and (for Apple) a $99/year developer account. The waitlist is open — join it on the mobile-app page and you will only be emailed when a native app is available. No launch date is promised.',
    href: '/mobile-app',
    linkLabel: 'Join the native-app waitlist →',
  },
  {
    name: 'Review Summarizer',
    status: 'Blocked',
    blocker:
      'The summarizer engine exists, but it has nothing to summarize: there are 0 reviews recorded today. It stays blocked until real reviews exist.',
  },
  {
    name: 'Recall Alerts',
    status: 'Blocked',
    blocker:
      'No recall data source is connected, so there is nothing to alert about. It stays blocked until a recall feed exists.',
  },
  {
    name: 'Size & Fit',
    status: 'Blocked',
    blocker:
      'No size or fit data is recorded for any product, so there is nothing to base a recommendation on. It stays blocked until size data exists.',
  },
  {
    name: 'Photo Authenticity',
    status: 'Blocked',
    blocker:
      'No photo-verification source is connected, so photos cannot be checked. It stays blocked until such a source exists.',
  },
  {
    name: 'Video Summaries',
    status: 'Blocked',
    blocker:
      'No video data is recorded for any product, so there is nothing to summarize. It stays blocked until video data exists.',
  },
  {
    name: 'Family Shopper',
    status: 'Blocked',
    blocker:
      'There is no shared-household or family-accounts model yet, so shared lists and budgets have nothing to run on. It stays blocked until that model exists.',
  },
  {
    name: 'Voice shopping',
    status: 'Blocked',
    blocker:
      'No voice input or voice skill is built, so shopping by voice has nothing to run on. It stays blocked until voice support exists.',
  },
  {
    name: 'Agentic checkout',
    status: 'Blocked',
    blocker:
      'Checkout cannot be automated yet: it needs merchant checkout agreements and a payment flow that does not exist today. It stays blocked until those exist.',
  },
];

function StatusBadge({ status }: { status: RoadmapStatus }) {
  return (
    <span
      className={
        status === 'Blocked'
          ? 'inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800'
          : 'inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800'
      }
    >
      {status}
    </span>
  );
}

export default function ComingSoonPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Coming soon"
        description="What SmartBuy AI has planned next, and what is blocking each item. No launch dates are promised."
        path="/coming-soon"
        crumbs={[ { name: "Home", path: "/" }, { name: "Coming soon" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Clock className="h-7 w-7 text-blue-600" /> Coming soon
          </h1>
          <p className="mt-2 text-muted-foreground">
            What is planned next for SmartBuy AI — and, for each item,
            what is actually standing in its way. No launch dates are
            promised for anything on this page, and nothing here is
            described as &ldquo;in development&rdquo; until it really
            is.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            The tools that already work are not listed here — they are
            live on the{' '}
            <Link href="/tools" className="underline">
              AI tools page
            </Link>
            . What has already shipped is on the{' '}
            <Link href="/changelog" className="underline">
              changelog
            </Link>
            .
          </p>

          <div className="mt-8 space-y-4">
            {ROADMAP_ITEMS.map((item) => (
              <article key={item.name} className="rounded-lg border p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">{item.name}</h2>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  <strong className="text-foreground">What is blocking it: </strong>
                  {item.blocker}
                </p>
                {item.href && item.linkLabel ? (
                  <Link
                    href={item.href}
                    className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    {item.linkLabel}
                  </Link>
                ) : null}
              </article>
            ))}
          </div>

          <p className="mt-8 text-sm text-muted-foreground">
            There is no per-feature signup on this page: collecting
            interest per feature would need a new database table, and
            that is not available yet. The only waitlist that exists
            today is the native-app one on the{' '}
            <Link href="/mobile-app" className="underline">
              mobile-app page
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
