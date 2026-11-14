/**
 * Section 16, items 1–2, 5–7 — press counts from generated JSON.
 *
 * The press page renders its test/file counts from
 * lib/generated/press-counts.json (written by
 * `npm run generate:press-counts` from a real vitest run) instead of
 * hardcoding them — hardcoding drifted twice. These tests lock the
 * mechanism, not the numbers: the JSON is re-generated whenever the
 * suite moves, so no exact count is asserted here (freshness is
 * enforced by scripts/check-press-counts.mjs + CI, not by this
 * file). The vitest-summary parser is unit-tested with fixture
 * output so the generator/checker never need a full suite run to
 * prove they parse.
 *
 * Also locks the Section 16 wording fixes on the same pages: 167
 * interface strings (items 1–2), the honest refresh wording
 * (item 5 — no "refreshed on a six-hour schedule"), and the
 * demo/seed coupon qualifier on the press page (item 6).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pressCounts from '@/lib/generated/press-counts.json';
import {
  buildPressCountsJson,
  formatPressCountsDate,
  parseVitestSummary,
  readPressCountsJson,
} from '../scripts/press-counts-run.mjs';

function readSource(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('press-counts.json — generated, not hardcoded', () => {
  it('has the committed shape: positive integer tests/files and a valid ISO date', () => {
    expect(Number.isInteger(pressCounts.tests)).toBe(true);
    expect(Number.isInteger(pressCounts.files)).toBe(true);
    expect(pressCounts.tests).toBeGreaterThan(0);
    expect(pressCounts.files).toBeGreaterThan(0);
    expect(pressCounts.tests).toBeGreaterThan(pressCounts.files);
    expect(pressCounts.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(pressCounts.date))).toBe(false);
  });

  it('is dated no later than today (a future-dated count is a stale-claim smell)', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(pressCounts.date <= today).toBe(true);
  });

  it('agrees with the shared reader (same validation the check script uses)', () => {
    const viaReader = readPressCountsJson();
    expect(viaReader.tests).toBe(pressCounts.tests);
    expect(viaReader.files).toBe(pressCounts.files);
    expect(viaReader.date).toBe(pressCounts.date);
  });

  it('is the current Master Tool Integration Stages 0–6 baseline (338 files / 4,725 tests, 14 November 2026)', () => {
    // Baseline only — the coordinator re-locks this after the final
    // full gate run (other workers add tests after this change). If
    // this test fails, regenerate the JSON
    // (`npm run generate:press-counts`) and update this baseline in
    // the same change; never edit the JSON by hand.
    expect(pressCounts).toEqual(
      expect.objectContaining({ tests: 4725, files: 338, date: '2026-11-14' }),
    );
  });
});

describe('press page — renders the JSON, never a hardcoded count', () => {
  const text = readSource('app/press/page.tsx');

  it('imports the generated JSON and renders tests/files/date from it', () => {
    expect(text).toContain("import pressCounts from '@/lib/generated/press-counts.json'");
    expect(text).toContain('pressCounts.tests');
    expect(text).toContain('pressCounts.files');
    expect(text).toContain('pressCounts.date');
  });

  it('contains no hardcoded "N passing (M test files, …)" fact', () => {
    expect(text).not.toMatch(/\d[\d,]* passing \(\d+ test files,/);
    expect(text).not.toContain('2,197 passing');
    expect(text).not.toContain('2,206 passing');
  });

  it('says 167 interface strings, keeping the machine-translated clause', () => {
    expect(text).toContain('167 interface strings translated');
    expect(text).toContain('12 of the 20 are machine-translated');
    expect(text).not.toContain('28 interface strings');
  });

  it('states the refresh honestly: scheduled, but no live refresh today', () => {
    expect(text).toContain('Price refresh schedule');
    expect(text).not.toMatch(/Price refresh schedule', 'Every 6 hours'\]/);
    expect(text).toMatch(/no live refresh happens today/);
    // Source text: the apostrophe is the \u2019 escape in the .tsx
    // string, so match the words around it, not the rendered char.
    expect(text).toContain('re-reads the site');
    expect(text).toContain('fetches no new retailer prices');
  });

  it('qualifies the press coupons as demo / seed data, not live offers', () => {
    expect(text).toContain('SAVE10 and BESTBUY15');
    expect(text).toMatch(/demo \/ seed data — sample offers from the SmartBuy demo catalog, not live merchant offers/);
  });
});

describe('methodology + about — honest refresh wording, 167 strings', () => {
  it('methodology no longer claims prices are refreshed on a six-hour schedule', () => {
    const text = readSource('app/methodology/page.tsx');
    expect(text).not.toContain('Prices are refreshed on a six-hour schedule');
    expect(text).not.toContain('refreshed on a six-hour schedule');
    expect(text).toMatch(/A price refresh is\s*scheduled every six hours, but no live refresh happens today/);
    expect(text).toMatch(/fetches no new retailer prices/);
    // Section 19, Phase 7 (§12 #75): the "last recorded" date is
    // no longer hardcoded — it is read live from the catalog
    // (newest products.data_freshness) at request time, and omitted
    // when the read fails, so no stale date is ever printed.
    expect(text).not.toMatch(/last recorded 2 November 2026/);
    expect(text).toMatch(/latestFreshness/);
    expect(text).toMatch(/data_freshness/);
  });

  it('about says 167 strings and no longer claims a six-hour refresh schedule', () => {
    const text = readSource('app/about/page.tsx');
    expect(text).toContain('167 interface strings are');
    expect(text).not.toContain('28 interface strings');
    expect(text).not.toContain('six-hour refresh schedule');
    // Line-wrapped in the source ("happens\n today").
    expect(text).toMatch(/no live refresh happens\s+today/);
  });

  it('editorial policy says 167 strings', () => {
    const text = readSource('app/editorial-policy/page.tsx');
    expect(text).toContain('167 interface strings are translated');
    expect(text).not.toContain('28 interface strings');
  });
});

describe('press-counts scripts — parser and formatter (fixture output, no suite run)', () => {
  const allPassOutput = [
    ' Test Files  181 passed (181)',
    '      Tests  2206 passed (2206)',
    '   Start at  12:00:00',
    '   Duration  58.00s',
    '',
  ].join('\n');

  const failingOutput = [
    ' Test Files  1 failed | 180 passed (181)',
    '      Tests  1 failed | 2205 passed (2206)',
    '   Start at  12:00:00',
    '   Duration  58.00s',
    '',
  ].join('\n');

  it('parses the all-pass summary', () => {
    expect(parseVitestSummary(allPassOutput)).toEqual({ files: 181, tests: 2206 });
  });

  it('parses the failing-suite summary (failed count is optional in the shape)', () => {
    expect(parseVitestSummary(failingOutput)).toEqual({ files: 180, tests: 2205 });
  });

  it('returns null when the summary lines are absent', () => {
    expect(parseVitestSummary('no summary here\n')).toBeNull();
    expect(parseVitestSummary('')).toBeNull();
  });

  it('formats the ISO date the way the press page renders it', () => {
    expect(formatPressCountsDate('2026-11-12')).toBe('12 November 2026');
    expect(formatPressCountsDate('2026-01-05')).toBe('5 January 2026');
  });

  it('builds the JSON shape the generator writes', () => {
    const data = buildPressCountsJson({ files: 181, tests: 2206 }, '2026-11-12');
    expect(data).toEqual(
      expect.objectContaining({ tests: 2206, files: 181, date: '2026-11-12' }),
    );
    expect(typeof data.generatedBy).toBe('string');
    expect(data.generatedBy).toContain('generate-press-counts');
  });

  it('the generate + check scripts and the CI workflow exist and agree', () => {
    expect(existsSync(join(process.cwd(), 'scripts/generate-press-counts.mjs'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'scripts/check-press-counts.mjs'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'scripts/press-counts-run.mjs'))).toBe(true);
    const check = readSource('scripts/check-press-counts.mjs');
    expect(check).toContain('press-counts-run.mjs');
    expect(check).toContain('lib/generated/press-counts.json');
    const workflow = readSource('.github/workflows/check-press-counts.yml');
    expect(workflow).toContain('npm run check:press-counts');
    const pkg = JSON.parse(readSource('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['check:press-counts']).toBe('node scripts/check-press-counts.mjs');
    expect(pkg.scripts['generate:press-counts']).toBe('node scripts/generate-press-counts.mjs');
  });
});
