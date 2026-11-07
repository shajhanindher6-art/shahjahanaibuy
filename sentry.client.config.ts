// Sentry client-side init (browser).
//
// Dormant until the owner creates a free Sentry account and sets
// NEXT_PUBLIC_SENTRY_DSN in Vercel: with no DSN, init is skipped and
// nothing is sent anywhere. Once the DSN is set, the error boundary
// (app/error.tsx) and this client init together report real errors.
// tracesSampleRate 0.1 keeps free-tier event volume low.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    debug: false,
  });
}
