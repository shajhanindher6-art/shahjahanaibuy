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
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'images.pexels.com' },
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverComponentsExternalPackages: ['resend', 'web-push', 'stripe'],
  },
  async redirects() {
    return [
      {
        // The pricing section lives on the homepage (app/page.tsx
        // section id="pricing"); there is no standalone /pricing
        // route, so a direct visit used to 404. Redirect to the
        // homepage anchor instead. Temporary (not permanent) so a
        // real /pricing page can replace it later without fighting
        // a cached permanent redirect. No in-site link points at
        // /pricing — header and footer already use /#pricing.
        source: '/pricing',
        destination: '/#pricing',
        permanent: false,
      },
    ];
  },
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
