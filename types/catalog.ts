/**
 * Enterprise domain types for Phase 2 upgrade.
 * These types mirror the new database tables added in migrations 003-007.
 */

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  decimalPlaces: number;
  active: boolean;
}

export interface Country {
  id: string;
  code: string;
  name: string;
  currencyId: string | null;
  active: boolean;
}

export interface Region {
  id: string;
  countryId: string;
  name: string;
  code: string;
}

export interface Language {
  id: string;
  code: string;
  name: string;
  nativeName: string | null;
  active: boolean;
}

export interface Provider {
  id: string;
  key: string;
  name: string;
  type: string;
  baseUrl: string | null;
  apiKeyEnv: string | null;
  active: boolean;
  rateLimitPerMinute: number;
  priority: number;
}

export interface Brand {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
  countryId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  active: boolean;
  children?: Category[];
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Product extensions
// ---------------------------------------------------------------------------

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  sku: string | null;
  attributes: Record<string, unknown>;
  imageUrl: string | null;
  inStock: boolean;
  sortOrder: number;
  active: boolean;
}

export interface ProductAttribute {
  id: string;
  productId: string;
  key: string;
  value: string;
  unit: string | null;
  group: string | null;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Commerce
// ---------------------------------------------------------------------------

export interface Merchant {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  countryId: string | null;
  currencyId: string | null;
  contactEmail: string | null;
  phone: string | null;
  status: string;
  commissionRate: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantProduct {
  id: string;
  productId: string;
  merchantId: string;
  merchantSku: string | null;
  price: number;
  compareAtPrice: number | null;
  currencyId: string | null;
  availability: string;
  url: string | null;
  shippingCost: number | null;
  shippingDays: number | null;
  inStock: boolean;
  stockQuantity: number | null;
  lastSyncedAt: string | null;
}

export interface DataSource {
  id: string;
  providerId: string;
  merchantId: string | null;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  scheduleCron: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  totalRecordsSynced: number;
  active: boolean;
}

export interface Deal {
  id: string;
  productId: string;
  merchantId: string | null;
  title: string;
  description: string | null;
  dealType: string;
  discountType: string;
  discountValue: number;
  startAt: string;
  endAt: string;
  couponCode: string | null;
  url: string | null;
  active: boolean;
}

export interface Coupon {
  id: string;
  code: string;
  merchantId: string | null;
  description: string | null;
  discountType: string;
  discountValue: number;
  minOrderValue: number | null;
  maxDiscountAmount: number | null;
  usageLimit: number | null;
  usageCount: number;
  perUserLimit: number;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
}

export interface CashbackOffer {
  id: string;
  merchantId: string;
  productId: string | null;
  title: string;
  description: string | null;
  cashbackType: string;
  cashbackValue: number;
  maxCashbackAmount: number | null;
  startAt: string;
  endAt: string;
  termsUrl: string | null;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Reviews & social
// ---------------------------------------------------------------------------

export interface ReviewSource {
  id: string;
  name: string;
  slug: string;
  websiteUrl: string | null;
  logoUrl: string | null;
  trustScore: number;
  active: boolean;
}

export interface Review {
  id: string;
  productId: string;
  reviewSourceId: string | null;
  userId: string | null;
  authorName: string | null;
  rating: number;
  title: string | null;
  content: string | null;
  verifiedPurchase: boolean;
  helpfulCount: number;
  sourceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Wishlist {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WishlistItem {
  id: string;
  wishlistId: string;
  productId: string;
  notes: string | null;
  targetPrice: number | null;
  sortOrder: number;
  addedAt: string;
}

export interface Alert {
  id: string;
  userId: string;
  productId: string;
  alertType: 'price_drop' | 'back_in_stock' | 'deal';
  conditionValue: number | null;
  channel: 'email' | 'push' | 'both';
  active: boolean;
  lastTriggeredAt: string | null;
  triggerCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export interface SyncHistory {
  id: string;
  dataSourceId: string | null;
  providerKey: string;
  syncType: string;
  status: string;
  recordsFetched: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsRejected: number;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ProviderHealth {
  id: string;
  providerKey: string;
  status: 'healthy' | 'degraded' | 'down' | 'circuit_open';
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  circuitOpenedAt: string | null;
  avgResponseMs: number | null;
  updatedAt: string;
}

export interface QueueMetric {
  id: string;
  queueName: string;
  metricType: string;
  waitingCount: number;
  activeCount: number;
  completedCount: number;
  failedCount: number;
  delayedCount: number;
  throughputPerMin: number;
  avgLatencyMs: number | null;
  recordedAt: string;
}

export interface CacheMetric {
  id: string;
  cacheNamespace: string;
  hitCount: number;
  missCount: number;
  evictionCount: number;
  sizeBytes: number | null;
  recordedAt: string;
}
