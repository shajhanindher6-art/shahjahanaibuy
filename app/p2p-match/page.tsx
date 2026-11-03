import { TravelerMatcher } from '@/components/p2p/traveler-matcher';

/**
 * Traveler luggage matcher — SIMULATION ONLY (Option 10, Feature 3).
 * No real travelers are matched and no transport is arranged on this
 * page; it is an educational simulation and cost-comparison tool.
 */
export default function TravelerMatchPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
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
