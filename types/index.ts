/**
 * Core domain types for SmartBuy AI.
 * These types mirror the database schema and are used across the app.
 */

export type UserRole = 'guest' | 'user' | 'premium' | 'merchant' | 'admin';

export interface Profile {
  id: string;
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  /** Creator storefront (Section 13, item 59): the public slug and
      bio from migration 033. Null = no storefront. */
  creatorSlug?: string | null;
  creatorBio?: string | null;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  createdAt: string;
}

export interface UserSettings {
  id: string;
  userId: string;
  currency: string;
  language: string;
  timezone: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  priceAlerts: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface FeatureFlagRecord {
  id: string;
  key: string;
  enabled: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SystemSetting {
  id: string;
  key: string;
  value: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Product domain types (Phase 2)
// ---------------------------------------------------------------------------

export interface Retailer {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  active: boolean;
  country: string;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  gtin: string | null;
  confidenceScore: number;
  dataFreshness: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Section 17, Stage C items 14–15 (migration 045, unapplied):
   * publish gate + price-verification rollup. Optional so rows
   * read before the migration (and every existing Product
   * literal in tests) keep compiling — services/products.ts
   * always sets them, defaulting to 'published' / 'unverified'.
   */
  status?: import('@/services/price-verification').ProductStatus;
  priceVerificationStatus?: import('@/services/price-verification').PriceVerificationStatus;
  priceVerifiedAt?: string | null;
}

export interface ProductImage {
  id: string;
  productId: string;
  url: string;
  altText: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

export interface PriceHistory {
  id: string;
  productId: string;
  retailerId: string;
  price: number;
  currency: string;
  availability: string;
  url: string | null;
  recordedAt: string;
}

export interface ProductSource {
  id: string;
  productId: string;
  retailerId: string;
  externalId: string;
  providerKey: string;
  lastFetchedAt: string;
  raw: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Phase 3 AI types (re-exported from types/ai.ts)
// ---------------------------------------------------------------------------

export type {
  SearchHistoryEntry,
  SearchFilters,
  AISearchResult,
  AISearchResponse,
  ParsedSearchIntent,
  ComparisonProduct,
  ComparisonRetailer,
  ProductComparison,
  Recommendation,
  RecommendationContext,
  PricePrediction,
  AISummary,
  ReviewAISummary,
  ReviewTheme,
  DealRanking,
  AlertHistoryEntry,
  UserPreferences,
  AdminAuditLog,
  AdminAnalytics,
} from './ai';
