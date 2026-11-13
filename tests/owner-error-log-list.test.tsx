/**
 * Section 19, §12 #73 — owner error-log route filter.
 *
 * The ErrorLogList shows all rows by default; picking a route in
 * the select narrows the displayed rows to that route only, and
 * the select lists exactly the routes present in the rows passed
 * in (plus "All routes").
 *
 * Runs under the jsdom a11y config (vitest.a11y.config.ts) — the
 * main vitest config is node-only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { ErrorLogList } from '@/components/owner/error-log-list';
import type { ErrorLogRow } from '@/services/error-log-admin';

afterEach(cleanup);

function row(overrides: Partial<ErrorLogRow>): ErrorLogRow {
  return {
    id: '1',
    created_at: '2026-11-13T00:00:00.000Z',
    level: 'error',
    message: 'Something failed',
    request_id: null,
    route: 'ai-search',
    user_id: null,
    meta: null,
    ...overrides,
  };
}

const ROWS: ErrorLogRow[] = [
  row({ id: '1', route: 'ai-search', message: 'AI search failed' }),
  row({ id: '2', route: 'ai-search', message: 'AI search timed out' }),
  row({ id: '3', route: 'prices.refresh', message: 'Refresh failed' }),
  row({ id: '4', route: null, message: 'Unrouted failure' }),
];

describe('ErrorLogList route filter', () => {
  it('shows all rows by default', () => {
    render(<ErrorLogList errors={ROWS} />);
    expect(screen.getByText('AI search failed')).toBeTruthy();
    expect(screen.getByText('Refresh failed')).toBeTruthy();
    expect(screen.getByText('Unrouted failure')).toBeTruthy();
  });

  it('narrows to the selected route only', () => {
    render(<ErrorLogList errors={ROWS} />);
    fireEvent.change(screen.getByLabelText('Filter by route'), {
      target: { value: 'prices.refresh' },
    });
    expect(screen.queryByText('AI search failed')).toBeNull();
    expect(screen.queryByText('AI search timed out')).toBeNull();
    expect(screen.getByText('Refresh failed')).toBeTruthy();
    expect(screen.queryByText('Unrouted failure')).toBeNull();
  });

  it('groups rows with no route under "no route recorded"', () => {
    render(<ErrorLogList errors={ROWS} />);
    fireEvent.change(screen.getByLabelText('Filter by route'), {
      target: { value: 'no route recorded' },
    });
    expect(screen.getByText('Unrouted failure')).toBeTruthy();
    expect(screen.queryByText('Refresh failed')).toBeNull();
  });

  it('returns to all rows when "All routes" is picked again', () => {
    render(<ErrorLogList errors={ROWS} />);
    const select = screen.getByLabelText('Filter by route');
    fireEvent.change(select, { target: { value: 'ai-search' } });
    expect(screen.queryByText('Refresh failed')).toBeNull();
    fireEvent.change(select, { target: { value: 'all' } });
    expect(screen.getByText('Refresh failed')).toBeTruthy();
  });
});
