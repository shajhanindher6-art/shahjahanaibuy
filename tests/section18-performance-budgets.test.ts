/**
 * Section 18, Phase 2 — bundle-size test (audit §1 #19, §12 item 25).
 *
 * No test asserted any bundle size: enforcement was only the
 * lighthouse workflow, which hard-gates /products/[slug] ≤350 kB.
 * This test reads the budget table in docs/performance-budgets.md
 * and asserts the budgets are present and sane — the product page
 * hard gate (≤350 kB) and the homepage warning re-lock (≤350 kB) —
 * against the recorded Section 17 gate numbers (item 24: product
 * 330 kB, homepage 321 kB, /owner 302 kB, /admin/refresh-runs
 * 144 kB, /dashboard/saved-searches 165 kB). It also guards the
 * stale figures: the budget table must carry the Section 17
 * numbers (330/321), not the superseded 329/320 baselines.
 *
 * This test asserts the RECORDED numbers, not a live build — a
 * clean build is the gate's job (see the Section 18 report). If a
 * later build moves a number, update the doc first (with the
 * reason + date, per the doc's own rule) and this test follows.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

function readBudgetsDoc(): string {
  return fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'docs',
      'performance-budgets.md'
    ),
    'utf8'
  );
}

/** First Load kB recorded for a route in the budget table. */
function recordedKb(doc: string, route: string): number | null {
  const row = doc
    .split('\n')
    .find((line) => line.startsWith(`| \`${route}\``));
  if (!row) return null;
  // The row leads with the BUDGET (≤ 350 kB); the measured number
  // is the "Baseline: N kB" / "recorded N kB" figure in the Notes
  // cell — parse that, never the budget.
  const m = row.match(/(?:Baseline: |recorded )(\d+)\s*kB/);
  return m ? parseInt(m[1], 10) : null;
}

describe('performance budgets doc (Section 18, item 25)', () => {
  it('records the Section 17 gate numbers (item 24)', () => {
    const doc = readBudgetsDoc();
    expect(recordedKb(doc, '/products/[slug]')).toBe(330);
    expect(recordedKb(doc, '/')).toBe(321);
    expect(recordedKb(doc, '/owner')).toBe(302);
    expect(recordedKb(doc, '/admin/refresh-runs')).toBe(144);
    expect(recordedKb(doc, '/dashboard/saved-searches')).toBe(165);
    expect(recordedKb(doc, '/compare')).toBe(372);
  });

  it('hard-gates /products/[slug] at ≤350 kB with headroom over the baseline', () => {
    const doc = readBudgetsDoc();
    expect(doc).toContain('`/products/[slug]` | **≤ 350 kB**');
    const baseline = recordedKb(doc, '/products/[slug]');
    expect(baseline).not.toBeNull();
    expect(baseline as number).toBeLessThanOrEqual(350);
    expect(baseline as number).toBeGreaterThan(0);
  });

  it('keeps the homepage warning budget at ≤350 kB (re-locked from ≤250 kB)', () => {
    const doc = readBudgetsDoc();
    expect(doc).toContain('| `/` (homepage) | ≤ 350 kB');
    const baseline = recordedKb(doc, '/');
    expect(baseline).not.toBeNull();
    expect(baseline as number).toBeLessThanOrEqual(350);
    // The re-lock note must still be present — a silent bump is a
    // regression (see the doc's "If a budget fails" section).
    expect(doc).toContain('Warning budget honestly re-locked: ≤350 kB');
  });

  it('does not present the stale 329/320 baselines as the current numbers', () => {
    const doc = readBudgetsDoc();
    const table = doc.slice(doc.indexOf('## Budgets'), doc.indexOf('Lighthouse (mobile'));
    expect(table).not.toContain('329 kB');
    expect(table).not.toContain('320 kB');
    // The Section 17 gate section is the source of the new numbers.
    expect(doc).toContain('Section 17 gate');
    expect(doc).toContain('330 kB');
    expect(doc).toContain('321 kB');
  });

  it('records numbers only for measured routes — no invented baselines', () => {
    const doc = readBudgetsDoc();
    expect(doc).toContain('No other route has a recorded number');
    // The three admin/owner rows are recorded-only, with no budget
    // invented for them.
    for (const route of ['/owner', '/admin/refresh-runs', '/dashboard/saved-searches']) {
      const row = doc.split('\n').find((line) => line.startsWith(`| \`${route}\``));
      expect(row).toContain('No budget set');
    }
  });
});
