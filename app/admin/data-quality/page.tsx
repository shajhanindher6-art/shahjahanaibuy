/**
 * Admin data-quality dashboard (Final 100%, F-P1-52) —
 * /admin/data-quality.
 *
 * The standalone page the audit found missing (only the JSON API
 * route + the panel inside /admin/ai existed). Server component:
 * totals, verified/unverified/stale, missing data, fresh/verified
 * price coverage, merchant source coverage, spec/image/GTIN
 * coverage, quality distribution, ingestion failures, last
 * successful sync, source reliability, merchant reliability
 * (canonical policy scorer), the dead-man's switch, and a
 * product-level drill-down with the same quality filters as
 * /admin/products.
 *
 * Every percentage on this page is calculated from the actual DB
 * records the services read — never hardcoded, never invented.
 * A metric that cannot be computed (unapplied migration) renders
 * as "cannot be computed" with the migration named, never as a
 * zero. Guard: /admin/layout.tsx redirects non-admins
 * server-side, plus the per-page `requireAdminPage()` re-check
 * (F-P1-62). All copy is literal English — no i18n keys are added
 * for admin surfaces.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireAdminPage } from '@/lib/admin-page-guard';
import { getAdminDataQualitySummary } from '@/services/admin-data-quality';
import {
  getProductQualityContexts,
  listAdminProducts,
} from '@/services/admin-products';
import {
  DATA_QUALITY_SCORE_LABEL,
  computeProductQualityScore,
  getDataQualityState,
  isValidGtin,
} from '@/services/product-quality-score';
import { getRefreshMonitorState } from '@/services/refresh-monitor';
import { getProviderHealthPanel } from '@/services/provider-status';
import { getProductAttribution } from '@/services/product-attribution';
import { getMerchantCurrencies } from '@/services/merchant-currency';
import { listIngestionRejections } from '@/services/ingestion-rejections';
import { listRecentErrors } from '@/services/error-log-admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Data quality — Admin — SmartBuy AI',
  description:
    'Catalog data quality: verification, freshness, coverage, reliability, and refresh monitoring. Admin only.',
  robots: {
    index: false,
    follow: false,
  },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Percentage of `part` out of `total`, or null when there is nothing to measure. */
function pct(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 100);
}

function pctLabel(part: number, total: number): string {
  const value = pct(part, total);
  return value === null ? '—' : `${value}%`;
}

