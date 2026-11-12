// Sentry server-side init (Node runtime).
//
// Dormant until a DSN is set: SENTRY_DSN (server-only) wins, with
// NEXT_PUBLIC_SENTRY_DSN as fallback. With no DSN, init is skipped
// and nothing is sent anywhere.
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
