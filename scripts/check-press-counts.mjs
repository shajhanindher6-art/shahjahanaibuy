#!/usr/bin/env node
/**
 * Check that the press page's hardcoded test counts match a real
 * `vitest run` (Section 15, B5).
 *
 * The press page (`app/press/page.tsx`) hardcodes the full-run totals
 * ("1,752 passing (151 test files, ...)") because the count cannot be
 * derived at build time — and it goes stale every time a test is added
 * (it already drifted 1,752 -> 1,754 once). This script is the lock:
 * it runs the real suite, parses the summary, and fails (exit 1) when
 * the press page does not contain the exact current numbers.
 *
 * Usage:
 *   node scripts/check-press-counts.mjs
 *   npm run check:press-counts
 *
 * Dependency-free: Node built-ins only (child_process, fs, path).
 * Exit codes: 0 = press page matches the real run; 1 = mismatch, or
 * the suite itself did not fully pass; 2 = the script could not run
 * vitest or could not parse its output.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pressPath = path.join(repoRoot, 'app', 'press', 'page.tsx');

function fail(code, message) {
  console.error(`check-press-counts: FAIL — ${message}`);
  process.exit(code);
}

let output;
let vitestStatus = 0;
try {
  output = execFileSync('npx', ['vitest', 'run'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  // vitest exits non-zero when any test fails, but it still prints the
  // summary — keep its output so the counts can be parsed and reported.
  vitestStatus = typeof error.status === 'number' ? error.status : 2;
  output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
  if (!output.trim()) {
    fail(2, `could not run vitest (exit ${vitestStatus}): ${error.message}`);
  }
}

// Vitest default summary lines look like:
//   Test Files  151 passed (151)
//        Tests  1754 passed (1754)
// ...or, when anything fails:
//   Test Files  1 failed | 179 passed (180)
//        Tests  1 failed | 2196 passed (2197)
// The regexes below accept both shapes (the failed count is
// optional) so a failing suite reports "did not fully pass"
// instead of the misleading "could not parse" error.
const filesMatch = output.match(/Test Files\s+(?:[\d,]+\s+failed\s*\|\s*)?([\d,]+)\s+passed/);
const testsMatch = output.match(/^\s*Tests\s+(?:[\d,]+\s+failed\s*\|\s*)?([\d,]+)\s+passed/m);
if (!filesMatch || !testsMatch) {
  fail(2, 'could not parse test counts from vitest output (no "Test Files … passed" / "Tests … passed" summary lines found)');
}

const files = Number(filesMatch[1].replace(/,/g, ''));
const tests = Number(testsMatch[1].replace(/,/g, ''));
if (!Number.isFinite(files) || !Number.isFinite(tests) || files <= 0 || tests <= 0) {
  fail(2, `parsed invalid counts from vitest output (files=${filesMatch[1]}, tests=${testsMatch[1]})`);
}

const press = readFileSync(pressPath, 'utf8');
const testsLabel = `${tests.toLocaleString('en-US')} passing`;
const filesLabel = `${files} test files`;
const missing = [];
if (!press.includes(testsLabel)) missing.push(`"${testsLabel}"`);
if (!press.includes(filesLabel)) missing.push(`"${filesLabel}"`);

console.log(`check-press-counts: real run — ${tests.toLocaleString('en-US')} tests passing, ${files} test files (vitest exit ${vitestStatus})`);

if (vitestStatus !== 0) {
  fail(1, `vitest run did not fully pass (exit ${vitestStatus}); counts above may be partial, so the press page cannot be trusted against them`);
}

if (missing.length > 0) {
  fail(
    1,
    `app/press/page.tsx is stale — it does not contain ${missing.join(' and ')}. ` +
      `Update the "Automated tests passing" fact (and its comment + date) to the real run above, then re-run this check.`,
  );
}

console.log('check-press-counts: OK — app/press/page.tsx matches the real vitest run.');
