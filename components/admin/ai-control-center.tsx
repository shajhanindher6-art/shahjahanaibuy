/**
 * AI admin control center — client view (Section 19, Phase 7, §12 #71 + #73).
 *
 * READ-ONLY v1: this component only fetches GET /api/v1/admin/ai and
 * renders it. No buttons, no forms, no provider-config write surface
 * — there is nothing here that writes anything. The page itself is
 * guarded server-side by /admin/layout.tsx (requireAdmin via
 * lib/admin-role.ts); the API route enforces the same guard.
 *
 * Honesty states, all rendered explicitly:
 * - providers: live providers are 'available-unverified' — a present
 *   key is not proof the provider answers (probing would spend quota).
 * - usage: in-memory per-instance counters (reset on deploy, not
 *   shared across instances) — the payload's `note` says so.
 * - accuracy: "no outcomes recorded yet" while migration 032 is
 *   unapplied; a % only once 20 outcomes have resolved.
 * - errors: "error logging not yet active" while migration 048 is
 *   unapplied — never an empty chart pretending to be zero errors.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { accuracySummaryLine } from '@/lib/prediction-accuracy';
import { spendAlertBudgets } from '@/services/ai-engine/usage';

interface ProviderStatus {
  key: string;
  name: string;
  kind: string;
  capabilities: string[];
  available: boolean;
  status: string;
  detail: string;
}

interface UsageSummary {
  generatedAt: string;
  note: string;
  providers: Array<{
    key: string;
    calls: number;
    success: number;
    failure: number;
    avgLatencyMs: number | null;
    consecutiveFailures: number;
    circuitOpen: boolean;
    lastCalledAt: string | null;
  }>;
  capabilities: Array<{
    capability: string;
    calls: number;
    success: number;
    failure: number;
    avgLatencyMs: number | null;
  }>;
  budgets: Array<{
    key: string;
    used: number;
    budget: number;
    remaining: number;
    exhausted: boolean;
  }>;
}

interface AccuracyPayload {
  summary: {
    totalRecorded: number;
    resolved: number;
    correct: number;
    incorrect: number;
    pending: number;
    expired: number;
    accuracyPercent: number | null;
    hasEnoughHistory: boolean;
    status: 'not-enough-history' | 'ready';
    byHorizon: Array<{
      horizonDays: number;
      resolved: number;
      correct: number;
      accuracyPercent: number | null;
    }>;
  };
  tableMissing: boolean;
  error?: string;
}

interface ErrorsPayload {
  tableMissing: boolean;
  error?: string;
  total: number;
  scanned: number;
  byRoute: Array<{ label: string; count: number }>;
  byLevel: Array<{ label: string; count: number }>;
  recent: Array<{
    id: string;
    created_at: string;
    level: string;
    message: string;
    route: string | null;
  }>;
}

interface DataQualityPayload {
  productsTotal: number;
  productsWithImages: number;
  productsWithGtin: number;
  productsWithSpecs: number;
  productsWithReviews: number;
  productsWithHistory: number;
  priceHistoryPoints: number;
  verification: { verified: number; unverified: number; stale: number; unknown: number };
  freshness: { fresh: number; stale: number; unknown: number };
  averageDataQualityScore: number | null;
  columnsMissing: boolean;
  /** Section 21–25, Stage H (H-P2-4): the average may understate. */
  scoreMayUnderstate?: boolean;
  merchantSourceMissing?: boolean;
  /** Section 21–25, Stage H (H-P2-2): 5-state taxonomy counts. */
  qualityStates?: { verified: number; partial: number; unverified: number; stale: number; missing: number };
  /**
   * Final 100% — F-P2-15: suspicious price changes awaiting
   * review (migration-057 flag). Absent on older payloads.
   */
  suspiciousPriceFlags?: Array<{
    productId: string;
    productName: string | null;
    price: number | null;
    recordedAt: string;
    source: string | null;
  }>;
  suspiciousPriceFlagCount?: number;
  /**
   * Final 100%, F-P1-51 — the three metrics the service computed
   * but no UI rendered (historyCoverage, sourceReliability,
   * lastSuccessfulUpdate + productsWithSuccessfulUpdate). All
   * optional: an older API payload simply renders the
   * "not available" state instead of crashing.
   */
  historyCoverage?: Record<
    string,
    { points: number; spanDays: number; firstRecordedAt: string | null; lastRecordedAt: string | null }
  >;
  sourceReliability?: Record<
    string,
    { points: number; suspicious: number; reliability: number | null }
  >;
  historyProvenanceMissing?: boolean;
  lastSuccessfulUpdate?: Record<
    string,
    { at: string | null; source: 'column' | 'price-history' | 'merchant-sync' | null; columnMissing: boolean }
  >;
  productsWithSuccessfulUpdate?: number;
  lastSuccessfulUpdateColumnMissing?: boolean;
  notes: string[];
}

