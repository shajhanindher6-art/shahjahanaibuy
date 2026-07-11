/**
 * Feature flag definitions.
 * Flags are stored in the `feature_flags` database table and can also be
 * overridden at the environment level for critical toggles.
 *
 * Phase 1: only the architecture is in place — flags are read from the
 * database with an env override. No flag controls live behaviour yet.
 */

export type FeatureFlagKey =
  | 'ai_recommendations'
  | 'price_tracking'
  | 'semantic_search'
  | 'budget_advice'
  | 'review_analysis'
  | 'trust_scoring'
  | 'price_prediction'
  | 'google_auth'
  | 'email_verification'
  | 'merchant_portal'
  | 'admin_dashboard'
  | 'internationalization'
  | 'pwa';

export interface FeatureFlag {
  key: FeatureFlagKey;
  description: string;
  enabled: boolean;
}

export const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  ai_recommendations: false,
  price_tracking: false,
  semantic_search: false,
  budget_advice: false,
  review_analysis: false,
  trust_scoring: false,
  price_prediction: false,
  google_auth: true,
  email_verification: false,
  merchant_portal: false,
  admin_dashboard: false,
  internationalization: false,
  pwa: false,
};

export const FEATURE_FLAG_DESCRIPTIONS: Record<FeatureFlagKey, string> = {
  ai_recommendations: 'AI-powered product recommendations',
  price_tracking: 'Real-time price tracking and alerts',
  semantic_search: 'Natural language product search',
  budget_advice: 'AI budget optimization advice',
  review_analysis: 'AI-powered review analysis and summarization',
  trust_scoring: 'Product and seller trust scoring',
  price_prediction: 'AI price trend prediction',
  google_auth: 'Google OAuth sign-in',
  email_verification: 'Require email verification before login',
  merchant_portal: 'Merchant self-service portal',
  admin_dashboard: 'Admin management dashboard',
  internationalization: 'Multi-language and multi-currency support',
  pwa: 'Progressive Web App capabilities',
};
