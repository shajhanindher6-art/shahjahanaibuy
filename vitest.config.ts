import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Unit tests for the pure logic modules (deal math, fake-sale
 * detection, local-first search split, deal rotation). These modules
 * take plain data in and return plain data out — no database, no
 * network — so they run in plain Node with placeholder env vars
 * (see tests/setup.ts, needed because lib/config/env.ts requires
 * NEXT_PUBLIC_SUPABASE_URL at import time).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  // Section 18, item 68: the repo tsconfig sets jsx: preserve (Next.js
  // SWC handles JSX in the app). esbuild would otherwise compile JSX
  // to classic React.createElement calls and any imported component
  // would throw "React is not defined" — force the automatic runtime
  // here, exactly as vitest.a11y.config.ts already does. Needed now
  // that tests/bnpl-line.test.ts imports a .tsx component.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    // Sections 21–25, Stage K (K8) — coverage measurement. There was
    // none: 0 hits in the vitest configs / package.json / workflows.
    // Provider is @vitest/coverage-v8 (free, same major as vitest —
    // devDependency, no paid service). `npm run test:coverage` runs
    // the main suite with coverage; reports land in /coverage
    // (gitignored) as text (console) + json + html. No threshold is
    // enforced yet — the first measured baseline is the point; a
    // threshold that fails the gate belongs to a later decision once
    // the baseline is known, not to this item.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['app/**', 'lib/**', 'services/**', 'features/**', 'components/**'],
      exclude: [
        'tests/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        'app/**/loading.tsx',
        '**/node_modules/**',
      ],
    },
  },
});
