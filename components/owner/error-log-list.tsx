/**
 * Owner error-log list — Section 19, §12 #73.
 *
 * Client-side route filter for the owner dashboard's error log
 * (app/owner/page.tsx). The server already fetches the most recent
 * 20 rows; this component only filters what is displayed — no new
 * fetch, no new query. The select lists the routes actually present
 * in those 20 rows (plus "All routes"); rows with no route are
 * grouped under "no route recorded". Filtering to a route with no
 * rows in the window says so honestly instead of rendering an
 * empty list.
 */

'use client';

import { useMemo, useState } from 'react';
import type { ErrorLogRow } from '@/services/error-log-admin';

const ALL_ROUTES = 'all';
const NO_ROUTE = 'no route recorded';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ErrorLogList({ errors }: { errors: ErrorLogRow[] }) {
  const [route, setRoute] = useState<string>(ALL_ROUTES);

  const routes = useMemo(() => {
    const seen = new Set<string>();
    for (const entry of errors) {
      seen.add(entry.route ?? NO_ROUTE);
    }
    return [...seen].sort();
  }, [errors]);

  const visible = useMemo(
    () =>
      route === ALL_ROUTES
        ? errors
        : errors.filter((entry) => (entry.route ?? NO_ROUTE) === route),
    [errors, route]
  );

  return (
    <div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor="error-log-route-filter" className="text-sm font-medium">
          Filter by route
        </label>
        <select
          id="error-log-route-filter"
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-sm"
        >
          <option value={ALL_ROUTES}>All routes ({errors.length})</option>
          {routes.map((r) => (
            <option key={r} value={r}>
              {r} ({errors.filter((entry) => (entry.route ?? NO_ROUTE) === r).length})
            </option>
          ))}
        </select>
      </div>
      {visible.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
          No errors recorded for route &ldquo;{route}&rdquo; in the most
          recent {errors.length} error-log row(s).
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {visible.map((entry) => (
            <li key={entry.id} className="rounded-lg border p-4 text-sm">
              <p>
                <span className="font-medium">{entry.level}</span>
                {entry.route ? ` · ${entry.route}` : ''} ·{' '}
                {formatDateTime(entry.created_at)}
              </p>
              <p className="mt-1 text-muted-foreground">{entry.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
