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
 * CI wiring: .github/workflows/check-a11y.yml runs `npm run test:a11y`
 * on every PR and push to main. WEB-UI-ONLY — that workflow file can
 * never go through the GitHub push tool (403 on .github/workflows/*);
 * add it via the GitHub website. Until it is added there, this stays
 * a local/pre-push gate: run `npm run test:a11y` before pushing.
 *
 * Section 18, item 61: this config also runs
 * tests/section18-ux-jsdom.test.tsx (component renders +
 * interactions for the UX items — same jsdom environment, same
 * mocks as the a11y suite).
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
    include: ['tests/a11y-runtime.test.tsx', 'tests/section18-ux-jsdom.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
    environment: 'jsdom',
  },
});
