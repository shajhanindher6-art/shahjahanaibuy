/**
 * Application-level configuration constants.
 * Non-secret values that define app behaviour and branding.
 */

export const appConfig = {
  name: 'SmartBuy AI',
  shortName: 'SmartBuy',
  description:
    'Make smarter shopping decisions with AI-powered recommendations, price tracking, and trusted data.',
  // Fallback is the live Netlify domain so sitemap/canonical/OG URLs are
  // correct even if NEXT_PUBLIC_APP_URL is not set in the hosting dashboard.
  // Setting NEXT_PUBLIC_APP_URL in Netlify still overrides this (use it when
  // a custom domain is added later).
  url: process.env.NEXT_PUBLIC_APP_URL || 'https://aismartbuy.netlify.app',
  locale: 'en-US',
  currency: 'USD',
  timezone: 'UTC',
  supportEmail: 'support@smartbuy.ai',
} as const;

export type AppConfig = typeof appConfig;