interface ProviderHealthPayload {
  providers: Array<{
    key: string;
    name: string;
    category: string;
    available: boolean;
    notConfiguredReason: string | null;
    breaker: {
      open: boolean;
      halfOpen: boolean;
      consecutiveFailures: number;
      openedAt: string | null;
    };
    budget: {
      used: number;
      limit: number;
      remaining: number;
      allowed: boolean;
      dateKey: string;
      fromEnv: boolean;
    };
  }>;
  health: Array<{
    providerKey: string;
    status: string;
    successCount: number;
    failureCount: number;
    consecutiveFailures: number;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastError: string | null;
    avgResponseMs: number | null;
  }>;
  syncHistory: Array<{
    id: string;
    providerKey: string;
    syncType: string;
    status: string;
    recordsFetched: number;
    recordsInserted: number;
    recordsUpdated: number;
    recordsRejected: number;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
  merchantReliability: Array<{
    merchantId: string;
    merchantName: string;
    score: number | null;
    level: string;
    verified: boolean | null;
    trustGrade: string | null;
    explanation: string;
    notEnoughData: boolean;
  }>;
  serviceUnavailable: boolean;
  tablesMissing: string[];
  generatedAt: string;
}

interface AiAdminData {
  providers: ProviderStatus[];
  usage: UsageSummary;
  accuracy: AccuracyPayload | null;
  errors: ErrorsPayload | null;
  dataQuality: DataQualityPayload | null;
  serviceUnavailable: boolean;
}

export function AiControlCenter() {
  const [data, setData] = useState<AiAdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sections 21–25, Stage B (B13) — provider health (registry
  // providers, not AI providers): read-only, same fetch pattern
  // as the main payload. A failed load degrades to an honest
  // "could not be loaded" note, never a blank section.
  const [providerHealth, setProviderHealth] = useState<ProviderHealthPayload | null>(null);
  const [providerHealthError, setProviderHealthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/admin/ai')
      .then(async (res) => {
        if (!res.ok) throw new Error(`AI admin data request failed (${res.status})`);
        const body = (await res.json()) as { data?: AiAdminData };
        if (!cancelled) setData(body.data ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'AI admin data could not be loaded.');
        }
      });
    fetch('/api/v1/admin/providers')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Provider health request failed (${res.status})`);
        const body = (await res.json()) as { data?: ProviderHealthPayload };
        if (!cancelled) setProviderHealth(body.data ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setProviderHealthError(err instanceof Error ? err.message : 'Provider health could not be loaded.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
        AI control-center data could not be loaded: {error}
      </p>
    );
  }

  if (!data) {
    return (
      <div className="mt-6 flex items-center gap-2 text-muted-foreground">
        <LoadingSpinner />
        <span>Loading AI control center…</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {data.serviceUnavailable ? (
        <p className="rounded-lg border border-dashed p-6 text-muted-foreground">
          The service-role key is not configured, so prediction accuracy and
          the error breakdown cannot be read. Provider status and usage below
          are still shown — they do not need the database.
        </p>
      ) : null}

      <section aria-label="Provider status">
        <h2 className="text-xl font-semibold">Provider status</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Live providers are reported as available-unverified when their key
          is configured — a present key is not proof the provider answers,
          because probing would spend quota.
        </p>
        <div className="mt-4 space-y-3">
          {data.providers.map((p) => (
            <Card key={p.key}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {p.name}
                  <Badge variant={p.available ? 'default' : 'secondary'}>
                    {p.status}
                  </Badge>
                  <Badge variant="outline">{p.kind}</Badge>
                </CardTitle>
                <CardDescription>{p.detail}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Capabilities: {p.capabilities.join(', ') || 'none listed'}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-label="Provider health">
        <h2 className="text-xl font-semibold">Provider health</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Registry data providers (CSV, Amazon, Best Buy, Apify) — read
          only. A provider that cannot fetch says why, in plain
          language; a provider with no recorded calls shows no health
          history rather than a guessed status.
        </p>
        {providerHealthError ? (
          <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
            Provider health could not be loaded: {providerHealthError}
          </p>
        ) : !providerHealth ? (
          <div className="mt-4 flex items-center gap-2 text-muted-foreground">
            <LoadingSpinner />
            <span>Loading provider health…</span>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {providerHealth.serviceUnavailable ? (
              <p className="rounded-lg border border-dashed p-6 text-muted-foreground">
                The service-role key is not configured, so recorded
                provider health and sync history cannot be read. The
                provider list below still shows configuration status —
                it does not need the database.
              </p>
            ) : null}
            {providerHealth.tablesMissing.length > 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Not recorded yet — these tables have not been applied, so
                there is no history to show: {providerHealth.tablesMissing.join(', ')}.
                This is missing data, not zero activity.
              </p>
            ) : null}
            <div className="space-y-3">
              {providerHealth.providers.map((p) => {
                const recorded = providerHealth.health.find((h) => h.providerKey === p.key);
                return (
                  <Card key={p.key}>
                    <CardHeader>
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {p.name}
                        <Badge variant={p.available ? 'default' : 'secondary'}>
                          {p.available ? 'Available' : 'Not configured'}
                        </Badge>
                        <Badge variant="outline">{p.category}</Badge>
                        {p.breaker.open ? (
                          <Badge variant="destructive">Circuit open</Badge>
                        ) : p.breaker.halfOpen ? (
                          <Badge variant="outline">Circuit half-open (probe allowed)</Badge>
                        ) : null}
                      </CardTitle>
                      <CardDescription>
                        {p.notConfiguredReason ?? 'No configuration issue recorded.'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Daily budget: {p.budget.used} of {p.budget.limit} calls used
                        ({p.budget.remaining} remaining, {p.budget.dateKey}
                        {p.budget.fromEnv ? ', limit set by the owner' : ', default limit'}).
                      </p>
                      {recorded ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Recorded health: {recorded.status} — {recorded.successCount} succeeded,{' '}
                          {recorded.failureCount} failed
                          {recorded.consecutiveFailures > 0
                            ? `, ${recorded.consecutiveFailures} consecutive failure(s)`
                            : ''}
                          {recorded.avgResponseMs !== null
                            ? `, average latency ${recorded.avgResponseMs} ms`
                            : ''}
                          {recorded.lastSuccessAt
                            ? `. Last success ${new Date(recorded.lastSuccessAt).toLocaleString('en-GB')}`
                            : '. No successful call recorded yet'}
                          {recorded.lastFailureAt
                            ? `; last failure ${new Date(recorded.lastFailureAt).toLocaleString('en-GB')}`
                            : ''}
                          {recorded.lastError ? `. Last error: ${recorded.lastError}` : ''}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-muted-foreground">
                          No recorded health yet — this provider has never had a call recorded.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            {providerHealth.syncHistory.length > 0 ? (
              <div className="rounded-lg border p-4">
                <p className="font-medium">Recent syncs</p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {providerHealth.syncHistory.map((s) => (
                    <li key={s.id}>
                      {s.providerKey} · {s.syncType} · {s.status} — {s.recordsFetched} fetched,{' '}
                      {s.recordsInserted} inserted, {s.recordsRejected} rejected ·{' '}
                      {new Date(s.startedAt).toLocaleString('en-GB')}
                      {s.errorMessage ? ` — ${s.errorMessage}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No syncs recorded yet — no provider call has written sync history.
              </p>
            )}
            <div className="rounded-lg border p-4">
              <p className="font-medium">Merchant reliability</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Canonical scorer: recorded policy, trust grade, verified badge and directory
                signals only. A merchant with too little evidence gets no score, never a guess.
              </p>
              {providerHealth.merchantReliability.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No merchants to score yet.
                </p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                  {providerHealth.merchantReliability.map((m) => (
                    <li key={m.merchantId}>
                      <span className="font-medium text-foreground">{m.merchantName}</span>
                      {m.score !== null ? (
                        <> — {m.score}/100 ({m.level})</>
                      ) : (
                        <> — not enough data to score</>
                      )}
                      {m.trustGrade ? <> · trust grade {m.trustGrade}</> : null}
                      {m.verified === true ? <> · Verified Merchant badge</> : null}
                      <br />
                      <span>{m.explanation}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Generated at {new Date(providerHealth.generatedAt).toLocaleString('en-GB')}.
            </p>
          </div>
        )}
      </section>

      <section aria-label="Usage">
        <h2 className="text-xl font-semibold">Usage</h2>
        <p className="mt-1 text-sm text-muted-foreground">{data.usage.note}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Generated at {new Date(data.usage.generatedAt).toLocaleString('en-GB')}.
        </p>
        {data.usage.providers.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
            No AI provider calls recorded on this instance yet — counts start
            at zero after each deploy.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {data.usage.providers.map((p) => (
              <Card key={p.key}>
                <CardContent className="pt-6">
                  <p className="font-medium">
                    {p.key}
                    {p.circuitOpen ? (
                      <Badge variant="destructive" className="ml-2">
                        Circuit open
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {p.calls} call(s) — {p.success} succeeded, {p.failure}{' '}
                    failed
                    {p.avgLatencyMs !== null
                      ? `, average latency ${p.avgLatencyMs} ms`
                      : ', no latency recorded yet'}
                    .{p.lastCalledAt ? ` Last called ${new Date(p.lastCalledAt).toLocaleString('en-GB')}.` : ''}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {/* Section 19, §12 #7: spend alert — visible when any daily
            provider budget is ≥80% used. Counts are the same
            in-memory per-instance counters as the usage note above
            (reset on deploy, not shared across instances). */}
        {(() => {
          const alerts = spendAlertBudgets(data.usage.budgets);
          if (alerts.length === 0) return null;
          return (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950"
            >
              <p className="font-medium">
                Spend alert — daily provider budget nearly used
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {alerts.map((b) => (
                  <li key={b.key}>
                    {b.key}: {b.used} of {b.budget} daily calls used (
                    {Math.round(b.percentUsed * 100)}%)
                    {b.exhausted
                      ? ' — budget exhausted, live calls fall back honestly.'
                      : ' — live calls stop at the budget and fall back honestly.'}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                These counts are in-memory per-instance counters — they
                reset on deploy and are not shared across instances.
              </p>
            </div>
          );
        })()}
        {data.usage.budgets.length > 0 ? (
          <div className="mt-4 rounded-lg border p-4">
            <p className="font-medium">Daily provider budgets</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {data.usage.budgets.map((b) => (
                <li key={b.key}>
                  {b.key}: {b.used} of {b.budget} used today
                  {b.exhausted ? ' — budget exhausted, live calls fall back honestly.' : ` — ${b.remaining} remaining.`}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {data.usage.capabilities.length > 0 ? (
          <div className="mt-4 rounded-lg border p-4">
            <p className="font-medium">Calls by capability</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {data.usage.capabilities.map((c) => (
                <li key={c.capability}>
                  {c.capability}: {c.calls} call(s) — {c.success} succeeded,{' '}
                  {c.failure} failed
                  {c.avgLatencyMs !== null ? `, average ${c.avgLatencyMs} ms` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-label="Catalog data quality">
        <h2 className="text-xl font-semibold">Catalog data quality</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What the AI reasons over: verification, freshness, and
          coverage of the stored catalog. The score below is a data
          quality score — how complete, verifiable, and fresh each
          product&apos;s record is — never a judgement of the product
          itself.
        </p>
        {!data.dataQuality ? (
          <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
            Data quality is unavailable — the service-role key is not
            configured, so the dashboard cannot read the catalog.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border p-6">
              <p className="text-sm text-muted-foreground">Average data quality score</p>
              {data.dataQuality.averageDataQualityScore !== null ? (
                <p className="mt-1 text-4xl font-bold">
                  {data.dataQuality.averageDataQualityScore} / 100
                </p>
              ) : (
                <p className="mt-1 text-2xl font-bold">No products to score yet</p>
              )}
              <p className="mt-1 text-sm text-muted-foreground">
                Across {data.dataQuality.productsTotal} product(s). A
                score is computed from stored fields only — identity,
                specs, images, price freshness, merchants, GTIN, and
                source attribution — with missing fields counted as
                missing, never guessed.
              </p>
              {/* Section 21–25, Stage H (H-P2-4): never show a bare
                  average while a verification/source column is
                  missing — the number is a lower bound, say so. */}
              {data.dataQuality.scoreMayUnderstate ? (
                <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
                  This average may understate data quality: a
                  verification or price-source column does not exist
                  yet (migration 045 not applied), so the attribution
                  dimension cannot count a recorded price source.
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-medium">Data verification (5-state taxonomy)</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The same label system the public product page shows
                per product: Verified / Partially verified /
                Unverified / Stale / Missing information.
              </p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>Verified: {data.dataQuality.qualityStates?.verified ?? 0}</li>
                <li>Partially verified: {data.dataQuality.qualityStates?.partial ?? 0}</li>
                <li>Unverified: {data.dataQuality.qualityStates?.unverified ?? 0}</li>
                <li>Stale: {data.dataQuality.qualityStates?.stale ?? 0}</li>
                <li>Missing information: {data.dataQuality.qualityStates?.missing ?? 0}</li>
              </ul>
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-medium">Verification distribution</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>Verified: {data.dataQuality.verification.verified}</li>
                <li>Unverified: {data.dataQuality.verification.unverified}</li>
                <li>Stale (verified, then aged past 7 days): {data.dataQuality.verification.stale}</li>
                {data.dataQuality.verification.unknown > 0 ? (
                  <li>Unknown (verification columns not applied yet): {data.dataQuality.verification.unknown}</li>
                ) : null}
              </ul>
            </div>
            {/* Final 100% — F-P2-15: the suspicious-price review
                surface. Detection without review was dead: flagged
                rows now list here with product, price, date and
                source, so an admin can check the merchant listing
                before acting. A flag is a pattern description
                (spike / fake-sale / inflation), never an accusation
                — the list never quarantines or deletes anything.
                The count is the notification: any admin opening
                this panel sees how many flags await review. When
                migration 057 is unapplied the flag cannot be stored
                and the list is empty by construction (the Notes
                below say so). */}
            <div className="rounded-lg border p-4">
              <p className="font-medium">
                Suspicious price changes — needs review (
                {data.dataQuality.suspiciousPriceFlagCount ?? 0})
              </p>
              {(data.dataQuality.suspiciousPriceFlagCount ?? 0) === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  No suspicious price changes are flagged right now.
                </p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {(data.dataQuality.suspiciousPriceFlags ?? []).map((flag) => (
                    <li key={`${flag.productId}-${flag.recordedAt}`}>
                      {flag.productName ?? flag.productId} —{' '}
                      {flag.price !== null ? `$${flag.price.toFixed(2)}` : 'price unknown'} on{' '}
                      {new Date(flag.recordedAt).toLocaleDateString()}
                      {flag.source ? ` (source: ${flag.source})` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-medium">Price freshness</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>Fresh (checked within 7 days): {data.dataQuality.freshness.fresh}</li>
                <li>Stale: {data.dataQuality.freshness.stale}</li>
                <li>Age unknown: {data.dataQuality.freshness.unknown}</li>
              </ul>
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-medium">Coverage (of {data.dataQuality.productsTotal} product(s))</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>With an image: {data.dataQuality.productsWithImages}</li>
                <li>With a GTIN: {data.dataQuality.productsWithGtin}</li>
                <li>With specs: {data.dataQuality.productsWithSpecs}</li>
                <li>With reviews: {data.dataQuality.productsWithReviews}</li>
                <li>
                  With price history: {data.dataQuality.productsWithHistory} (
                  {data.dataQuality.priceHistoryPoints} point(s) total)
                </li>
              </ul>
            </div>
            {/* Final 100%, F-P1-51 — the three metrics the service
                computed but this panel dropped: price-history
                coverage, per-source reliability, and last
                successful update. Every number comes from the
                payload (real DB records); a missing provenance
                column renders as "cannot be computed", never as a
                zero. */}
            <div className="rounded-lg border p-4">
              <p className="font-medium">Price-history coverage</p>
              {data.dataQuality.historyProvenanceMissing ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Cannot be computed — price-history provenance columns do not exist yet
                  (migration 057 not applied), so per-product coverage is unknown, not zero.
                </p>
              ) : data.dataQuality.historyCoverage &&
                Object.keys(data.dataQuality.historyCoverage).length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {Object.entries(data.dataQuality.historyCoverage).map(([id, c]) => (
                    <li key={id}>
                      {c.points} point(s) over {c.spanDays} day(s)
                      {c.lastRecordedAt
                        ? ` — latest ${new Date(c.lastRecordedAt).toLocaleDateString('en-GB')}`
                        : ' — no recorded point'}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  No price-history coverage recorded — no product has a
                  provenance-carrying history point yet.
                </p>
              )}
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-medium">Per-source reliability</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Share of non-suspicious price-history points per source — a recorded-history
                ratio, not a trust score. A source with one clean point scores 1.0, which
                means &ldquo;nothing flagged yet&rdquo;, not &ldquo;proven reliable&rdquo;.
              </p>
              {data.dataQuality.historyProvenanceMissing ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Cannot be computed — price-history provenance columns do not exist yet
                  (migration 057 not applied).
                </p>
              ) : data.dataQuality.sourceReliability &&
                Object.keys(data.dataQuality.sourceReliability).length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {Object.entries(data.dataQuality.sourceReliability).map(([source, r]) => (
                    <li key={source}>
                      {source}: {r.reliability !== null ? `${Math.round(r.reliability * 100)}% clean` : 'no points'} (
                      {r.points} point(s), {r.suspicious} flagged)
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  No per-source reliability yet — no price-history point carries a source.
                </p>
              )}
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-medium">Last successful update</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The last time a real provider response was validated AND saved — distinct from
                &ldquo;last checked&rdquo;. {data.dataQuality.productsWithSuccessfulUpdate ?? 0} of{' '}
                {data.dataQuality.productsTotal} product(s) have one recorded.
                {data.dataQuality.lastSuccessfulUpdateColumnMissing
                  ? ' The stored column does not exist yet (migration 066 not applied), so values below are derived from live-source history and merchant syncs, not stored.'
                  : ''}
              </p>
              {data.dataQuality.lastSuccessfulUpdate &&
              Object.values(data.dataQuality.lastSuccessfulUpdate).some((v) => v.at !== null) ? (
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {Object.entries(data.dataQuality.lastSuccessfulUpdate)
                    .filter(([, v]) => v.at !== null)
                    .map(([id, v]) => (
                      <li key={id}>
                        {v.at ? new Date(v.at).toLocaleString('en-GB') : '—'}
                        {v.source ? ` (from ${v.source})` : ''}
                        {v.columnMissing ? ' — derived, not stored' : ''}
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  No product has a recorded successful update yet — no provider-validated save
                  has happened. That is the honest state for the seeded catalog, not a gap in
                  this panel.
                </p>
              )}
            </div>
            {/* Final 100%, F-P1-50 (dashboard half) — the canonical
                merchant-reliability scorer (policy scorer:
                recorded policy + trust grade + verified badge +
                directory signals) as shown in the provider-health
                section above, summarised here so the data-quality
                panel carries it too. The sync scorer in deal
                ranking and the history-based per-source ratio above
                are different dimensions, not duplicates. */}
            <div className="rounded-lg border p-4">
              <p className="font-medium">Merchant reliability (canonical policy scorer)</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Scored from recorded policy, trust grade, verified badge and directory signals
                only. A merchant with too little evidence gets no score, never a guess.
              </p>
              {!providerHealth ? (
                <p className="mt-1 text-sm text-muted-foreground">Loading merchant reliability…</p>
              ) : providerHealth.merchantReliability.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  No merchants to score yet.
                </p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {providerHealth.merchantReliability.map((m) => (
                    <li key={m.merchantId}>
                      <span className="font-medium text-foreground">{m.merchantName}</span>
                      {m.score !== null ? <> — {m.score}/100 ({m.level})</> : <> — not enough data to score</>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {data.dataQuality.notes.length > 0 ? (
              <div className="rounded-lg border border-dashed p-4">
                <p className="font-medium">Notes</p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {data.dataQuality.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-sm">
              <Link href="/admin/data-quality" className="underline">
                Data-quality dashboard — totals, coverage, reliability, refresh monitoring
              </Link>
              {' · '}
              <Link href="/admin/products/review" className="underline">
                Review the catalog — duplicates, missing specs, images, price history
              </Link>
            </p>
          </div>
        )}
      </section>

      <section aria-label="Prediction accuracy">
        <h2 className="text-xl font-semibold">Prediction accuracy</h2>
        {!data.accuracy ? (
          <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
            Accuracy is unavailable — the service-role key is not configured,
            so the dashboard cannot read the recorded outcomes.
          </p>
        ) : data.accuracy.error ? (
          <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
            Accuracy could not be read: {data.accuracy.error}
          </p>
        ) : data.accuracy.tableMissing ? (
          <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
            No prediction outcomes recorded yet — the prediction_outcomes
            table (migration 032) has not been applied, so no accuracy can
            be measured. An accuracy percentage is published only once 20
            outcomes have resolved.
          </p>
        ) : (
          <div className="mt-4 rounded-lg border p-6">
            {data.accuracy.summary.accuracyPercent !== null ? (
              <p className="text-4xl font-bold">
                {data.accuracy.summary.accuracyPercent}%
              </p>
            ) : (
              <p className="text-2xl font-bold">No accuracy percentage yet</p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              {accuracySummaryLine(data.accuracy.summary)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {data.accuracy.summary.totalRecorded} outcome(s) recorded —{' '}
              {data.accuracy.summary.resolved} resolved,{' '}
              {data.accuracy.summary.pending} still waiting for their horizon
              to pass, {data.accuracy.summary.expired} expired.
            </p>
          </div>
        )}
      </section>

      <section aria-label="AI error breakdown">
        <h2 className="text-xl font-semibold">AI error breakdown</h2>
        {!data.errors ? (
          <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
            The error breakdown is unavailable — the service-role key is not
            configured, so the dashboard cannot read the error log.
          </p>
        ) : data.errors.error ? (
          <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
            The error breakdown could not be read: {data.errors.error}
          </p>
        ) : data.errors.tableMissing ? (
          <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
            Error logging is not yet active — the error_log table (migration
            048) has not been applied, so no AI error has ever been stored
            in-app. This is not a claim of zero errors: until the table is
            applied, errors surface only in the deployment logs and in
            Sentry (when a DSN is configured).
          </p>
        ) : data.errors.total === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
            No AI errors recorded in the last {data.errors.scanned} error-log
            row(s). That is a count of what was stored, not proof the AI
            surface is error-free — most AI routes do not log errors into
            the table yet, so an empty log is partly a missing-writer gap.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-muted-foreground">
              {data.errors.total} AI error(s) in the last {data.errors.scanned}{' '}
              error-log row(s).
            </p>
            <div className="rounded-lg border p-4">
              <p className="font-medium">By route</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {data.errors.byRoute.map((g) => (
                  <li key={g.label}>
                    {g.label}: {g.count}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-medium">By level</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {data.errors.byLevel.map((g) => (
                  <li key={g.label}>
                    {g.label}: {g.count}
                  </li>
                ))}
              </ul>
            </div>
            {data.errors.recent.length > 0 ? (
              <ul className="space-y-2">
                {data.errors.recent.map((e) => (
                  <li key={e.id} className="rounded-lg border p-4 text-sm">
                    <p>
                      <span className="font-medium">{e.level}</span>
                      {e.route ? ` · ${e.route}` : ''} ·{' '}
                      {new Date(e.created_at).toLocaleString('en-GB')}
                    </p>
                    <p className="mt-1 text-muted-foreground">{e.message}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
        <p className="mt-4 text-sm">
          <Link href="/owner" className="underline">
            Full error log on the owner dashboard
          </Link>
        </p>
      </section>
    </div>
  );
}
