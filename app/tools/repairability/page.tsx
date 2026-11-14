/**
 * AI Repairability Explorer — /tools/repairability (T7).
 *
 * Explore the repairability index across the catalog: the score,
 * spare-parts years, what the score means, and how the index is
 * computed. Engine: services/repairability.ts — the index is pure
 * math over values recorded per product (migration 019 data):
 *
 *   index = min(100, round(repairability_score * 8 + spare_parts_years * 2))
 *
 * HONEST EMPTY STATE (the whole point of this tool today):
 * migration 019 is NOT applied and no repairability data is recorded
 * for any product, so this page is an explainer + an honest empty
 * state — every product reads "Not recorded yet". A product with no
 * recorded data gets NO index, never a score from nothing.
 *
 * The page becomes useful automatically as data lands: each row
 * calls getProductRepairability / computeRepairabilityIndex, and a
 * product with recorded values renders its index, verdict, and
 * spare-parts availability with no code change. No new migration
 * is needed for this tool — recording the data is the owner's step
 * (migration 019 apply + repairability values per product).
 *
 * Server component, no JavaScript needed. Deterministic, zero LLM,
 * no scraping, no invented scores.
 */

import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Wrench } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { RelatedTools } from '@/components/tools/related-tools';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCachedProducts } from '@/services/tool-integration';
import {
  computeRepairabilityIndex,
  getProductRepairability,
  REPAIRABILITY_EXCELLENT_FROM,
  REPAIRABILITY_NOT_RECOMMENDED_BELOW,
  type RepairabilityIndex,
} from '@/services/repairability';
import { PageJsonLd } from '@/components/seo/page-json-ld';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Repairability Explorer — SmartBuy AI',
  description:
    'How repairable is each product? The repairability index, spare-parts years, and what the score means — recorded data only, never guessed.',
  alternates: {
    canonical: `${appConfig.url}/tools/repairability`,
  },
  openGraph: {
    title: 'AI Repairability Explorer — SmartBuy AI',
    description:
      'How repairable is each product? The repairability index, spare-parts years, and what the score means — recorded data only, never guessed.',
    url: `${appConfig.url}/tools/repairability`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'AI Repairability Explorer — SmartBuy AI',
    description:
      'How repairable is each product? The repairability index, spare-parts years, and what the score means — recorded data only, never guessed.',
  },
};

interface RepairabilityRow {
  productId: string;
  name: string;
  slug: string;
  brand: string | null;
  result: RepairabilityIndex;
}

const VERDICT_LABELS: Record<RepairabilityIndex['verdict'], string> = {
  unknown: 'Not recorded yet',
  'not-recommended': 'Not recommended for long-term use',
  good: 'Good',
  excellent: 'Excellent',
};

