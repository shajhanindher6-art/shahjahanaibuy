#!/usr/bin/env node
/**
 * Check that the press page's test counts are fresh (Section 16,
 * item 7 — replaces the Section 15 hardcoded-count check).
 *
 * The press page (`app/press/page.tsx`) no longer hardcodes the
 * full-run totals: it renders them from
 * `lib/generated/press-counts.json`, which only
 * `scripts/generate-press-counts.mjs` writes (from a real `vitest
 * run`). Hardcoding drifted twice (1,752 -> 1,754 -> 2,197 ->
 * 2,206), so this script is the lock that stops the third drift:
 *
 *   1. It runs the real suite and parses the summary.
 *   2. It fails when the suite did not fully pass.
 *   3. It fails when the committed JSON does not match the fresh
 *      run — run `npm run generate:press-counts` and commit the
 *      JSON with the change that moved the suite.
 *   4. It fails when the press page stops importing the JSON or
 *      goes back to a hardcoded "N passing (M test files, …)" fact.
 *
 * Wired into CI (.github/workflows/check-press-counts.yml) so the
 * drift can no longer ship unnoticed. `next build` never runs this:
 * the Vercel build just imports the committed JSON.
 *
 * Usage:
 *   node scripts/check-press-counts.mjs
 *   npm run check:press-counts
 *
 * Dependency-free: Node built-ins only (child_process, fs, path);
 * the vitest run + parse lives in ./press-counts-run.mjs, shared
 * with the generator.
 * Exit codes: 0 = JSON fresh and press page renders it; 1 = stale
 * JSON, failing suite, or press page not rendering the JSON; 2 =
 * vitest could not run / output could not be parsed / JSON
 * unreadable.
 */

import { readFileSync } from 'node:fs';
import {
  pressCountsPath,
  pressPagePath,
  readPressCountsJson,
  runVitestAndParseCounts,
} from './press-counts-run.mjs';

function fail(code, message) {
  console.error(`check-press-counts: FAIL — ${message}`);
  process.exit(code);
}

let result;
try {
  result = runVitestAndParseCounts();
} catch (error) {
  fail(2, error.message);
}

const { files, tests, vitestStatus } = result;
console.log(
  `check-press-counts: real run — ${tests.toLocaleString('en-US')} tests passing, ${files} test files (vitest exit ${vitestStatus})`,
);

if (vitestStatus !== 0) {
  fail(
    1,
    `vitest run did not fully pass (exit ${vitestStatus}); counts above may be partial, so the committed JSON cannot be trusted against them`,
  );
}

let committed;
try {
  committed = readPressCountsJson();
} catch (error) {
  fail(2, error.message);
}

console.log(
  `check-press-counts: committed JSON — ${committed.tests.toLocaleString('en-US')} tests, ${committed.files} files, ${committed.date} (${pressCountsPath})`,
);

if (committed.tests !== tests || committed.files !== files) {
  fail(
    1,
    `lib/generated/press-counts.json is stale — it says ${committed.tests.toLocaleString('en-US')} tests / ${committed.files} files, but the fresh run is ${tests.toLocaleString('en-US')} tests / ${files} files. ` +
      `Run \`npm run generate:press-counts\` and commit the regenerated JSON with the change that moved the suite.`,
  );
}

// The press page must render the JSON, never a hardcoded count.
const press = readFileSync(pressPagePath, 'utf8');
if (!press.includes('lib/generated/press-counts.json')) {
  fail(
    1,
    `app/press/page.tsx no longer imports lib/generated/press-counts.json — the counts must be rendered from the generated JSON, never hardcoded`,
  );
}
// A hardcoded fact looks like "2,206 passing (181 test files, …)".
if (/\d[\d,]* passing \(\d+ test files,/.test(press)) {
  fail(
    1,
    `app/press/page.tsx contains a hardcoded "N passing (M test files, …)" fact — render the counts from lib/generated/press-counts.json instead`,
  );
}

console.log('check-press-counts: OK — committed press counts match the real vitest run and the press page renders them from the generated JSON.');
