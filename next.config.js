/** @type {import('next').NextConfig} */

// Sentry (error monitoring, Round 2 M3). The SDK is wired but dormant
// until the owner creates a free Sentry account and sets the DSN env
// vars in Vercel: with no org/project/auth token, the build plugin
// only injects the (DSN-guarded) config files and skips source-map
// upload with a warning — the build itself is unaffected.
const { withSentryConfig } = require('@sentry/nextjs');

// NOTE: the Content-Security-Policy header is NOT set here. It is
// built per request in middleware.ts (lib/csp.ts) because it carries
// a fresh nonce on every response — a static header cannot do that.
// All other security headers stay here.
const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig = {
  // Section 18, item 76: ESLint used to be skipped at build
  // (`eslint: { ignoreDuringBuilds: true }`) and no workflow ran
  // `npm run lint`, so lint errors shipped silently — including
  // two conditional-hook bugs and 15 stale disable comments for a
  // rule that does not exist in this config. All 18 errors were
  // fixed (2026-11-12) and `npm run lint` now exits 0, so the
  // build runs lint again. 16 warnings remain (10× no-img-element,
  // 6× exhaustive-deps) — warnings do not fail the build.
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'images.pexels.com' },
    ],
  },
  experimental: {
    // Section 16, #46: only lucide-react was covered. Each package
    // below is verified imported in the tree (grep, 12 Nov 2026) —
    // nothing is listed speculatively. Gains are small except
    // recharts (the chart library); the rest are single-import
    // barrel packages where the transform trims unused re-exports.
    // date-fns was checked and is NOT imported anywhere, so it is
    // deliberately absent from this list.
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'react-day-picker',
      'embla-carousel-react',
      'cmdk',
      'sonner',
      'vaul',
    ],
    serverComponentsExternalPackages: ['resend', 'web-push', 'stripe'],
  },
  // Section 12: the old /pricing -> /#pricing temporary redirect was
  // removed here — a real /pricing page now exists, and the redirect
  // would shadow it.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = withSentryConfig(
  nextConfig,
  {
    // All three come from env when the owner wires Sentry; until then
    // they are undefined and the plugin skips upload (warning only).
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: true,
  },
  {
    hideSourceMaps: true,
    disableLogger: true,
  }
);
