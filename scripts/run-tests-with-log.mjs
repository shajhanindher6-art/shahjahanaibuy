/**
 * Section 19, Phase 9 (§12 #90) — full-log capture for the vitest gate.
 *
 * Problem: the Section 19 audit baseline run showed 2 failing tests
 * that passed on re-run, and the tail output did not name the file —
 * a flaky gate with no record. `npm run test:ci-log` runs the full
 * suite, tees the COMPLETE output (stdout + stderr, interleaved in
 * arrival order) to `logs/vitest-full.log`, prints the last 40 lines
 * at the end, and exits with vitest's own exit code — non-zero when
 * tests fail, so CI still goes red while the full log survives for
 * the flake hunt.
 *
 * Any extra arguments are forwarded to vitest, e.g.
 *   node scripts/run-tests-with-log.mjs tests/section19-ai-error-handling.test.ts
 *
 * `logs/` is gitignored (see .gitignore) so the capture never
 * pollutes the tree.
 */

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logsDir = join(root, 'logs');
mkdirSync(logsDir, { recursive: true });
const logPath = join(logsDir, 'vitest-full.log');

const vitestArgs = ['vitest', 'run', ...process.argv.slice(2)];
const child = spawn('npx', vitestArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const logStream = createWriteStream(logPath);

child.stdout.on('data', (chunk) => {
  logStream.write(chunk);
  process.stdout.write(chunk);
});
child.stderr.on('data', (chunk) => {
  logStream.write(chunk);
  process.stderr.write(chunk);
});
child.on('error', (err) => {
  logStream.end();
  process.stderr.write(`run-tests-with-log: failed to start vitest: ${String(err)}\n`);
  process.exit(1);
});
child.on('close', (code) => {
  logStream.end(() => {
    const lines = readFileSync(logPath, 'utf8').split('\n');
    // Drop the trailing empty line the final newline produces.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    process.stdout.write(`\n--- tail of logs/vitest-full.log (${lines.length} lines) ---\n`);
    process.stdout.write(`${lines.slice(-40).join('\n')}\n`);
    process.stdout.write(`Full log: logs/vitest-full.log\n`);
    process.exit(code ?? 1);
  });
});
