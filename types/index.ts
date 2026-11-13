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
  /**
   * Section 20, #6 (migration 055, unapplied): manufacturer
   * model number, recorded verbatim. Optional so rows read
   * before the migration (and every existing Product literal
   * in tests) keep compiling — services/products.ts always
   * sets it, defaulting to null. Null = not recorded, never
   * a guessed value (0/10 live products have one).
   */
  modelNumber?: string | null;
  /**
   * Final 100% — F-P2-03 (legacy, optional): the pipeline's
   * field-presence count (name +15, GTIN +20, …), floored at 50
   * by the DB default. It is NOT a data-completeness or quality
   * score and is NO LONGER emitted by the public products API
   * (services/products.ts mapProduct omits it). Internal readers
   * (pipeline gate, SEO plumbing) may still set it; API
   * consumers must use the 7-dimension data-quality score
   * instead. Absent = not carried, never 50-by-default.
   */
  confidenceScore?: number;
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
  /**
   * FINAL 100% (F-P1-29) — the brief's 5-state price machine
   * (lib/verification/price-state.ts), derived from the same
   * inputs as the verification stamp. Present only when the
   * caller proved a price is recorded (an in-stock merchant
   * listing); absent = unknown, never guessed — a product with
   * no price shown carries no price state. Only LIVE_VERIFIED
   * may be shown with live/current wording.
   */
  priceState?: import('@/lib/verification/price-state').PriceStateResult;
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
  /**
   * FINAL 100% (W3, F-P1-37) — migration 057 provenance, or null
   * when the live table predates 057 (no source was ever recorded
   * for that row — never guessed). `suspicious` is the 057 flag.
   */
  source?: string | null;
  observedAt?: string | null;
  suspicious?: boolean | null;
  /**
   * FINAL 100% (W1, F-P1-15 / F-P1-30) — per-row verification
   * flag and assumed-currency flag. True only when the row was
   * written from a validated provider response (verified), or
   * when its USD was assumed from a NULL currency_id
   * (currencyAssumed). Null when the row predates the columns —
   * the columns need a future migration; see
   * services/price-history-quality.ts.
   */
  verified?: boolean | null;
  currencyAssumed?: boolean | null;
  /** Whole days since this row was recorded (null when unparseable). */
  ageDays?: number | null;
  /** True when this row is older than STALE_PRICE_DAYS. */
  isStale?: boolean;
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
