// Sentry edge-runtime init (middleware / edge routes).
//
// Dormant until a DSN is set — same rule as the server config.
import * as Sentry from '@sentry/nextjs';
import { getSentryRelease, getSentryEnvironment } from '@/lib/sentry-config';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    release: getSentryRelease(),
    environment: getSentryEnvironment(),
    tracesSampleRate: 0.1,
    debug: false,
  });
}
