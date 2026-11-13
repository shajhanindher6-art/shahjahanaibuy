/**
 * Section 20, §12 #56 — manual refresh trigger (client button).
 *
 * POSTs to /api/v1/prices/refresh with the admin's own session
 * (same-origin fetch, cookies carry the session). The route accepts
 * a signed-in admin session as well as the cron secret, so no
 * secret is ever handled here. The refresh chain can take up to
 * 60s; the button disables while the request is in flight and then
 * reports the run's own counts (or its skipped reason) — a failed
 * step is shown from the response body, never from the status code
 * alone, because the endpoint always answers HTTP 200.
 */

'use client';

import { useState } from 'react';

interface RefreshStepResult {
  tracked?: number;
  inserted?: number;
  unchanged?: number;
  staleFlipped?: number;
}

interface RefreshResponse {
  data?: {
    skipped?: boolean;
    reason?: string;
    error?: string;
    steps?: Record<string, { status: string; result?: RefreshStepResult }>;
  };
  error?: string;
}

export function ManualRefreshButton() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function trigger() {
    setState('running');
    setMessage(null);
    try {
      const res = await fetch('/api/v1/prices/refresh', { method: 'POST' });
      const body = (await res.json().catch(() => null)) as RefreshResponse | null;
      if (!res.ok) {
        setState('error');
        setMessage(
          body?.error ?? `Refresh could not start (HTTP ${res.status}). Sign in again as an admin and retry.`
        );
        return;
      }
      const data = body?.data;
      if (data?.skipped) {
        setState('done');
        setMessage(
          `Refresh skipped: ${data.reason ?? 'another run is in progress'}${data.error ? ` — ${data.error}` : ''}`
        );
        return;
      }
      const refresh = data?.steps?.refresh?.result;
      setState('done');
      setMessage(
        refresh
          ? `Refresh finished — ${refresh.tracked ?? 0} product(s) tracked, ${refresh.inserted ?? 0} new price point(s), ${refresh.unchanged ?? 0} unchanged` +
              (refresh.staleFlipped ? `, ${refresh.staleFlipped} verified price(s) flipped to stale.` : '.')
          : 'Refresh finished — see the run list below once it is recorded.'
      );
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Refresh could not start.');
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={trigger}
        disabled={state === 'running'}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {state === 'running' ? 'Refreshing…' : 'Run price refresh now'}
      </button>
      <p className="mt-2 text-sm text-muted-foreground">
        Triggers the same chain the 6-hour cron runs, with your admin
        session — no cron secret needed. Runs are recorded only once
        migration 040 is applied; until then the result above is the
        only record.
      </p>
      {message ? (
        <p
          role="status"
          className={
            state === 'error'
              ? 'mt-2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950'
              : 'mt-2 rounded-lg border p-4 text-sm'
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
