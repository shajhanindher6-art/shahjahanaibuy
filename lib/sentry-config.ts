/**
 * Sentry release + environment — the SINGLE source of truth
 * (Section 18, item 53; audit §1 #73).
 *
 * Before this, no `release` existed anywhere in the Sentry configs
 * and `environment` lived only in `instrumentation.ts` — a second
 * init path with its own values, so the triage doc's "check
 * Releases" step could never work. Every Sentry init in the repo
 * (sentry.client/server/edge.config.ts + instrumentation.ts) now
 * reads release + environment from here, so the values can never
 * drift between runtimes.
 *
 * - Release: the Vercel deployment's git commit SHA
 *   (`VERCEL_GIT_COMMIT_SHA`, set automatically by Vercel on every
 *   deploy). When unset (local dev, non-Vercel builds) the release
 *   is `undefined` — Sentry then leaves the release unset — and
 *   NOTHING is invented: no fake version string is ever made up,
 *   and the init never crashes on a missing SHA.
 * - Environment: `VERCEL_ENV` (`production` | `preview` |
 *   `development`, set by Vercel) wins; otherwise `NODE_ENV`;
 *   otherwise `'development'`. In the browser bundle only
 *   `NEXT_PUBLIC_*` vars are inlined, so `VERCEL_GIT_COMMIT_SHA`
 *   and `VERCEL_ENV` are undefined client-side and the client
 *   config falls back to `NODE_ENV` / `'development'` — the release
 *   is simply unset there, which is honest, not broken.
 *
 * The DSN handling is untouched (item 53 is release/env only):
 * each config file still guards its own `Sentry.init` on the DSN.
 */
export function getSentryRelease(): string | undefined {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  return sha ? sha : undefined;
}

export function getSentryEnvironment(): string {
  return (
    process.env.VERCEL_ENV?.trim() ||
    process.env.NODE_ENV?.trim() ||
    'development'
  );
}
