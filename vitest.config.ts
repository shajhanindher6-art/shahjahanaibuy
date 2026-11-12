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
  },
});
