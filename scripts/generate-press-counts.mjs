#!/usr/bin/env node
/**
 * Generate lib/generated/press-counts.json from a real `vitest run`
 * (Section 16, item 7).
 *
 * The press page (`app/press/page.tsx`) renders its test/file counts
 * from this JSON instead of hardcoding them — hardcoding drifted
 * twice (1,752 -> 1,754 -> 2,197 -> 2,206). This script is the only
 * writer of the JSON: run it after the suite changes (a new test
 * file, a new test), commit the JSON, and CI (`npm run
 * check:press-counts`, wired in .github/workflows/check-press-
 * counts.yml) fails until the JSON matches a fresh run.
 *
 * The JSON is committed, so `next build` never runs the suite: the
 * Vercel build just imports the committed file. The suite runs only
 * here and in the check script / CI.
 *
 * Usage:
 *   node scripts/generate-press-counts.mjs
 *   npm run generate:press-counts
 *
 * Exit codes: 0 = JSON written from a fully-passing run; 1 = the
 * suite did not fully pass (counts from a failing run are never
 * written); 2 = vitest could not run or its output could not be
 * parsed.
 */

import { runVitestAndParseCounts, writePressCountsJson } from './press-counts-run.mjs';

function fail(code, message) {
  console.error(`generate-press-counts: FAIL — ${message}`);
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
  `generate-press-counts: real run — ${tests.toLocaleString('en-US')} tests passing, ${files} test files (vitest exit ${vitestStatus})`,
);

if (vitestStatus !== 0) {
  fail(
    1,
    `vitest run did not fully pass (exit ${vitestStatus}); refusing to write counts from a failing run — fix the suite and re-run`,
  );
}

const data = writePressCountsJson({ files, tests });
console.log(
  `generate-press-counts: OK — lib/generated/press-counts.json written (${data.tests.toLocaleString('en-US')} tests, ${data.files} files, ${data.date}). Commit it with the change that moved the suite.`,
);
