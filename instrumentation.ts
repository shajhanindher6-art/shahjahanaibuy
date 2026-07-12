/**
 * Instrumentation hook — runs once on server startup.
 * Initializes crash reporting and monitoring.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const sentryDsn = process.env.SENTRY_DSN;
    if (sentryDsn) {
      try {
        const sentryModule = '@sentry/nextjs';
        const Sentry = await import(/* webpackIgnore: true */ sentryModule);
        Sentry.init({
          dsn: sentryDsn,
          tracesSampleRate: 0.1,
          environment: process.env.NODE_ENV,
        });
      } catch {
        // Sentry not installed — skip
      }
    }
  }
}
