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
  /**
   * Server-side search filters (Section 14, Chunk 4 — B1). The
   * search page used to apply store / rating / price-band in
   * memory on one fetched page; they are server filters now, so
   * the filtered total and the page agree.
   */
  store?: string;
  priceBand?: 'all' | 'under-100' | '100-500' | '500-plus';
}

export interface AISearchResult {
  product: import('./index').Product;
  score: number;
  matchedAttributes: string[];
  /**
   * Query tokens the product's name/brand/category/description
   * text actually carries (Section 14, Chunk 4 — B1, tokenized
   * search). Text matching only, never a spec claim — the search
   * card shows them as "Matched: …".
   */
  matchedTerms: string[];
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
   * Lower end of a price BAND ("between $500 and $1000"), in USD.
   * Null when the query carries no band — a plain max budget leaves
   * this null. Wired as a hard filter by aiSearch (priced products
   * below it are dropped; unpriced products are kept, same as the
   * max-budget convention).
   */
  budgetMin: number | null;
  /**
   * Currency the user actually wrote, e.g. 'PKR' for "under 20K
   * PKR". Null when the query carried no budget at all. When the
   * user wrote no currency, this is 'USD' (bare numbers stay USD).
   */
  budgetCurrency: string | null;
  /** Amount exactly as written, before conversion (e.g. 20000). */
  budgetOriginal: number | null;
  brands: string[];
  /**
   * Brands the visitor explicitly EXCLUDED ("laptop not Apple",
   * "phone without Samsung"). Applied as a hard filter by aiSearch
   * and removed from `brands` above, so a negated brand is never
   * also a positive match.
   */
  excludedBrands: string[];
  /**
   * Terms the visitor explicitly excluded ("without OLED", "no 5G").
   * Description-keyword terms, applied as a hard filter against
   * name + description + brand + category text.
   */
  excludedTerms: string[];
  attributes: Record<string, string>;
  intent: string;
  /**
   * An "X vs Y" compare query ("MacBook vs Dell XPS"), split into
   * its two sides. Null when the query carries no `vs` / `versus`.
   * aiSearch resolves both sides against the catalog and returns
   * the pair in AISearchResults.compareProducts.
   */
  compareQuery: { first: string; second: string } | null;
}

// ---------------------------------------------------------------------------
// Product Comparison
// ---------------------------------------------------------------------------

export interface ComparisonProduct {
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  category: string | null;
  retailers: ComparisonRetailer[];
  /** Option 16 repairability (all nulls until migration 019 data exists). */
  repairability?: import('@/services/repairability').RepairabilityData | null;
  /** Option 17 hardware endurance (all nulls until migration 020 data exists). */
  endurance?: import('@/services/hardware-endurance').HardwareEnduranceData | null;
  /** Option 18 physical attributes (all nulls until migration 021 data exists). */
  physical?: import('@/services/physical-attributes').PhysicalAttributesData | null;
  /** Option 19 recorded overrides (all nulls until migration 022 data exists). */
  recorded?: import('@/services/recorded-overrides').RecordedOverridesData | null;
  /** Option 20 global readiness (all nulls until migration 023 data exists). */
  globalReadiness?: import('@/services/global-readiness').GlobalReadinessData | null;
  /**
   * Canonical Deal Score (lib/deal-score.ts) from the product's
   * price-drop prediction — the same formula the product page uses.
   * Null when the product has no usable prediction.
   */
  dealScore?: number | null;
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

// ---------------------------------------------------------------------------
// Review Sentiment (Option 4 Part 2 — aspect-based, deterministic)
// ---------------------------------------------------------------------------

export type ReviewSentimentLabel = 'positive' | 'mixed' | 'negative';

export interface ReviewAspectVerdict {
  aspect: string;
  label: string;
  labelUr: string;
  sentiment: ReviewSentimentLabel;
  mentions: number;
  positive: number;
  negative: number;
  strength: number;
}

export interface ReviewSourceLink {
  /** Source name when known (review_sources row), else the link hostname. */
  name: string;
  url: string;
}

export interface ReviewSentiment {
  overall: ReviewSentimentLabel;
  averageRating: number;
  /** Reviews actually used (verified subset when any exist). */
  basisReviews: number;
  totalReviews: number;
  verifiedCount: number;
  /** 'verified' = headline computed from verified reviews only. */
  basis: 'verified' | 'all';
  /** True when the basis is 1-2 reviews: an early impression. */
  lowConfidence: boolean;
  aspects: ReviewAspectVerdict[];
  pros: string[];
  prosUr: string[];
  cons: string[];
  consUr: string[];
  /** Brief contrast sentence (English). Null when no aspect verdict exists. */
  briefSummaryEn: string | null;
  /** Brief contrast sentence (Roman Urdu). Null when no aspect verdict exists. */
  briefSummaryUr: string | null;
  /** Distinct original-review source links (empty when no sources exist). */
  sources: ReviewSourceLink[];
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
    /** Original-review link when the review carries source_url. */
    sourceUrl?: string | null;
  } | null;
  /**
   * Aspect-based sentiment analysis (Option 4 Part 2). Added alongside
   * — never replacing — the existing fields above, so old consumers
   * keep working. Null when the product has no reviews (the whole
   * summary is null in that case anyway).
   */
  sentiment?: ReviewSentiment | null;
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