export default async function RepairabilityExplorerPage() {
  const supabase = await createSupabaseServerClient();
  const { products } = await getCachedProducts(supabase, { page: 1, pageSize: 100 });

  // getProductRepairability never throws: when migration 019 has
  // not been applied (today) it returns all nulls, so every row
  // below renders the honest "Not recorded yet" state.
  const rows: RepairabilityRow[] = await Promise.all(
    products.map(async (product) => {
      const data = await getProductRepairability(supabase, product.id);
      return {
        productId: product.id,
        name: product.name,
        slug: product.slug,
        brand: product.brand,
        result: computeRepairabilityIndex(data),
      };
    })
  );

  const recorded = rows.filter((row) => row.result.index !== null);
  const sorted = [...rows].sort((a, b) => {
    if (a.result.index === null && b.result.index === null) {
      return a.name.localeCompare(b.name);
    }
    if (a.result.index === null) return 1;
    if (b.result.index === null) return -1;
    return b.result.index - a.result.index;
  });

  return (
    <React.Fragment>
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <PageJsonLd
          name="AI Repairability Explorer"
          description="How repairable is each product? The repairability index, spare-parts years, and what the score means — recorded data only, never guessed."
          path="/tools/repairability"
          crumbs={[
            { name: 'Home', path: '/' },
            { name: 'AI tools', path: '/tools' },
            { name: 'AI Repairability Explorer' },
          ]}
        />
        <main className="container mx-auto flex-1 px-4 py-12">
          <div className="mx-auto max-w-3xl">
            <h1 className="flex items-center gap-2 text-3xl font-bold">
              <Wrench className="h-7 w-7 text-blue-600" /> AI Repairability
              Explorer
            </h1>
            <p className="mt-2 text-muted-foreground">
              How repairable is each product — and how long will spare
              parts be available for it? The index below is pure math
              over values recorded per product. A product with no
              recorded data gets no index: it reads &ldquo;Not recorded
              yet&rdquo;, never a guessed score.
            </p>

            {recorded.length === 0 && (
              <div className="mt-6">
                <EmptyState
                  eyebrow="No repairability data yet"
                  title="No repairability scores recorded yet"
                  description="No product in the catalog has repairability values recorded — the data migration (019) has not been applied yet. The formula and what the score means are documented below, and scores will appear here automatically once values are recorded."
                />
              </div>
            )}

            {recorded.length > 0 && (
              <p className="mt-6 text-sm text-muted-foreground" aria-live="polite">
                {recorded.length} of {rows.length} products have a recorded
                repairability index. The rest have no data recorded yet.
              </p>
            )}

            <section className="mt-8 rounded-lg border p-6" aria-label="How the index is computed">
              <h2 className="text-xl font-semibold">
                How the index is computed
              </h2>
              <p className="mt-3 font-mono text-sm">
                index = min(100, round(score × 8 + spare-parts years × 2))
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                <li>
                  <strong className="text-foreground">Score (0–10):</strong>{' '}
                  the product&apos;s recorded repairability score. Without
                  a recorded score there is no index at all.
                </li>
                <li>
                  <strong className="text-foreground">
                    Spare-parts years:
                  </strong>{' '}
                  how many years spare parts are available. Each year adds
                  2 points. When unrecorded it contributes 0 and the result
                  is flagged as partial.
                </li>
                <li>
                  <strong className="text-foreground">Verdict:</strong>{' '}
                  {REPAIRABILITY_EXCELLENT_FROM} and above is Excellent; below{' '}
                  {REPAIRABILITY_NOT_RECOMMENDED_BELOW} — or a High local
                  repair risk — is Not recommended for long-term use;
                  everything in between is Good.
                </li>
                <li>
                  <strong className="text-foreground">
                    Spare-parts availability:
                  </strong>{' '}
                  derived from the years, never stored as a separate claim —
                  7+ years High, 4–6 years Medium, under 4 years Low.
                </li>
              </ul>
              <p className="mt-3 text-sm text-muted-foreground">
                Example: a score of 7.0 with 10 years of parts scores 7 × 8
                + 10 × 2 = 76 — Excellent.
              </p>
            </section>

            <section className="mt-10" aria-label="Repairability across the catalog">
              <h2 className="text-xl font-semibold">
                Repairability across the catalog
              </h2>
              {sorted.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  The catalog is empty right now, so there is nothing to
                  show.
                </p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {sorted.map((row) => (
                    <li key={row.productId} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-semibold">
                          <Link
                            href={`/products/${row.slug}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {row.name}
                          </Link>
                        </h3>
                        {row.result.index !== null ? (
                          <span className="text-lg font-bold">
                            {row.result.index}
                            <span className="text-sm font-normal text-muted-foreground">
                              {' '}
                              / 100
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm font-semibold text-muted-foreground">
                            Not recorded yet
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {row.brand ?? 'Unknown brand'}
                        {' · '}Verdict:{' '}
                        {VERDICT_LABELS[row.result.verdict]}
                        {' · '}Spare-parts availability:{' '}
                        {row.result.availabilityLabel}
                      </p>
                      {row.result.index === null ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                          No repairability score, spare-parts years, or repair
                          risk recorded for this product yet.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {!row.result.hasPartsYears && (
                            <li>
                              Spare-parts years not recorded — the index
                              counts 0 for parts and is partial.
                            </li>
                          )}
                          {!row.result.hasRisk && (
                            <li>
                              Local repair risk not recorded — the verdict
                              is from the index alone.
                            </li>
                          )}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="mt-10 text-xs text-muted-foreground">
              Repairability values are recorded per product by the catalog
              owner. Until they are recorded, this page shows the formula
              and the honest empty state above — no score is ever shown
              for a product without data. See{' '}
              <Link href="/tools" className="underline underline-offset-4">
                all AI tools
              </Link>
              .
            </p>
            <RelatedTools tool="repairability" productSlug={null} />
          </div>
        </main>
        <SiteFooter />
      </div>
    </React.Fragment>
  );
}
