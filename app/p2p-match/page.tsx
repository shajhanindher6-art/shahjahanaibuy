import type { Metadata } from 'next';
import { appConfig } from '@/lib/config/app';
import { TravelerMatcher } from '@/components/p2p/traveler-matcher';
import { PageJsonLd } from '@/components/seo/page-json-ld';

/**
 * Traveler luggage matcher — SIMULATION ONLY (Option 10, Feature 3).
 * No real travelers are matched and no transport is arranged on this
 * page; it is an educational simulation and cost-comparison tool.
 */
// Section 13, Chunk E: self-canonical + Open Graph metadata (the
// root layout's canonical points at the homepage, so without this
// the page self-canonicalizes to /).
export const metadata: Metadata = {
  title: 'Traveler luggage matcher — SmartBuy AI',
  description:
    'Simulate how traveler-assisted delivery could compare with standard international shipping — no real travelers, no real transport, no real people contacted.',
  alternates: {
    canonical: `${appConfig.url}/p2p-match`,
  },
  openGraph: {
    title: 'Traveler luggage matcher — SmartBuy AI',
    description:
      'Simulate how traveler-assisted delivery could compare with standard international shipping — no real travelers, no real transport, no real people contacted.',
    url: `${appConfig.url}/p2p-match`,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Traveler luggage matcher — SmartBuy AI',
    description:
      'Simulate how traveler-assisted delivery could compare with standard international shipping — no real travelers, no real transport, no real people contacted.',
  },
};

export default function TravelerMatchPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Traveler luggage matcher"
        description="Simulate how traveler-assisted delivery could compare with standard international shipping — no real travelers, no real transport, no real people contacted."
        path="/p2p-match"
        crumbs={[ { name: "Home", path: "/" }, { name: "Traveler luggage matcher" } ]}
      />
      <h1 className="text-2xl font-bold">Traveler luggage matcher</h1>
      <p className="mt-2 text-muted-foreground">
        Simulate how traveler-assisted delivery could compare with standard international
        shipping — no real travelers, no real transport, no real people contacted.
      </p>
      <div className="mt-6">
        <TravelerMatcher />
      </div>
    </main>
  );
}
