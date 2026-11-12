/**
 * Section 17, Stage H item 19 — owner dashboard.
 *
 * buildOwnerOverview() is the pure aggregation in services/owner.ts,
 * so it is unit-tested here with plain data — no database, no
 * network. The page wiring (admin-only guard, loading state,
 * noindex, honest copy) is asserted by reading the source files as
 * text, same approach as the other metadata/guard tests.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildOwnerOverview, type OwnerOverviewInput } from '@/services/owner';

function readSource(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function input(partial: Partial<OwnerOverviewInput>): OwnerOverviewInput {
  return {
    subscriptionRows: null,
    totalApiKeys: null,
    apiCallsLast7Days: null,
    apiUsageTableMissing: true,
    totalProducts: null,
    totalMerchants: null,
    latestFreshness: null,
    catalogTableMissing: true,
    refreshRuns: null,
    refreshRunsTableMissing: true,
    totalUptimeChecks: null,
    latestUptimeCheck: null,
    uptimeTableMissing: true,
    ...partial,
  };
}

describe('buildOwnerOverview — pure aggregation', () => {
  it('revenue is always $0, never computed from plan prices', () => {
    const overview = buildOwnerOverview(
      input({
        subscriptionRows: [
          { plan: 'premium', status: 'active' },
          { plan: 'team', status: 'active' },
          { plan: 'free', status: 'active' },
        ],
      })
    );
    expect(overview.revenueUsd).toBe(0);
    expect(overview.subscriptions.activePaid).toBe(2);
    expect(overview.subscriptions.total).toBe(3);
    expect(overview.subscriptions.byPlan).toEqual({ premium: 1, team: 1, free: 1 });
  });

  it('counts subscriptions by plan and active status', () => {
    const overview = buildOwnerOverview(
      input({
        subscriptionRows: [
          { plan: 'free', status: 'active' },
          { plan: 'premium', status: 'canceled' },
          { plan: 'premium', status: 'active' },
        ],
      })
    );
    expect(overview.subscriptions.total).toBe(3);
    expect(overview.subscriptions.active).toBe(2);
    expect(overview.subscriptions.activePaid).toBe(1);
  });

  it('reports missing tables as unknown, never as zero measurements', () => {
    const overview = buildOwnerOverview(input({}));
    expect(overview.subscriptions.total).toBeNull();
    expect(overview.subscriptions.tableMissing).toBe(true);
    expect(overview.apiUsage.callsLast7Days).toBeNull();
    expect(overview.apiUsage.tableMissing).toBe(true);
    expect(overview.refreshHealth.latestRun).toBeNull();
    expect(overview.refreshHealth.tableMissing).toBe(true);
    expect(overview.uptimeHealth.totalChecks).toBeNull();
    expect(overview.uptimeHealth.tableMissing).toBe(true);
    expect(overview.errorLogsAvailable).toBe(false);
  });

  it('lists the failed steps of the latest refresh run', () => {
    const overview = buildOwnerOverview(
      input({
        refreshRuns: [
          {
            id: 'r1',
            source: 'cron',
            started_at: '2026-11-12T10:00:00.000Z',
            finished_at: '2026-11-12T10:01:00.000Z',
            status: 'completed_with_failures',
            steps: {
              refresh: { status: 'ok' },
              alerts: { status: 'failed', error: 'boom' },
              digest: { status: 'skipped' },
            },
            error: null,
          },
        ],
        refreshRunsTableMissing: false,
      })
    );
    expect(overview.refreshHealth.latestRun?.id).toBe('r1');
    expect(overview.refreshHealth.latestFailedSteps).toEqual(['alerts']);
    expect(overview.refreshHealth.tableMissing).toBe(false);
  });

  it('passes through price-source health and uptime', () => {
    const overview = buildOwnerOverview(
      input({
        totalProducts: 10,
        totalMerchants: 2,
        latestFreshness: '2026-11-02T00:00:00.000Z',
        catalogTableMissing: false,
        totalUptimeChecks: 42,
        latestUptimeCheck: { checked_at: '2026-11-12T09:00:00.000Z', ok: true },
        uptimeTableMissing: false,
      })
    );
    expect(overview.priceSourceHealth.totalProducts).toBe(10);
    expect(overview.priceSourceHealth.latestFreshness).toBe('2026-11-02T00:00:00.000Z');
    expect(overview.uptimeHealth.totalChecks).toBe(42);
    expect(overview.uptimeHealth.lastCheckOk).toBe(true);
  });
});

describe('owner dashboard wiring', () => {
  it('layout enforces the admin-only guard (same pattern as /admin)', () => {
    const src = readSource('app/owner/layout.tsx');
    expect(src).toContain("redirect('/sign-in?reason=session-expired')");
    expect(src).toContain("redirect('/dashboard')");
    // Section 18, Phase 0 (audit §1 #1): the role is resolved via
    // fetchProfileRoleName (role_id → roles.name) — the old
    // `.select('role')` read a column that does not exist in the
    // migration chain and redirected every admin to /dashboard.
    expect(src).toContain('fetchProfileRoleName');
    expect(src).not.toContain(".select('role')");
    expect(src).toContain("export const dynamic = 'force-dynamic'");
    expect(src).toContain('index: false');
  });

  it('page states revenue $0 with the test-mode reason and never invents a figure', () => {
    const src = readSource('app/owner/page.tsx');
    expect(src).toContain('$0');
    expect(src).toContain('Stripe is in test mode');
    expect(src).not.toMatch(/revenue.*\*|priceLabel|getTier/);
  });

  it('page has honest empty states for missing tables and an error-log section backed by the error-log store', () => {
    const src = readSource('app/owner/page.tsx');
    expect(src).toContain('has not been applied');
    // Section 18, item 45 BUILT the error-log store (migration
    // 048 + services/error-log-admin.ts), so the old "no error-log
    // store in the app" premise is superseded BY DESIGN. The page
    // now renders an Error logs section from listRecentErrors,
    // with honest empty states: 048-not-applied (errors still
    // surface in the Vercel deployment logs) and an empty table
    // ("No errors recorded yet").
    expect(src).toContain('Error logs');
    expect(src).toContain('listRecentErrors');
    expect(src).toContain('error-log-admin');
    expect(src).toContain('migration 048');
    expect(src).toContain('has not been applied');
    expect(src).toContain('No errors recorded yet');
    expect(src).toContain('Vercel deployment logs');
    expect(src).not.toContain('no error-log store in the app');
  });

  it('has a loading state and is disallowed in robots.txt', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'app/owner/loading.tsx'))).toBe(true);
    expect(readSource('app/robots.ts')).toContain("'/owner/'");
  });
});
