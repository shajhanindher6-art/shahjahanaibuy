/**
 * Application-level configuration constants.
 * Non-secret values that define app behaviour and branding.
 */

export const appConfig = {
  name: 'SmartBuy AI',
  shortName: 'SmartBuy',
  description:
    'Make smarter shopping decisions with AI-powered recommendations, price tracking, and trusted data.',
  url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  locale: 'en-US',
  currency: 'USD',
  timezone: 'UTC',
  supportEmail: 'support@smartbuy.ai',
} as const;

export type AppConfig = typeof appConfig;
