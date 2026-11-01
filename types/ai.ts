/**
 * Phase 3 AI feature domain types.
 * These types mirror the new database tables added in migration 008.
 */

// ---------------------------------------------------------------------------
// AI Search
// ---------------------------------------------------------------------------

export interface SearchHistoryEntry {
  id: string;
  userId: string;
  query: string;
  filters: SearchFilters | null;
  resultsCount: number;
  createdAt: string;
}

export interface SearchFilters {
  category?: string;
  brand?: string;
  budgetMin?: number;
  budgetMax?: number;
  minRating?: number;
  availability?: string;
}

export interface AISearchResult {
  product: import('./index').Product;
  score: number;
  matchedAttributes: string[];
  aiExplanation: string;
  /**
   * Latest recorded price_history price in USD, or null when no
   * price is recorded. Search cards render this; they must never
   * render a guessed price when it is null.
   */
  currentPrice: number | null;
  /**
   * Merchant/store names listing this product (from
   * merchant_products + merchants). Empty when no listing exists
   * or the query is denied — the store filter simply cannot match
   * such a product, it never invents a store.
   */
  stores: string[];
  /** Average review rating (1–5), or null when there are no reviews. */
  rating: number | null;
  /** Number of reviews behind `rating`. */
  ratingCount: number;
}

/**
 * A shopping result from the external web fallback (SerpAPI Google
 * Shopping), NOT a catalog product. It has no catalog id, slug, Deal
 * Score or price history — the UI must render it as a "Web result"
 * with a retailer link, never as a SmartBuy product page.
 */
export interface WebSearchResult {
  id: string;
  title: string;
  price: number | null;
  currency: string;
  source: string | null;
  link: string;
  thumbnail: string | null;
  rating: number | null;
  reviews: number | null;
}

export interface AISearchResponse {
  results: AISearchResult[];
  parsedIntent: ParsedSearchIntent;
  total: number;
}

export interface ParsedSearchIntent {
  category: string | null;
  /**
   * Budget in USD. This is the value every price comparison uses.
   * When the user wrote a non-USD currency, this is the CONVERTED
   * figure (see services/currency.ts), not the raw number — so
   * "under 20K PKR" is 71 here, not 20000.
   */
  budget: number | null;
  /**
   * Currency the user actually wrote, e.g. 'PKR' for "under 20K
   * PKR". Null when the query carried no budget at all. When the
   * user wrote no currency, this is 'USD' (bare numbers stay USD).
   */
  budgetCurrency: string | null;
  /** Amount exactly as written, before conversion (e.g. 20000). */
  budgetOriginal: number | null;
  brands: string[];
  attributes: Record<string, string>;
  intent: string;
}

// ---------------------------------------------------------------------------
// Product Comparison
// ---------------------------------------------------------------------------

export interface ComparisonProduct {
  productId: string;
  name: string;
  brand: string | null;
  image: string | null;
  retailers: ComparisonRetailer[];
}

export interface ComparisonRetailer {
  retailerName: string;
  price: number;
  originalPrice: number | null;
  discount: number | null;
  rating: number | null;
  reviewCount: number | null;
  shipping: string | null;
  availability: string;
  seller: string | null;
  warranty: string | null;
  url: string | null;
}

export interface ProductComparison {
  id: string;
  products: ComparisonProduct[];
  aiSummary: string;
  bestChoice: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// AI Recommendations
// ---------------------------------------------------------------------------

export interface Recommendation {
  productId: string;
  product: import('./index').Product;
  score: number;
  reason: string;
}

export interface RecommendationContext {
  userId: string;
  basedOn: 'search_history' | 'wishlist' | 'views' | 'preferences' | 'trending';
}

// ---------------------------------------------------------------------------
// Price Prediction
// ---------------------------------------------------------------------------

export interface PricePrediction {
  id: string;
  productId: string;
  predictionType: string;
  discountProbability: number;
  expectedSaleDate: string | null;
  expectedLowestPrice: number | null;
  confidenceScore: number;
  explanation: string;
  priceDataRange: Record<string, unknown> | null;
  createdAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// AI Product Summary
// ---------------------------------------------------------------------------

export interface AISummary {
  id: string;
  productId: string;
  summary: string;
  pros: string[];
  cons: string[];
  alternatives: string[];
  createdAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// AI Review Summary
// ---------------------------------------------------------------------------

export interface ReviewTheme {
  theme: string;
  positiveCount: number;
  negativeCount: number;
}

export interface ReviewAISummary {
  productId: string;
  averageRating: number;
  totalReviews: number;
  verifiedAverageRating: number | null;
  verifiedCount: number;
  summary: string;
  /** Short overall verdict derived from averageRating, e.g. "Recommended". */
  verdict: string;
  positives: string[];
  concerns: string[];
  themes: ReviewTheme[];
  mostHelpful: {
    authorName: string | null;
    rating: number;
    title: string | null;
    content: string | null;
    helpfulCount: number;
  } | null;
}

// ---------------------------------------------------------------------------
// Deal Rankings
// ---------------------------------------------------------------------------

export interface DealRanking {
  id: string;
  dealId: string | null;
  productId: string | null;
  dealType: string;
  aiScore: number;
  discountPercentage: number;
  savingsAmount: number;
  isFeatured: boolean;
  rankedAt: string;
  deal: import('./catalog').Deal | null;
  product: import('./index').Product | null;
}

// ---------------------------------------------------------------------------
// Alert History
// ---------------------------------------------------------------------------

export interface AlertHistoryEntry {
  id: string;
  alertId: string;
  userId: string;
  productId: string;
  triggeredPrice: number;
  targetPrice: number | null;
  notificationChannel: string;
  sentAt: string;
}

// ---------------------------------------------------------------------------
// User Preferences
// ---------------------------------------------------------------------------

export interface UserPreferences {
  id: string;
  userId: string;
  budgetMin: number | null;
  budgetMax: number | null;
  favoriteBrands: string[];
  favoriteCategories: string[];
  preferredRetailers: string[];
  notificationEmail: boolean;
  notificationPush: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface AdminAuditLog {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AdminAnalytics {
  totalUsers: number;
  totalProducts: number;
  totalAlerts: number;
  activeDeals: number;
  totalWishlists: number;
  totalSearches: number;
  topSearched: Array<{ query: string; count: number }>;
  topProducts: Array<{ name: string; views: number }>;
  recentSignups: number;
}
