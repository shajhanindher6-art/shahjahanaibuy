/**
 * Instrumentation hook — runs once on server startup.
 * Initializes crash reporting and monitoring.
 *
 * Sentry release/environment come from the single source of truth
 * (`lib/sentry-config.ts`, Section 18 item 53) — the same helper
 * the sentry.*.config.ts files use, so the values can never drift
 * between init paths. This init is KEPT (not removed as a
 * "duplicate"): the stale .next bundle proves this register() path
 * is the live server init, while sentry.server.config.ts's own init
 * could not be proven bundled — removing this one could silently
 * stop server-side Sentry. The DSN guard is unchanged.
 */

import { getSentryRelease, getSentryEnvironment } from '@/lib/sentry-config';
import { logProviderConfigIssues } from '@/services/provider-config';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const sentryDsn = process.env.SENTRY_DSN;
    if (sentryDsn) {
      try {
        const sentryModule = '@sentry/nextjs';
        const Sentry = await import(/* webpackIgnore: true */ sentryModule);
        Sentry.init({
          dsn: sentryDsn,
          release: getSentryRelease(),
          environment: getSentryEnvironment(),
          tracesSampleRate: 0.1,
        });
      } catch {
        // Sentry not installed — skip
      }
    }
    // Sections 21–25, Stage B (B10) — boot-time provider config
    // validation. The lazy provider-registry build used to be the
    // only caller of logProviderConfigIssues, so a server that
    // never built the registry never surfaced a bad provider
    // config. This runs once at server startup (nodejs runtime
    // only). It NEVER throws and NEVER fails boot: every provider
    // is non-critical, so a bad config is a log line, not a
    // startup error. It NEVER logs a secret: the validator
    // returns issue descriptors (provider key + env var NAME +
    // message) — no config value is ever returned or logged.
    try {
      logProviderConfigIssues();
    } catch {
      // Validation must never fail boot.
    }
  }
}