export default async function AdminDataQualityPage({
  searchParams,
}: {
  searchParams: {
    quality?: string;
    missing?: string;
    stale?: string;
    noImage?: string;
    noGtin?: string;
  };
}) {
  await requireAdminPage();
  const service = createSupabaseServiceClient();

  if (!service) {
    return (
      <main className="container mx-auto max-w-6xl px-4 py-12">
        <h1 className="text-3xl font-bold">Data quality</h1>
        <p className="mt-4 text-muted-foreground">
          The service-role key is not configured, so data quality cannot be
          read. Set SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard.
        </p>
      </main>
    );
  }

  const [summary, monitor, healthPanel, rejections, recentErrors] = await Promise.all([
    getAdminDataQualitySummary(service),
    getRefreshMonitorState(service),
    getProviderHealthPanel(service),
    listIngestionRejections(service, 5),
    listRecentErrors(service, 5),
  ]);

  // Product-level drill-down, with the same quality filters as
  // /admin/products (F-P2-44). The list call caps at 100 rows;
  // the catalog is 10 rows today.
  const list = await listAdminProducts(service, {
    quality: searchParams.quality,
    missing: searchParams.missing,
    stale: searchParams.stale === '1',
    noImage: searchParams.noImage === '1',
    noGtin: searchParams.noGtin === '1',
    page: 1,
    pageSize: 100,
  });
  const { contexts, merchantSourceMissing } = await getProductQualityContexts(
    service,
    list.products.map((p) => p.id)
  );
  const { byProduct: currenciesByProduct, distinctCodes } = await getMerchantCurrencies(
    service,
    list.products.map((p) => p.id)
  );
  const attributions = new Map<string, Awaited<ReturnType<typeof getProductAttribution>>>();
  for (const product of list.products) {
    attributions.set(product.id, await getProductAttribution(service, product.id));
  }

  const total = summary.productsTotal;
  const withMerchant = list.products.filter(
    (p) => (contexts.get(p.id)?.merchantCount ?? 0) > 0
  ).length;
  const withPriceSource = list.products.filter(
    (p) => (contexts.get(p.id)?.priceSource ?? null) !== null
  ).length;
  const withRecordedCurrency = list.products.filter((p) =>
    (currenciesByProduct.get(p.id) ?? []).some((c) => c.code !== null)
  ).length;
  const historyEntries = Object.entries(summary.historyCoverage);
  const reliabilityEntries = Object.entries(summary.sourceReliability);
  const lastSuccessfulEntries = Object.entries(summary.lastSuccessfulUpdate).filter(
    ([, v]) => v.at !== null
  );

  return (
    <main className="container mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold">Data quality</h1>
      <p className="mt-2 text-muted-foreground">
        What the catalog actually contains — verification, freshness, coverage,
        reliability, and refresh monitoring, all computed from stored rows.
        Every percentage below is calculated from the records read for this
        page; a metric that cannot be computed says so instead of showing a zero.
      </p>
      <p className="mt-2 text-sm">
        <Link href="/admin/ai" className="underline">
          AI control center
        </Link>
        {' · '}
        <Link href="/admin/products" className="underline">
          All products
        </Link>
        {' · '}
        <Link href="/admin/ingestion-failures" className="underline">
          Ingestion failures
        </Link>
        {' · '}
        <Link href="/admin/refresh-runs" className="underline">
          Refresh runs
        </Link>
      </p>

      {list.error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          Products could not be read: {list.error}
        </p>
      ) : null}

      {/* Dead-man's switch (F-P1-53): the refresh pipeline's health,
          surfaced loudly. 'ok' is a quiet line; anything else is an
          alert with the reason and the owner action that clears it. */}
      <section aria-label="Refresh monitoring" className="mt-6">
        <h2 className="text-xl font-semibold">Refresh monitoring</h2>
        {monitor.status === 'ok' ? (
          <p className="mt-4 rounded-lg border p-4 text-sm text-muted-foreground">
            Refresh pipeline healthy — {monitor.reason}
          </p>
        ) : (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950"
          >
            <p className="font-medium">
              Refresh pipeline needs attention — {monitor.status === 'cron-secret-unset'
                ? 'cron secret not set'
                : monitor.status === 'no-runs-recorded'
                  ? 'no refresh run recorded'
                  : monitor.status === 'overdue'
                    ? 'refresh overdue'
                    : 'refresh failing'}
            </p>
            <p className="mt-2 text-sm">{monitor.reason}</p>
            {monitor.ownerAction ? (
              <p className="mt-2 text-sm">
                <span className="font-medium">Owner action: </span>
                {monitor.ownerAction}
              </p>
            ) : null}
            <p className="mt-2 text-sm text-muted-foreground">
              No email is sent for this — delivery is owner-gated (Resend is not configured).
              This alert is the in-product dead-man&rsquo;s switch; check it whenever prices
              look stale. Last finished run:{' '}
              {monitor.lastRun?.finishedAt ? formatDateTime(monitor.lastRun.finishedAt) : 'none recorded'}
              {monitor.consecutiveFailures > 0 ? ` · ${monitor.consecutiveFailures} consecutive failed run(s)` : ''}.
            </p>
          </div>
        )}
      </section>

      <section aria-label="Totals" className="mt-10">
        <h2 className="text-xl font-semibold">Totals</h2>
        <div className="mt-4 rounded-lg border p-6">
          <p className="text-sm text-muted-foreground">Average data quality score</p>
          {summary.averageDataQualityScore !== null ? (
            <p className="mt-1 text-4xl font-bold">{summary.averageDataQualityScore} / 100</p>
          ) : (
            <p className="mt-1 text-2xl font-bold">No products to score yet</p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            Across {total} product(s). A data quality score — how complete, verifiable, and
            fresh each product&rsquo;s record is — never a judgement of the product itself.
          </p>
          {summary.scoreMayUnderstate ? (
            <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
              This average may understate data quality: a verification or price-source column
              does not exist yet (migration 045 not applied), so the attribution dimension
              cannot count a recorded price source.
            </p>
          ) : null}
          {merchantSourceMissing ? (
            <p className="mt-2 text-sm text-muted-foreground">
              The merchant price-source column does not exist yet (migration 045 not applied),
              so per-product scores may understate data quality.
            </p>
          ) : null}
        </div>
      </section>

      <section aria-label="Verification" className="mt-10">
        <h2 className="text-xl font-semibold">Verification</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="font-medium">Verification distribution (of {total})</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>Verified: {summary.verification.verified} ({pctLabel(summary.verification.verified, total)})</li>
              <li>Unverified: {summary.verification.unverified} ({pctLabel(summary.verification.unverified, total)})</li>
              <li>Stale (verified, then aged past 7 days): {summary.verification.stale} ({pctLabel(summary.verification.stale, total)})</li>
              {summary.verification.unknown > 0 ? (
                <li>Unknown (verification columns not applied yet): {summary.verification.unknown} ({pctLabel(summary.verification.unknown, total)})</li>
              ) : null}
            </ul>
            {summary.columnsMissing ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Verification columns do not exist yet (migration 045 not applied): every product
                reads as unverified here, and the &ldquo;verified&rdquo; share is not a measurement
                until a real fetch writes a verified stamp.
              </p>
            ) : null}
          </div>
          <div className="rounded-lg border p-4">
            <p className="font-medium">Data verification (5-state taxonomy, of {total})</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The same label system the public product page shows per product.
            </p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>Verified: {summary.qualityStates.verified} ({pctLabel(summary.qualityStates.verified, total)})</li>
              <li>Partially verified: {summary.qualityStates.partial} ({pctLabel(summary.qualityStates.partial, total)})</li>
              <li>Unverified: {summary.qualityStates.unverified} ({pctLabel(summary.qualityStates.unverified, total)})</li>
              <li>Stale: {summary.qualityStates.stale} ({pctLabel(summary.qualityStates.stale, total)})</li>
              <li>Missing information: {summary.qualityStates.missing} ({pctLabel(summary.qualityStates.missing, total)})</li>
            </ul>
          </div>
          {/* Final 100% (F-P1-29) — the brief's 5-state price
              machine, counted from the same per-product derivation
              as the public product page (lib/verification/
              price-state.ts). Only LIVE_VERIFIED may be shown with
              live/current wording; a historical price is never a
              current live price. */}
          <div className="rounded-lg border p-4">
            <p className="font-medium">Price states — the brief&apos;s 5-state machine (of {total})</p>
            <p className="mt-1 text-sm text-muted-foreground">
              One derived state per product, same function as the product page and API.
            </p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>Live verified: {summary.priceStates.LIVE_VERIFIED} ({pctLabel(summary.priceStates.LIVE_VERIFIED, total)})</li>
              <li>Historically verified: {summary.priceStates.HISTORICAL_VERIFIED} ({pctLabel(summary.priceStates.HISTORICAL_VERIFIED, total)})</li>
              <li>Unverified: {summary.priceStates.UNVERIFIED} ({pctLabel(summary.priceStates.UNVERIFIED, total)})</li>
              <li>Stale: {summary.priceStates.STALE} ({pctLabel(summary.priceStates.STALE, total)})</li>
              <li>Source unavailable: {summary.priceStates.SOURCE_UNAVAILABLE} ({pctLabel(summary.priceStates.SOURCE_UNAVAILABLE, total)})</li>
            </ul>
          </div>
        </div>
      </section>

      <section aria-label="Freshness and coverage" className="mt-10">
        <h2 className="text-xl font-semibold">Freshness and coverage</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="font-medium">Price freshness (of {total})</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>Fresh (checked within 7 days): {summary.freshness.fresh} ({pctLabel(summary.freshness.fresh, total)})</li>
              <li>Stale: {summary.freshness.stale} ({pctLabel(summary.freshness.stale, total)})</li>
              <li>Age unknown: {summary.freshness.unknown} ({pctLabel(summary.freshness.unknown, total)})</li>
            </ul>
            <p className="mt-2 text-sm text-muted-foreground">
              Fresh-price coverage: {pctLabel(summary.freshness.fresh, total)}. Verified-price
              coverage is not calculable as a measurement until migration 045 applies AND a real
              fetch writes a verified stamp — the 0% today is the fail-open default, not a
              verified measurement.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="font-medium">Coverage (of {total})</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>With an image: {summary.productsWithImages} ({pctLabel(summary.productsWithImages, total)})</li>
              <li>With a GTIN: {summary.productsWithGtin} ({pctLabel(summary.productsWithGtin, total)})</li>
              <li>With specs: {summary.productsWithSpecs} ({pctLabel(summary.productsWithSpecs, total)})</li>
              <li>With reviews: {summary.productsWithReviews} ({pctLabel(summary.productsWithReviews, total)})</li>
              <li>
                With price history: {summary.productsWithHistory} ({pctLabel(summary.productsWithHistory, total)})
                {' '}({summary.priceHistoryPoints} point(s) total)
              </li>
              <li>With a merchant listing: {withMerchant} ({pctLabel(withMerchant, total)})</li>
              <li>With a recorded price source: {withPriceSource} ({pctLabel(withPriceSource, total)})</li>
            </ul>
          </div>
        </div>
      </section>

      <section aria-label="Merchant source coverage and currency" className="mt-10">
        <h2 className="text-xl font-semibold">Merchant sources and currency</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="font-medium">Merchant source coverage</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {withMerchant} of {total} product(s) have at least one merchant listing;{' '}
              {withPriceSource} of {total} have a recorded price source for the cheapest listing.
              {summary.merchantSourceMissing
                ? ' The price-source column does not exist yet (migration 045 not applied), so which merchant supplied a price is unanswerable until it applies.'
                : ''}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="font-medium">Recorded currency</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {withRecordedCurrency} of {total} product(s) have a stored currency code on a
              merchant row. Stored codes in use:{' '}
              {distinctCodes.length > 0 ? distinctCodes.join(', ') : 'none recorded'}.
              A row with no recorded currency is shown as &ldquo;currency not recorded&rdquo; in the
              drill-down below — USD is assumed in refresh run counts only, never presented
              as a stored currency, and prices are never FX-converted.
            </p>
          </div>
        </div>
      </section>

      {/* F-P1-51 — the three metrics the service computed but no UI
          rendered: history coverage, per-source reliability, last
          successful update. */}
      <section aria-label="History coverage and reliability" className="mt-10">
        <h2 className="text-xl font-semibold">History coverage and reliability</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="font-medium">Price-history coverage</p>
            {summary.historyProvenanceMissing ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Cannot be computed — price-history provenance columns do not exist yet
                (migration 057 not applied), so per-product coverage is unknown, not zero.
              </p>
            ) : historyEntries.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                No price-history coverage recorded — no product has a provenance-carrying
                history point yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {historyEntries.map(([id, c]) => {
                  const name = list.products.find((p) => p.id === id)?.name ?? id;
                  return (
                    <li key={id}>
                      {name}: {c.points} point(s) over {c.spanDays} day(s)
                      {c.lastRecordedAt ? ` — latest ${formatDateTime(c.lastRecordedAt)}` : ''}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="rounded-lg border p-4">
            <p className="font-medium">Per-source reliability</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Share of non-suspicious price-history points per source — a recorded-history
              ratio, not a trust score. A source with one clean point scores 100% clean,
              which means &ldquo;nothing flagged yet&rdquo;, not &ldquo;proven reliable&rdquo;.
            </p>
            {summary.historyProvenanceMissing ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Cannot be computed — price-history provenance columns do not exist yet
                (migration 057 not applied).
              </p>
            ) : reliabilityEntries.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                No per-source reliability yet — no price-history point carries a source.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {reliabilityEntries.map(([source, r]) => (
                  <li key={source}>
                    {source}: {r.reliability !== null ? `${Math.round(r.reliability * 100)}% clean` : 'no points'} (
                    {r.points} point(s), {r.suspicious} flagged)
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="mt-4 rounded-lg border p-4">
          <p className="font-medium">Last successful update</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The last time a real provider response was validated AND saved — distinct from
            &ldquo;last checked&rdquo;. {summary.productsWithSuccessfulUpdate} of {total} product(s)
            have one recorded.
            {summary.lastSuccessfulUpdateColumnMissing
              ? ' The stored column does not exist yet (migration 066 not applied), so values are derived from live-source history and merchant syncs, not stored.'
              : ''}
          </p>
          {lastSuccessfulEntries.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              No product has a recorded successful update yet — no provider-validated save has
              happened. That is the honest state for the seeded catalog, not a gap in this page.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {lastSuccessfulEntries.map(([id, v]) => {
                const name = list.products.find((p) => p.id === id)?.name ?? id;
                return (
                  <li key={id}>
                    {name}: {v.at ? formatDateTime(v.at) : '—'}
                    {v.source ? ` (from ${v.source})` : ''}
                    {v.columnMissing ? ' — derived, not stored' : ''}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* F-P1-50 — the canonical merchant-reliability scorer
          (policy scorer) wired into this dashboard. The sync scorer
          in deal ranking scores refresh-run health and fresh-listing
          share — a different dimension, not a duplicate — and the
          history-based per-source ratio above is a third, separate
          measure. No third scorer was added. */}
      <section aria-label="Merchant reliability" className="mt-10">
        <h2 className="text-xl font-semibold">Merchant reliability</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Canonical scorer: recorded policy, trust grade, verified badge and directory signals
          only (services/merchant-reliability.ts — the same scorer the comparison and the
          provider-health panel use). A merchant with too little evidence gets no score, never
          a guess.
        </p>
        {healthPanel.serviceUnavailable ? (
          <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            The service-role key is not configured, so merchant reliability cannot be read.
          </p>
        ) : healthPanel.merchantReliability.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No merchants to score yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {healthPanel.merchantReliability.map((m) => (
              <li key={m.merchantId} className="rounded-lg border p-4 text-sm">
                <p className="font-medium">
                  {m.merchantName}
                  {m.score !== null ? <> — {m.score}/100 ({m.level})</> : <> — not enough data to score</>}
                  {m.trustGrade ? <> · trust grade {m.trustGrade}</> : null}
                  {m.verified === true ? <> · Verified Merchant badge</> : null}
                </p>
                <p className="mt-1 text-muted-foreground">{m.explanation}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Ingestion failures" className="mt-10">
        <h2 className="text-xl font-semibold">Ingestion failures</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Latest recorded failures. An empty section means nothing was stored there, not that
          nothing ever failed.{' '}
          <Link href="/admin/ingestion-failures" className="underline">
            Full failure view
          </Link>
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <p className="font-medium">Rejected ingestion rows (latest 5)</p>
            {rejections.error ? (
              <p className="mt-1 text-sm text-red-600">Could not be read: {rejections.error}</p>
            ) : rejections.tableMissing ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Not stored yet — migration 048 not applied. Pipeline and CSV rejections are
                written to the error_log table, so they are unavailable for the same reason.
                This is not a claim that no row was ever rejected.
              </p>
            ) : rejections.rejections.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">No rejected rows recorded.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {rejections.rejections.map((r) => (
                  <li key={r.id}>
                    {r.productName ?? 'Unnamed row'}
                    {r.rowNumber !== null ? ` · CSV row ${r.rowNumber}` : ''}
                    {r.source ? ` · ${r.source}` : ''} · {formatDateTime(r.created_at)}
                    <br />
                    {r.reason ?? r.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border p-4">
            <p className="font-medium">Recent errors (latest 5)</p>
            {recentErrors.error ? (
              <p className="mt-1 text-sm text-red-600">Could not be read: {recentErrors.error}</p>
            ) : recentErrors.tableMissing ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Error logging is not yet active — migration 048 not applied.
              </p>
            ) : recentErrors.errors.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">No errors recorded.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {recentErrors.errors.map((row) => (
                  <li key={row.id}>
                    {row.level} · {row.route ?? 'unknown route'} · {formatDateTime(row.created_at)}
                    <br />
                    {row.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Product-level drill-down (F-P1-52 + F-P1-05 + F-P1-58):
          one row per product with its score, state, missing fields,
          recorded source attribution, stored currency, and last
          successful update. Filtered by the same quality filters as
          /admin/products. */}
      <section aria-label="Product drill-down" className="mt-10">
        <h2 className="text-xl font-semibold">Product drill-down</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {list.total} product(s) match the filters below. Attribution is the product&rsquo;s
          recorded source (cheapest listing&rsquo;s price source, pipeline provider rows, spec
          attribution); &ldquo;No source recorded&rdquo; means exactly that. Currency is the stored
          code on the merchant row; &ldquo;not recorded&rdquo; means the row carries no currency.
        </p>
        <form method="get" className="mt-4 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="dq-quality">Filter by data quality state</label>
          <select
            id="dq-quality"
            name="quality"
            defaultValue={searchParams.quality ?? ''}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">All quality states</option>
            <option value="verified">Verified</option>
            <option value="partial">Partially verified</option>
            <option value="unverified">Unverified</option>
            <option value="stale">Stale</option>
            <option value="missing">Missing information</option>
          </select>
          <label className="sr-only" htmlFor="dq-missing">Filter by missing field</label>
          <select
            id="dq-missing"
            name="missing"
            defaultValue={searchParams.missing ?? ''}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">Any missing field</option>
            <option value="specs">No specs</option>
            <option value="image">No image</option>
            <option value="gtin">No GTIN</option>
            <option value="history">No price history</option>
          </select>
          <label className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm">
            <input type="checkbox" name="stale" value="1" defaultChecked={searchParams.stale === '1'} />
            Stale only
          </label>
          <label className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm">
            <input type="checkbox" name="noImage" value="1" defaultChecked={searchParams.noImage === '1'} />
            No image
          </label>
          <label className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm">
            <input type="checkbox" name="noGtin" value="1" defaultChecked={searchParams.noGtin === '1'} />
            No GTIN
          </label>
          <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">
            Filter
          </button>
        </form>
        <p className="mt-2 text-sm">
          <Link
            href={`/admin/products?${[
              searchParams.quality ? `quality=${searchParams.quality}` : '',
              searchParams.missing ? `missing=${searchParams.missing}` : '',
              searchParams.stale === '1' ? 'stale=1' : '',
              searchParams.noImage === '1' ? 'noImage=1' : '',
              searchParams.noGtin === '1' ? 'noGtin=1' : '',
            ]
              .filter(Boolean)
              .join('&')}`}
            className="underline"
          >
            Open the same filtered list on /admin/products
          </Link>
        </p>
        {list.products.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
            No products match these filters. Try clearing the filters.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {list.products.map((product) => {
              const productCtx = contexts.get(product.id) ?? {};
              const score = computeProductQualityScore(
                {
                  name: product.name,
                  slug: product.slug,
                  brand: product.brand,
                  category: product.category,
                  description: product.description,
                  imageUrl: product.imageUrl,
                  gtin: product.gtin,
                  priceVerificationStatus: product.priceVerificationStatus,
                  priceVerifiedAt: product.priceVerifiedAt,
                  dataFreshness: product.dataFreshness,
                  updatedAt: product.updatedAt,
                },
                productCtx
              );
              const qualityState = getDataQualityState({
                priceVerificationStatus: product.priceVerificationStatus,
                priceAgeDays: score.priceAgeDays,
                merchantCount: productCtx.merchantCount ?? 0,
                hasValidGtin: isValidGtin(product.gtin),
                hasPriceSource: (productCtx.priceSource ?? null) !== null,
              });
              const attribution = attributions.get(product.id);
              const merchantCurrencies = currenciesByProduct.get(product.id) ?? [];
              const storedCode = merchantCurrencies.find((c) => c.code !== null)?.code ?? null;
              const lastSuccessful = summary.lastSuccessfulUpdate[product.id] ?? null;
              const cheapestSource = productCtx.priceSource ?? null;
              return (
                <section key={product.id} className="rounded-lg border p-4">
                  <p className="font-medium">
                    <Link href={`/admin/products/${product.id}`} className="underline">
                      {product.name}
                    </Link>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {product.brand ?? 'No brand'} · {product.category ?? 'No category'} · {product.slug}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {DATA_QUALITY_SCORE_LABEL}: <strong>{score.score} / 100</strong> ({score.grade})
                    {' · '}Data verification: <strong>{qualityState.label}</strong>
                    {score.missingFields.length > 0
                      ? ` — missing: ${score.missingFields.join(', ')}`
                      : ' — nothing missing'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Source: {cheapestSource ?? 'No source recorded'}
                    {attribution && attribution.productSources.length > 0
                      ? ` · pipeline: ${attribution.productSources.map((s) => s.providerKey).join(', ')}`
                      : ''}
                    {attribution && attribution.specsTotal > 0
                      ? ` · specs attributed: ${attribution.specsAttributed}/${attribution.specsTotal}`
                      : ''}
                    {attribution && !attribution.hasAnyAttribution
                      ? ' — no source recorded for this product'
                      : ''}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Currency: {storedCode ?? 'not recorded'}
                    {storedCode === null && merchantCurrencies.length > 0
                      ? ' — USD assumed in refresh run counts only, not stored'
                      : ''}
                    {' · '}Last successful update:{' '}
                    {lastSuccessful?.at ? formatDateTime(lastSuccessful.at) : 'none recorded'}
                    {lastSuccessful?.at && lastSuccessful.columnMissing ? ' (derived, not stored)' : ''}
                  </p>
                </section>
              );
            })}
          </div>
        )}
      </section>

      {summary.notes.length > 0 ? (
        <section aria-label="Notes" className="mt-10">
          <h2 className="text-xl font-semibold">Notes</h2>
          <div className="mt-4 rounded-lg border border-dashed p-4">
            <ul className="space-y-1 text-sm text-muted-foreground">
              {summary.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </main>
  );
}
