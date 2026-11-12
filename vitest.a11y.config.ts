import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Runtime a11y gate (Section 15, C7) — local/pre-push only.
 *
 * The repo's main vitest config (vitest.config.ts) stays untouched:
 * environment `node`, include `tests/**\/*.test.ts`. This config
 * applies ONLY to tests/a11y-runtime.test.tsx, which needs a real
 * DOM (jsdom) for @testing-library/react + axe-core. Run it with:
 *
 *   npm run test:a11y
 *
 * CI wiring is BLOCKED for the push tool (no .github/workflows
 * changes in this wave), so this is a local/pre-push gate until
 * the workflow owner wires `npm run test:a11y` into CI.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  // The repo tsconfig sets jsx: preserve (Next.js SWC handles JSX
  // in the app). esbuild would otherwise compile JSX to classic
  // React.createElement calls and every component would throw
  // "React is not defined" — force the automatic runtime here.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['tests/a11y-runtime.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
    environment: 'jsdom',
  },
});
