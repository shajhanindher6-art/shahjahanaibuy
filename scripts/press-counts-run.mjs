/**
 * Shared vitest-run + summary-parse helper for the press-counts
 * scripts (Section 16, item 7).
 *
 * `scripts/generate-press-counts.mjs` runs the real suite and writes
 * the counts to `lib/generated/press-counts.json`; `scripts/check-
 * press-counts.mjs` re-runs the suite and fails when the committed
 * JSON is stale. Both share this module so the two scripts can never
 * disagree about what "the real run" means.
 *
 * Dependency-free: Node built-ins only (child_process, fs, path).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const pressCountsPath = path.join(repoRoot, 'lib', 'generated', 'press-counts.json');
export const pressPagePath = path.join(repoRoot, 'app', 'press', 'page.tsx');

/**
 * Parse the "Test Files … passed" / "Tests … passed" summary lines
 * out of `vitest run` output. Accepts both the all-pass shape and
 * the shape with failures ("1 failed | 179 passed (180)") so a
 * failing suite reports "did not fully pass" instead of the
 * misleading "could not parse" error. Returns null when the summary
 * lines are absent.
 */
export function parseVitestSummary(output) {
  const filesMatch = output.match(/Test Files\s+(?:[\d,]+\s+failed\s*\|\s*)?([\d,]+)\s+passed/);
  const testsMatch = output.match(/^\s*Tests\s+(?:[\d,]+\s+failed\s*\|\s*)?([\d,]+)\s+passed/m);
  if (!filesMatch || !testsMatch) return null;
  const files = Number(filesMatch[1].replace(/,/g, ''));
  const tests = Number(testsMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(files) || !Number.isFinite(tests) || files <= 0 || tests <= 0) return null;
  return { files, tests };
}

/**
 * Run the full suite and parse its summary. Returns
 * `{ files, tests, vitestStatus }`. vitest exits non-zero when any
 * test fails, but it still prints the summary — the output is kept
 * so the counts can be parsed and reported. Throws when vitest
 * could not run at all or its output has no summary lines.
 */
export function runVitestAndParseCounts() {
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
    // Keep vitest's output: a failing suite still prints its summary.
    vitestStatus = typeof error.status === 'number' ? error.status : 2;
    output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    if (!output.trim()) {
      throw new Error(`could not run vitest (exit ${vitestStatus}): ${error.message}`);
    }
  }
  const counts = parseVitestSummary(output);
  if (!counts) {
    throw new Error(
      'could not parse test counts from vitest output (no "Test Files … passed" / "Tests … passed" summary lines found)',
    );
  }
  return { ...counts, vitestStatus };
}

/** Shape of lib/generated/press-counts.json. */
export function buildPressCountsJson({ files, tests }, date = new Date().toISOString().slice(0, 10)) {
  return {
    tests,
    files,
    date,
    generatedBy:
      'scripts/generate-press-counts.mjs — do not edit by hand; run `npm run generate:press-counts` after the suite changes',
  };
}

/** Read and validate the committed JSON. Throws with a clear message. */
export function readPressCountsJson() {
  let raw;
  try {
    raw = readFileSync(pressCountsPath, 'utf8');
  } catch {
    throw new Error(
      `lib/generated/press-counts.json is missing — run \`npm run generate:press-counts\` to create it`,
    );
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`lib/generated/press-counts.json is not valid JSON: ${error.message}`);
  }
  if (
    !Number.isInteger(data?.tests) ||
    !Number.isInteger(data?.files) ||
    data.tests <= 0 ||
    data.files <= 0 ||
    typeof data?.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
    Number.isNaN(Date.parse(data.date))
  ) {
    throw new Error(
      `lib/generated/press-counts.json is malformed (expected { tests: number, files: number, date: "YYYY-MM-DD" }): ${raw.trim().slice(0, 200)}`,
    );
  }
  return data;
}

/** Write the JSON (creating lib/generated/ when needed). */
export function writePressCountsJson(counts, date) {
  const data = buildPressCountsJson(counts, date);
  mkdirSync(path.dirname(pressCountsPath), { recursive: true });
  writeFileSync(pressCountsPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return data;
}

/** "2026-11-12" -> "12 November 2026", the label the press page renders. */
export function formatPressCountsDate(isoDate) {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${day} ${months[month - 1]} ${year}`;
}
