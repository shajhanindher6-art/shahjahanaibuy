export { getProfile, updateProfile, type UpdateProfileInput } from './profiles';
export {
  getUserSettings,
  updateUserSettings,
  type UpdateSettingsInput,
} from './settings';
export { isFeatureEnabled, getAllFeatureFlags } from './feature-flags';
export { createAuditLog, type AuditLogInput } from './audit-logs';

// Phase 2: Product data services
export {
  getProductById,
  getProductBySlug,
  getProducts,
  getCachedProductBySlug,
  getProductImages,
  getProductVariants,
  getProductAttributes,
  getProductTags,
  getCategories,
  getBrands,
  incrementViewCount,
  type ProductListOptions,
  type ProductListResult,
} from './products';
export { getRetailers, getRetailerBySlug } from './retailers';
export {
  getPriceHistory,
  getCachedPriceHistory,
  getLatestPrice,
  type PriceHistoryResult,
} from './price-history';

// Phase 2: Catalog reference data
export {
  getBrandList,
  getBrandBySlug,
  getCategoryTree,
  getCategoryBySlug,
  getTagList,
  getCurrencies,
  getCountries,
  getLanguages,
  getProviders,
} from './catalog';

// Phase 2: Commerce
export {
  getMerchants,
  getMerchantBySlug,
  getMerchantProducts,
  getDeals,
  getCoupons,
  getCashbackOffers,
  type DealListOptions,
  type CouponListOptions,
  type CashbackListOptions,
} from './commerce';

// Phase 2: Reviews
export {
  getReviews,
  getReviewSummary,
  createReview,
  type ReviewListOptions,
  type ReviewListResult,
  type ReviewSummary,
  type CreateReviewInput,
} from './reviews';

// Phase 2: AI review summary
export {
  getReviewAISummary,
  type ReviewAISummary,
  type ReviewTheme,
} from './review-summary';

// Phase 2: Wishlists
export {
  getWishlists,
  createWishlist,
  updateWishlist,
  deleteWishlist,
  getWishlistItems,
  addWishlistItem,
  removeWishlistItem,
  getPublicSharedWishlist,
  type SharedWishlist,
  type SharedWishlistItem,
  type SharedWishlistProduct,
  type CreateWishlistInput,
  type UpdateWishlistInput,
  type AddWishlistItemInput,
} from './wishlists';

// Phase 2: Alerts
export {
  getAlerts,
  createAlert,
  updateAlert,
  deleteAlert,
  type CreateAlertInput,
  type UpdateAlertInput,
} from './alerts';

// Phase 2: Alert checker (cron)
export {
  checkPriceAlerts,
  type AlertCheckResult,
} from './alert-checker';

// Price refresh worker (scheduled: refresh -> check -> Resend email)
export {
  refreshTrackedPrices,
  type PriceRefreshResult,
} from './price-refresh';

// User tracking dashboard (wishlists + prices + alerts, one view)
export {
  getUserTracking,
  type TrackedItem,
  type TrackedAlert,
  type TrackingSummary,
  type TrackingResult,
} from './tracking';

// Phase 2: Provider abstraction
export {
  getProviderRegistry,
  type DataProvider,
  type RawProductData,
  type ProviderSearchRequest,
  type ProviderFetchRequest,
} from './providers';

// Phase 2: Data pipeline
export {
  ingestProduct,
  ingestBatch,
  validateRawProduct,
  normalizeProduct,
  assignCategory,
  detectBrand,
  processImages,
  type IngestionResult,
  type NormalizedProduct,
} from './pipeline';

// Phase 2: Adaptive freshness
export {
  calculateNextRefresh,
  getProductsDueForRefresh,
  markProductQueued,
  markProductProcessing,
  markProductRefreshed,
  markProductRefreshFailed,
  updateProductPriority,
  incrementProductViewCount,
  REFRESH_POLICIES,
  type RefreshPriority,
  type RefreshStatus,
} from './freshness';

// Phase 2: Monitoring
export {
  recordProviderHealth,
  getProviderHealth,
  recordSyncHistory,
  getSyncHistory,
  recordQueueMetrics,
  getQueueMetrics,
  recordCacheMetrics,
  getMonitoringSummary,
  type MonitoringSummary,
} from './monitoring';

// Phase 3: AI search
export {
  aiSearch,
  getCachedAISearch,
  parseSearchIntent,
  recordSearch,
  getSearchHistory,
  deleteSearchHistoryEntry,
  type AISearchOptions,
  type AISearchResults,
} from './ai-search';

// External web search fallback (SerpAPI Google Shopping)
export {
  searchWebProducts,
  type WebSearchOutcome,
} from './external-search';

// Phase 3: AI comparison
export {
  compareProducts,
  getCachedComparison,
} from './ai-comparison';

// Phase 3: AI recommendations
export {
  getRecommendations,
} from './ai-recommendations';

// Phase 3: AI predictions
export {
  predictPriceDrop,
  type PricePredictionResult,
  type PriceTrendPoint,
} from './ai-predictions';

// Phase 3: AI summary
export {
  getAISummary,
} from './ai-summary';

// Phase 3: AI deal rankings
export {
  getRankedDeals,
  getCachedRankedDeals,
  type RankedDealsResult,
} from './ai-deals';

// Smart deal recommendations (deals + trending + user activity widget)
export {
  getSmartDealRecommendations,
  type SmartDeal,
  type SmartDealsResult,
} from './smart-deals';

// Phase 3: User preferences
export {
  getUserPreferences,
  upsertUserPreferences,
  type UpdatePreferencesInput,
} from './user-preferences';

// Phase 3: Alert history
export {
  getAlertHistory,
  recordAlertTrigger,
} from './alert-history';

// Phase 3: Admin
export {
  getAdminAnalytics,
  getAdminAuditLogs,
  recordAdminAction,
  getAllUsers,
} from './admin';

// Phase 4: Chat assistant
export {
  createConversation,
  getConversations,
  getChatMessages,
  saveMessage,
  generateChatResponse,
  type ChatMessage,
  type Conversation,
  type ChatMetadata,
} from './chat';

// Phase 4: Affiliate system
export {
  buildAffiliateUrl,
  getAffiliateLinks,
  trackAffiliateClick,
  getAffiliateAnalytics,
  type AffiliateLink,
} from './affiliate';

// Phase 4: Notifications & analytics
export {
  queueNotification,
  getNotifications,
  markNotificationSent,
  generateWeeklyDigest,
  trackAnalyticsEvent,
  type NotificationItem,
} from './notifications';

// Phase 5: Email, Stripe, Push, Notifications dispatch, Health
export {
  sendEmail,
  sendWelcomeEmail,
  sendSubscriptionEmail,
  sendPriceAlertEmail,
  sendWeeklyDigestEmail,
  sendInvoiceEmail,
  type EmailMessage,
  type EmailResult,
} from './email';

export {
  createCheckoutSession,
  createCustomerPortalSession,
  syncSubscriptionFromStripe,
  processWebhookEvent,
  getBillingHistory,
  isStripeConfigured,
  PLAN_CONFIG,
  type PlanKey,
} from './stripe';

export {
  savePushSubscription,
  removePushSubscription,
  sendPushNotification,
  getVapidPublicKey,
  type PushSubscriptionData,
} from './push';

export {
  processNotificationQueue,
} from './notification-dispatch';

export {
  checkHealth,
  type HealthStatus,
} from './health';
