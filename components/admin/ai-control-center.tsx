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

interface AiAdminData {
  providers: ProviderStatus[];
  usage: UsageSummary;
  accuracy: AccuracyPayload | null;
  errors: ErrorsPayload | null;
  serviceUnavailable: boolean;
}

export function AiControlCenter() {
  const [data, setData] = useState<AiAdminData | null>(null);
  const [error, setError] = useState<string | null>(null);

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
