'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Star, TrendingDown, TrendingUp, Minus,
  Check, X, GitCompare, Sparkles, BarChart3,
  ThumbsUp, ThumbsDown, Package
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import dynamic from 'next/dynamic';
// P0 fix (2026-11-09 audit): tab-gated sections load on demand
// instead of inflating the first-paint bundle — the PriceHistoryGraph
// alone pulled a 415 KiB recharts chunk onto every product visit.
// Each dynamic import below renders only when its tab opens (or, for
// SimilarProducts, when the visitor reaches the bottom of the page).
const PriceHistoryGraph = dynamic(
  () =>
    import('@/components/products/price-history-graph').then(
      (m) => m.PriceHistoryGraph
    ),
  { loading: () => <LoadingSpinner /> }
);
const BuyVsWait = dynamic(
  () =>
    import('@/components/products/buy-vs-wait').then((m) => m.BuyVsWait),
  { loading: () => <LoadingSpinner /> }
);
const ResalePredictor = dynamic(
  () =>
    import('@/components/products/resale-predictor').then(
      (m) => m.ResalePredictor
    ),
  { loading: () => <LoadingSpinner /> }
);
const PersonaMatcher = dynamic(
  () =>
    import('@/components/products/persona-matcher').then(
      (m) => m.PersonaMatcher
    ),
  { loading: () => <LoadingSpinner /> }
);
const TotalOwnershipCalculator = dynamic(
  () =>
    import('@/components/products/total-ownership-calculator').then(
      (m) => m.TotalOwnershipCalculator
    ),
  { loading: () => <LoadingSpinner /> }
);
// Below-fold calculators (Options 7/9/11): loaded on demand with
// ssr:false so they stay out of the First Load bundle (350 kB
// budget). They render unconditionally in the scroll flow, so plain
// dynamic() would still preload them; ssr:false defers them until
// after hydration, with the same LoadingSpinner fallback the tab
// components use. All seven sit well below the hero/Where-to-Buy.
const TaxEstimator = dynamic(
  () => import('@/components/products/tax-estimator').then((m) => m.TaxEstimator),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const DutyOptimizer = dynamic(
  () => import('@/components/products/duty-optimizer').then((m) => m.DutyOptimizer),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const LandedCostCalculator = dynamic(
  () =>
    import('@/components/products/landed-cost-calculator').then(
      (m) => m.LandedCostCalculator
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const RegionArbitrageTable = dynamic(
  () =>
    import('@/components/products/region-arbitrage-table').then(
      (m) => m.RegionArbitrageTable
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const PriceNegotiator = dynamic(
  () =>
    import('@/components/products/price-negotiator').then((m) => m.PriceNegotiator),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const ReturnWarrantyMatrix = dynamic(
  () =>
    import('@/components/products/return-warranty-matrix').then(
      (m) => m.ReturnWarrantyMatrix
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const DurabilityPredictor = dynamic(
  () =>
    import('@/components/products/durability-predictor').then(
      (m) => m.DurabilityPredictor
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const ReviewAuthenticity = dynamic(
  () =>
    import('@/components/products/review-authenticity').then(
      (m) => m.ReviewAuthenticity
    ),
  { loading: () => <LoadingSpinner /> }
);
// Eco footprint module (Option 8): below-fold section, loaded on
// demand with ssr:false for the same First Load reason as the
// calculators above (350 kB budget).
const EcoFootprint = dynamic(
  () => import('@/components/products/eco-footprint').then((m) => m.EcoFootprint),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
// Section 8: local-first + international store split — below-fold,
// loaded on demand with ssr:false so it stays out of the First Load
// bundle (350 kB budget). Client component, so .then() on the
// dynamic import is fine here (the crash rule bans it only in
// Server Components).
const StoreSplitSection = dynamic(
  () => import('@/components/products/store-split-section').then((m) => m.StoreSplitSection),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
// Section 10 Chunk 3: below-fold trust/pool sections — dynamic with
// ssr:false so they stay out of the First Load bundle (350 kB
// budget), same pattern as the calculators above. Client component,
// so .then() on the dynamic import is fine here (the crash rule
// bans it only in Server Components).
const TrustCheckSection = dynamic(
  () =>
    import('@/components/products/trust-check-section').then(
      (m) => m.TrustCheckSection
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const FakeNessChecker = dynamic(
  () =>
    import('@/components/products/fake-ness-checker').then(
      (m) => m.FakeNessChecker
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const SmartPool = dynamic(
  () => import('@/components/pools/smart-pool').then((m) => m.SmartPool),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const UpcyclingBlueprints = dynamic(
  () =>
    import('@/components/products/upcycling-blueprints').then(
      (m) => m.UpcyclingBlueprints
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const DropWindowSimulator = dynamic(
  () =>
    import('@/components/products/drop-window-simulator').then(
      (m) => m.DropWindowSimulator
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const FluffDetector = dynamic(
  () =>
    import('@/components/products/fluff-detector').then((m) => m.FluffDetector),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const CompatibilityMatrix = dynamic(
  () =>
    import('@/components/products/compatibility-matrix').then(
      (m) => m.CompatibilityMatrix
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const ProductVisualizer = dynamic(
  () =>
    import('@/components/products/product-visualizer').then(
      (m) => m.ProductVisualizer
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
import { DealScoreBadge } from '@/components/products/deal-score-badge';
import { TransparencyBlock } from '@/components/ai/transparency-block';
// Section 13, Chunk C: hero 30-day trend chip — the wrapper is
// small (recharts loads lazily inside it), so a static import is
// fine; it renders nothing with <2 recorded points.
import { PriceTrendSparkline } from '@/components/products/price-trend-sparkline';
// Sections 21–25, Stage H (H-P2-3) — the 7-dimension data-quality
// score from GET /api/v1/products/[slug], shown in the Specs tab
// instead of the old field-presence "confidence" percentage.
import {
  DATA_QUALITY_SCORE_LABEL,
  type ProductQualityScore,
} from '@/services/product-quality-score';
import { BestTimeToBuyIndicator } from '@/components/products/best-time-to-buy';
import { BuyingOpportunityBadge } from '@/components/products/buying-opportunity-badge';
import { BuyingConsiderations } from '@/components/products/buying-considerations';
import { PricePredictionBadge } from '@/components/products/price-prediction-badge';
// Section 14, chunk 5: product gallery — static import, small
// (no chart library); renders the single product image when no
// product_images rows are recorded.
import { ProductGallery, type GalleryImage } from '@/components/products/product-gallery';
// Option 16: Next-Gen Decision Suite — deterministic analytics only.
const RegretRiskBadge = dynamic(
  () =>
    import('@/components/analytics/RegretRiskBadge').then(
      (m) => m.RegretRiskBadge
    ),
  { loading: () => <LoadingSpinner /> }
);
const CostPerHourCard = dynamic(
  () =>
    import('@/components/analytics/CostPerHourCard').then(
      (m) => m.CostPerHourCard
    ),
  { loading: () => <LoadingSpinner /> }
);
const RepairabilityMatrix = dynamic(
  () =>
    import('@/components/analytics/RepairabilityMatrix').then(
      (m) => m.RepairabilityMatrix
    ),
  { loading: () => <LoadingSpinner /> }
);
const SpecTradeoffTable = dynamic(
  () =>
    import('@/components/analytics/SpecTradeoffTable').then(
      (m) => m.SpecTradeoffTable
    ),
  { loading: () => <LoadingSpinner /> }
);
import { specTierFromAttributes } from '@/lib/analytics/specTradeoffs';
import { lifespanForCategory } from '@/services/durability';
import type { RepairabilityData } from '@/services/repairability';
// Option 17: Hardware Endurance, Sustainability & Modularity.
const EnduranceCard = dynamic(
  () =>
    import('@/components/products/endurance-card').then(
      (m) => m.EnduranceCard
    ),
  { loading: () => <LoadingSpinner /> }
);
const SustainabilityCard = dynamic(
  () =>
    import('@/components/products/sustainability-card').then(
      (m) => m.SustainabilityCard
    ),
  { loading: () => <LoadingSpinner /> }
);
const ModularityMatrix = dynamic(
  () =>
    import('@/components/products/modularity-matrix').then(
      (m) => m.ModularityMatrix
    ),
  { loading: () => <LoadingSpinner /> }
);
import type { HardwareEnduranceData } from '@/services/hardware-endurance';
// Option 18: Anti-Trap checks — 90-day lowest + fake-deal, weight & power.
const FakeDeal90Card = dynamic(
  () =>
    import('@/components/products/fake-deal-90-card').then(
      (m) => m.FakeDeal90Card
    ),
  { loading: () => <LoadingSpinner /> }
);
const WeightPowerCard = dynamic(
  () =>
    import('@/components/products/weight-power-card').then(
      (m) => m.WeightPowerCard
    ),
  { loading: () => <LoadingSpinner /> }
);
import type { PhysicalAttributesData } from '@/services/physical-attributes';
// Option 19: recorded overrides for resale & TCO (fail-safe, all nulls
// until migration 022 data exists).
import type { RecordedOverridesData } from '@/services/recorded-overrides';
// Section 6: dimensions / model URL / authenticity / supply chain
// (fail-safe, all nulls until migration 033 data exists).
import type {
  ProductDimensionsData,
  ProductAuthenticityData,
  ProductSupplyChainData,
} from '@/services/product-dimensions';
// Option 20: global readiness (fail-safe, all nulls until migration
// 023 data exists).
const GlobalReadinessCard = dynamic(
  () =>
    import('@/components/products/global-readiness-card').then(
      (m) => m.GlobalReadinessCard
    ),
  { loading: () => <LoadingSpinner /> }
);
import type { GlobalReadinessData } from '@/services/global-readiness';
const SimilarProducts = dynamic(
  () =>
    import('@/components/products/similar-products').then(
      (m) => m.SimilarProducts
    ),
  { loading: () => <LoadingSpinner /> }
);
// Section 13, Chunk C: recently-viewed strip (the same component
// the homepage mounts — no props, reads the device-local history
// this page records) and the budget-alternative card (existed
// unwired). Both sit below the fold, so dynamic + ssr:false keeps
// them out of the First Load bundle, same pattern as the
// calculators above.
const RecentlyViewedStrip = dynamic(
  () =>
    import('@/components/home/recently-viewed-strip').then(
      (m) => m.RecentlyViewedStrip
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const BudgetAlternative = dynamic(
  () =>
    import('@/components/products/budget-alternative').then(
      (m) => m.BudgetAlternative
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const CashbackCouponsSection = dynamic(
  () =>
    import('@/components/products/cashback-coupons-section').then(
      (m) => m.CashbackCouponsSection
    ),
  { loading: () => <LoadingSpinner /> }
);
// Section 14, Chunk 2 (B12): "Complete your setup" affinity picks —
// below-fold, dynamic with ssr:false so it stays out of the First
// Load bundle, same pattern as the calculators above. Client
// component, so .then() on the dynamic import is fine here.
const SetupAffinitySection = dynamic(
  () =>
    import('@/components/products/setup-affinity-section').then(
      (m) => m.SetupAffinitySection
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
// Section 10 Chunk 3: hero action buttons — dynamic (SSR kept, no
// ssr:false: they are first-paint content) so their chunks split out
// of the First Load bundle, same pattern as the tab components above.
const PriceAlertDialog = dynamic(
  () =>
    import('@/components/products/price-alert-dialog').then(
      (m) => m.PriceAlertDialog
    ),
  { loading: () => <LoadingSpinner /> }
);
const WishlistButton = dynamic(
  () =>
    import('@/components/products/wishlist-button').then(
      (m) => m.WishlistButton
    ),
  { loading: () => <LoadingSpinner /> }
);
const ShareButtons = dynamic(
  () =>
    import('@/components/products/share-buttons').then(
      (m) => m.ShareButtons
    ),
  { loading: () => <LoadingSpinner /> }
);
// Section 12, Chunk E: push opt-in prompt — dynamic with ssr:false
// (it sits below the hero actions and only renders after hydration,
// so it stays out of the First Load bundle). Dismissible and
// honest: when VAPID keys are not configured it says so instead of
// pretending push works.
const PushOptInPrompt = dynamic(
  () =>
    import('@/components/home/push-opt-in-prompt').then(
      (m) => m.PushOptInPrompt
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const AIReviewSummarizer = dynamic(
  () =>
    import('@/components/products/ai-review-summarizer').then(
      (m) => m.AIReviewSummarizer
    ),
  { loading: () => <LoadingSpinner /> }
);
const ReviewForm = dynamic(
  () =>
    import('@/components/products/review-form').then((m) => m.ReviewForm),
  { loading: () => <LoadingSpinner /> }
);
import type { ReviewAISummary } from '@/types/ai';
import { cn } from '@/lib/utils';
import { Price } from '@/components/region/price';
import { useRegion } from '@/components/region/region-provider';
import { localizeAmazonUrl } from '@/lib/region';
import { getStoresForCountry } from '@/lib/stores';
import { trackAffiliateClick } from '@/lib/affiliate-beacon';
import { getRegionByCountry } from '@/lib/region';
import { tFor } from '@/lib/i18n';
import type { ProductInitialData } from '@/lib/product-seo';
// Section 10 Chunk 3: header/footer — dynamic so their chunks split
// out of the First Load bundle. SiteHeader is first-paint, so it
// keeps SSR (no ssr:false); SiteFooter sits at the very bottom of
// the page, so ssr:false defers it until after hydration.
const SiteHeader = dynamic(
  () =>
    import('@/components/layout/site-header').then((m) => m.SiteHeader),
  { loading: () => <LoadingSpinner /> }
);
const SiteFooter = dynamic(
  () =>
    import('@/components/layout/site-footer').then((m) => m.SiteFooter),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
import {
  bestCoupon,
  couponValueLabel,
  discountPercent,
  discountPercentLabel,
  COUPON_CHECKOUT_UNVERIFIED_LABEL,
  type DealCoupon,
} from '@/lib/deal-math';
import { useAuth } from '@/features/auth/auth-provider';
// Wave-2 wiring (combined batch): canonical Deal Score, forecast,
// Q&A, carbon label, translations, payment handoff, merchant trust,
// agent memory — components/libs already exist, mounted here.
import { dealScoreForDisplay } from '@/lib/deal-score';
import { resolveCarbonLabel } from '@/lib/sustainability';
// Wave-2 components load on demand (same P0 pattern as the tab
// components above): the forecast card lives in the Prediction tab,
// the Q&A section sits below the tabs, and the carbon label is in
// the lower eco section — none of them is first-paint content, so
// they stay out of the First Load bundle (350 kB budget).
const ForecastCard = dynamic(
  () =>
    import('@/components/forecast/forecast-card').then(
      (m) => m.ForecastCard
    ),
  { loading: () => <LoadingSpinner /> }
);
const QaSection = dynamic(
  () => import('@/components/products/qa-section').then((m) => m.QaSection),
  { loading: () => <LoadingSpinner /> }
);
const CarbonLabelCard = dynamic(
  () =>
    import('@/components/sustainability/carbon-label').then(
      (m) => m.CarbonLabelCard
    ),
  { loading: () => <LoadingSpinner /> }
);
// Section 6: lazy-loaded Next-Gen blocks — ssr:false so they stay
// out of the product page's First Load JS (350 kB budget), same
// pattern as the calculators above. They sit below the hero /
// Where-to-Buy and render with the LoadingSpinner fallback.
const BnplLine = dynamic(
  () => import('@/components/products/bnpl-line').then((m) => m.BnplLine),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const AuthenticityBlock = dynamic(
  () => import('@/components/products/authenticity-block').then((m) => m.AuthenticityBlock),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const SupplyChainBlock = dynamic(
  () => import('@/components/products/supply-chain-block').then((m) => m.SupplyChainBlock),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const WarrantyPlansTable = dynamic(
  () => import('@/components/products/warranty-plans-table').then((m) => m.WarrantyPlansTable),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
const BuyListButton = dynamic(
  () => import('@/components/products/buy-list-button').then((m) => m.BuyListButton),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
import type { WarrantyPlan } from '@/lib/warranty-plans';
import {
  translationSourceLabel,
  type ProductTranslation,
} from '@/lib/product-translations';
import { estimateLandedCostForCheckout } from '@/lib/local-payments';
// Section 10 Chunk 3: per-merchant trust card — dynamic with
// ssr:false (it renders in the below-hero Where-to-Buy rows, gated
// on merchantTrustLoaded) so it stays out of the First Load bundle.
const TrustScoreCard = dynamic(
  () =>
    import('@/components/merchant/trust-score-card').then(
      (m) => m.TrustScoreCard
    ),
  { ssr: false, loading: () => <LoadingSpinner /> }
);
import { VerifiedMerchantBadge } from '@/components/merchant/verified-badge';
import { AccuracyFlag } from '@/components/merchant/accuracy-flag';
import {
  computeTrustGrade,
  type TrustGradeResult,
} from '@/lib/merchant-trust';
import {
  accuracyScore,
  ACCURACY_MIN_SAMPLES_FOR_CAUTION,
  type AccuracyCheck,
} from '@/lib/price-accuracy';
import {
  loadGuestMemory,
  saveGuestMemory,
  mergeSeenProducts,
} from '@/lib/agent-memory';
// Section 11, Chunk C: guest recently-viewed history (device-local
// only). The signed-in path is separate — POST /api/v1/product-views
// in fetchAll below — and is untouched.
import { recordRecentlyViewed } from '@/lib/recently-viewed';
// Enterprise #9 Verified Buyer (receipt-backed) + #11 Deal Urgency.
import {
  fetchOwnVaultProductIds,
  isOwnVerifiedReview,
} from '@/services/verified-buyer';
import { VerifiedBuyerBadge } from '@/components/products/verified-buyer-badge';
import { getDealUrgency } from '@/services/deal-urgency';
import { DealUrgencyBadge } from '@/components/products/deal-urgency-badge';
// Seeded product_attributes rows (EAV specs) — rendered in the Specs
// tab via the pure helpers in lib/product-attributes.ts.
import type { ProductAttribute, ProductVariant } from '@/types/catalog';
import {
  groupAttributes,
  formatAttributeValue,
} from '@/lib/product-attributes';
// Option 14-A: "Prices last checked" — derived only from the recorded
// price_history points the page already warms below. Pure helpers in
// lib/price-freshness.ts; no scraping, no new endpoint, no scheduler.
import { latestRecordedAt, formatLastChecked } from '@/lib/price-freshness';

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  gtin: string | null;
  confidenceScore: number;
  // Section 20, #6: manufacturer model number from GET
  // /api/v1/products/[slug] (migration 055, unapplied — null
  // until the column exists or a value is recorded; the Specs
  // tab hides the row when null).
  modelNumber?: string | null;
  // Section 20, #8: product variants from the same endpoint.
  // Absent or empty when the product has no variants — the
  // selector renders only when this is non-empty.
  variants?: ProductVariant[];
  // Sections 21–25, Stage H (H-P2-3): the 7-dimension
  // data-quality score computed server-side by the same
  // endpoint. Absent on responses fetched before this shipped
  // (and on the SEO initial product) — the Specs tab then hides
  // the row instead of showing the old completeness percentage.
  dataQuality?: (ProductQualityScore & { merchantSourceMissing?: boolean }) | null;
  // Seeded product_attributes rows from GET /api/v1/products/[slug].
  // Absent or empty when the product has no seeded specs — the Specs
  // tab then renders exactly the base rows below, nothing invented.
  attributes?: ProductAttribute[];
  // Section 14, chunk 5: recorded product_images rows from the same
  // endpoint. Absent or empty when none are recorded — the gallery
  // then renders exactly the single product image, nothing invented.
  images?: GalleryImage[];
  // Option 16: repairability from the same endpoint (all nulls until
  // migration 019 data exists — the matrix shows an honest empty state).
  repairability?: RepairabilityData | null;
  // Option 17: hardware endurance from the same endpoint (all nulls
  // until migration 020 data exists — honest empty states).
  endurance?: HardwareEnduranceData | null;
  // Option 18: physical attributes from the same endpoint (all nulls
  // until migration 021 data exists — honest empty states).
  physical?: PhysicalAttributesData | null;
  // Option 19: recorded overrides from the same endpoint (all nulls
  // until migration 022 data exists — engines run derived as before).
  recorded?: RecordedOverridesData | null;
  // Option 20: global readiness from the same endpoint (all nulls
  // until migration 023 data exists — honest empty states).
  globalReadiness?: GlobalReadinessData | null;
  // Section 6: dimensions / model URL / authenticity / supply chain
  // from the same endpoint (all nulls until migration 033 data
  // exists — the visualizer shows honest empty states).
  dimensions?: ProductDimensionsData | null;
  modelUrl?: string | null;
  authenticity?: ProductAuthenticityData | null;
  supplyChain?: ProductSupplyChainData | null;
}

interface AISummary {
  summary: string;
  pros: string[];
  cons: string[];
  alternatives: string[];
  /** Real generation time (Section 19, Phase 2 §12 #16 stamp). */
  createdAt?: string;
  /** Real price-as-of date — the product's dataFreshness, never fabricated. */
  priceAsOf?: string | null;
  /** Freshness qualifier for the verdict text, or null while the price is fresh. */
  freshnessNote?: string | null;
}

interface Prediction {
  discountProbability: number;
  expectedSaleDate: string | null;
  expectedLowestPrice: number | null;
  confidenceScore: number;
  explanation: string;
  currentPrice: number | null;
  averagePrice: number | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  /**
   * Price-history points behind this prediction, from the
   * predictions API (Section 15, B1). The Deal Score badge is
   * hidden while this is below DEAL_SCORE_MIN_DATA_POINTS (5)
   * — the live catalog's 4 points per product all score a
   * meaningless 100/100. Absent on predictions fetched before
   * B1, which the gate treats as "not enough data".
   */
  dataPoints?: number | null;
  price30Day: Array<{ date: string; price: number }>;
  price90Day: Array<{ date: string; price: number }>;
  price1Year: Array<{ date: string; price: number }>;
}

interface Review {
  id: string;
  // Author user id (returned by the reviews API). Used ONLY to tell
  // whether a review is the signed-in viewer's own, for the
  // receipt-backed Verified Buyer badge — never displayed.
  userId: string | null;
  rating: number;
  title: string | null;
  content: string | null;
  authorName: string | null;
  verifiedPurchase: boolean;
  helpfulCount: number;
  createdAt: string;
}

interface MerchantListing {
  id: string;
  merchantId: string;
  merchantName: string | null;
  price: number;
  compareAtPrice: number | null;
  availability: string;
  url: string | null;
  shippingCost: number | null;
  shippingDays: number | null;
  inStock: boolean;
  stockQuantity: number | null;
  // Section 13, Chunk C: per-merchant last sync, from the
  // merchants API (merchant_products.last_synced_at) — drives
  // the "Last checked" column of the comparison table. Null
  // when never synced; the table then shows "—".
  lastSyncedAt: string | null;
}

export default function ProductDetailClient({
  slug,
  initialProduct,
}: {
  slug: string;
  /** Product row the server page already fetched for metadata — the
      hero (h1, description, image) renders on first paint instead of
      behind a full-page spinner. Null only when the server could not
      fetch it (then the client fetch below is the only source). */
  initialProduct: ProductInitialData | null;
}) {
  const router = useRouter();
  const { region, language, detectedCountryCode, source: regionSource } = useRegion();
  const { user, isLoading: authLoading } = useAuth();

  // fetchAll below still refreshes the full data on mount (attributes,
  // prices, prediction, merchants, coupons) — this is only the
  // first-paint seed, never the final word.
  const [product, setProduct] = useState<Product | null>(
    initialProduct ?? null
  );
  const [summary, setSummary] = useState<AISummary | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  // Review-photo URLs, keyed by review id (GET reviews returns
  // { reviews, summary, photos }). {} when the table/bucket is
  // missing — reviews still render, just without photos.
  const [reviewPhotos, setReviewPhotos] = useState<Record<string, string[]>>({});
  // Enterprise #9: product ids the signed-in viewer holds a vault
  // receipt for. Empty when logged out or when the vault is not
  // live — the Verified Buyer badge simply never renders then.
  const [ownVaultProductIds, setOwnVaultProductIds] = useState<Set<string>>(new Set());
  // Reviews API returns { averageRating, totalReviews, ratingDistribution }.
  // Normalise here (accepting the old shape too) so a shape change can never
  // crash the page with an undefined .toFixed() call.
  const [reviewSummary, setReviewSummary] = useState<{ averageRating: number; totalReviews: number; ratingDistribution: Record<number, number> } | null>(null);
  // AI review summary (short summary, pros, cons, overall verdict).
  // Null when there are no reviews — the card is then hidden and the
  // existing "No reviews yet" empty state shows instead.
  const [aiReviewSummary, setAiReviewSummary] = useState<ReviewAISummary | null>(null);
  // Merchant listings ("Where to Buy") — fetched from the existing
  // /merchants API, which the product page previously never called,
  // which is why the audit found no merchant, stock or buy link.
  const [merchants, setMerchants] = useState<MerchantListing[]>([]);
  // Section 20, #8: product variants, from GET /api/v1/products/[slug]
  // (which now returns `variants` alongside images + attributes).
  // [] is the honest state for every live product today (0 variant
  // rows) — the selector below renders ONLY when this is non-empty.
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  // Id of the variant the visitor picked. Null = none picked yet
  // (defaults to the first variant once variants load).
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  // Phase 3 Prep: true only when the merchants endpoint reports an
  // affiliate path configured (server env). Drives the disclosure
  // note only — no tag values ever reach the client as config.
  const [affiliateEnabled, setAffiliateEnabled] = useState(false);
  const [merchantsLoaded, setMerchantsLoaded] = useState(false);
  // Distinct from an empty list: true only when the merchants fetch itself
  // failed, so the stores section can say its priced-merchant filter could
  // not be applied instead of silently showing an unfiltered list.
  const [merchantsFailed, setMerchantsFailed] = useState(false);
  // Option 14-A: latest recorded_at across the price history (set
  // from the warm-up fetch below). Null until that fetch resolves,
  // and null forever when the product has no price history — the
  // line in "Where to Buy" then renders nothing (no invented date).
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  // Section 13, Chunk C: the visitor's own stated max budget
  // (agent memory preferences — opt-in, never inferred). Null
  // when no budget was ever stated; the BudgetAlternative slot
  // below then stays empty. Populated by the agent-memory effect
  // further down (guest device-local memory, or the signed-in
  // memory row).
  const [budgetUsd, setBudgetUsd] = useState<number | null>(null);
  // Section 6, Item 12: admin-recorded warranty/insurance plans for
  // this product's category (GET /api/v1/warranty-plans?category=).
  // Empty until an admin records a plan — the table renders its
  // honest empty state, never a guessed plan.
  const [warrantyPlans, setWarrantyPlans] = useState<WarrantyPlan[]>([]);
  const lastCheckedLabel = useMemo(() => formatLastChecked(lastCheckedAt), [lastCheckedAt]);
  // Section 6, Item 9: resolve the LocalStore for a merchant name so
  // the BNPL line can show only VERIFIED instalment options. No
  // match → null → the line says BNPL is not verified for the store.
  const findBnplStore = (merchantName: string | null) => {
    if (!merchantName) return null;
    const key = merchantName.trim().toLowerCase();
    const { stores } = getStoresForCountry(detectedCountryCode ?? region.code);
    return stores.find((s) => s.name.toLowerCase() === key || s.slug.toLowerCase() === key) ?? null;
  };
  // Best currently-valid coupon per merchant id, so each "Where to
  // Buy" row can show its retailer's code with a copy button. Coupons
  // are merchant-level (not product-level). Selection is deterministic
  // (lib/deal-math bestCoupon): expired, not-yet-valid, inactive, and
  // usage-exhausted coupons are never surfaced — the old code kept
  // whichever coupon the API listed first, which could be an expired
  // one, since the API filters only the active flag.
  const [couponsByMerchant, setCouponsByMerchant] = useState<Record<string, DealCoupon>>({});
  const [copiedCoupon, setCopiedCoupon] = useState<string | null>(null);
  // Translated description for the current UI language (GET
  // /api/v1/translations?productId&language&field=description).
  // English is the source language — no translation is fetched for
  // it. 'not-translated' is the normal honest state (the table
  // starts empty); 'failed' renders nothing rather than a false
  // "not translated" claim.
  const [translation, setTranslation] = useState<ProductTranslation | null>(null);
  const [translationState, setTranslationState] = useState<
    'idle' | 'loading' | 'translated' | 'not-translated' | 'failed'
  >('idle');
  // Per-merchant trust data for the Where-to-Buy rows: trust grade
  // + price-accuracy check (fetched by merchant slug via the
  // merchants list) + verified-merchant status. Any fetch failure
  // falls back to the honest empty states (all-null policy →
  // "Not enough data", zero samples → "No audits yet") — never a
  // guessed grade or score.
  const [merchantTrust, setMerchantTrust] = useState<
    Record<
      string,
      {
        trust: TrustGradeResult;
        accuracy: AccuracyCheck;
        verified: boolean;
        verifiedUntil: string | null;
      }
    >
  >({});
  const [merchantTrustLoaded, setMerchantTrustLoaded] = useState(false);
  const [loading, setLoading] = useState(!initialProduct);
  const [activeTab, setActiveTab] = useState('overview');

  // Fetch with a timeout so one slow/hanging API can never keep the whole
  // page on a spinner forever (observed live: 95+ seconds of spinner).
  const fetchTimed = useCallback(async (url: string, ms = 15000) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
      return res;
    } catch {
      return null;
    }
  }, []);

  // Enterprise #9: load the viewer's own vault receipts (owner-scoped
  // GET /api/v1/vault) once signed in and the product is known.
  // Fire-and-forget: the helper never throws, and an empty set just
  // means no Verified Buyer badge renders.
  useEffect(() => {
    if (!user?.id || !product?.id) return;
    let cancelled = false;
    void fetchOwnVaultProductIds().then((result) => {
      if (!cancelled) setOwnVaultProductIds(result.productIds);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, product?.id]);

  // Translated description for the current UI language. English is
  // the source language, so nothing is fetched for it. The API
  // returns { translation: null, status: 'not-translated' } when no
  // admin-verified translation is recorded — the honest state, never
  // a machine translation presented as real.
  useEffect(() => {
    const productId = product?.id;
    if (!productId || language === 'en') {
      setTranslation(null);
      setTranslationState('idle');
      return;
    }
    let cancelled = false;
    setTranslationState('loading');
    void (async () => {
      try {
        const res = await fetchTimed(
          `/api/v1/translations?productId=${encodeURIComponent(productId)}&language=${encodeURIComponent(language)}&field=description`,
          15000
        );
        if (!res || !res.ok) {
          if (!cancelled) setTranslationState('failed');
          return;
        }
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (json?.success && json.data?.translation) {
          setTranslation(json.data.translation as ProductTranslation);
          setTranslationState('translated');
        } else {
          setTranslation(null);
          setTranslationState('not-translated');
        }
      } catch {
        if (!cancelled) setTranslationState('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product?.id, language, fetchTimed]);

  // Agent memory: record this product as seen — ONLY when memory is
  // already on. Signed-in: the memory row must already exist with
  // consent granted (GET first; a PUT with consent:true would create
  // a row for someone who never opted in). Guest: the device-only
  // localStorage memory must already carry consent — the API is
  // never called for guests. Fire-and-forget; a failure here never
  // breaks the page.
  const seenRecordedRef = useRef<string | null>(null);
  useEffect(() => {
    if (authLoading) return;
    const key = `${user?.id ?? 'guest'}::${slug}`;
    if (seenRecordedRef.current === key) return;
    seenRecordedRef.current = key;
    if (user?.id) {
      void (async () => {
        try {
          const res = await fetch('/api/v1/agent/memory');
          const json = await res.json().catch(() => null);
          const memory = json?.data?.memory ?? json?.memory ?? null;
          // Section 13, Chunk C: capture the stated max budget
          // for the BudgetAlternative slot (opt-in preference,
          // never inferred; ignored unless a positive number).
          const statedBudget = memory?.preferences?.maxBudgetUsd;
          if (typeof statedBudget === 'number' && Number.isFinite(statedBudget) && statedBudget > 0) {
            setBudgetUsd(statedBudget);
          }
          if (res.ok && memory?.consentGrantedAt) {
            await fetch('/api/v1/agent/memory', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ consent: true, addSeenSlug: slug }),
            }).catch(() => {});
          }
        } catch {
          // Memory recording must never break the product page.
        }
      })();
    } else {
      try {
        const guest = loadGuestMemory();
        // Section 13, Chunk C: same stated-budget capture as the
        // signed-in branch above, from device-local memory.
        const guestBudget = guest?.preferences?.maxBudgetUsd;
        if (typeof guestBudget === 'number' && Number.isFinite(guestBudget) && guestBudget > 0) {
          setBudgetUsd(guestBudget);
        }
        if (guest?.consentGrantedAt) {
          saveGuestMemory({
            ...guest,
            seenProductSlugs: mergeSeenProducts(guest.seenProductSlugs, slug),
          });
        }
      } catch {
        // Guest memory is best-effort only.
      }
    }
  }, [user?.id, authLoading, slug]);

  // Section 11, Chunk C: record this view in the guest
  // recently-viewed history (device-local only). Once per product
  // id, from the seeded/refreshed product row — so it fires on mount
  // even before fetchAll finishes, and a re-view of the same product
  // never double-records. Failures are swallowed inside the lib
  // (never throws), so recording can never break the page.
  const recentlyViewedRecordedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!product?.id) return;
    if (recentlyViewedRecordedRef.current === product.id) return;
    recentlyViewedRecordedRef.current = product.id;
    recordRecentlyViewed({
      id: product.id,
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      category: product.category,
      imageUrl: product.imageUrl,
    });
  }, [
    product?.id,
    product?.slug,
    product?.name,
    product?.brand,
    product?.category,
    product?.imageUrl,
  ]);

  // Merchant trust for the Where-to-Buy rows. The product merchants
  // endpoint returns only merchantId + name, while the trust /
  // accuracy endpoints are keyed by merchant slug — so the merchant
  // directory (id → slug) and the verified list are fetched first,
  // then trust + accuracy per listed merchant in parallel. Any
  // failure falls back to the honest empty states (all-null policy
  // → "Not enough data"; zero audit samples → "No audits yet").
  useEffect(() => {
    if (!merchantsLoaded || merchants.length === 0) return;
    let cancelled = false;
    const emptyTrust = (): {
      trust: TrustGradeResult;
      accuracy: AccuracyCheck;
    } => ({
      trust: computeTrustGrade({
        returnWindowDays: null,
        warrantyMonths: null,
        reputationScore: null,
      }),
      accuracy: accuracyScore([]),
    });
    void (async () => {
      try {
        const [listRes, verifiedRes] = await Promise.all([
          fetchTimed('/api/v1/merchants?pageSize=100', 15000),
          fetchTimed('/api/v1/merchants/verified', 15000),
        ]);
        const slugById = new Map<string, string>();
        if (listRes?.ok) {
          const listJson = await listRes.json().catch(() => null);
          if (Array.isArray(listJson?.data)) {
            for (const m of listJson.data as Array<{ id?: unknown; slug?: unknown }>) {
              if (typeof m?.id === 'string' && typeof m?.slug === 'string') {
                slugById.set(m.id, m.slug);
              }
            }
          }
        }
        const verifiedById = new Map<string, string | null>();
        if (verifiedRes?.ok) {
          const verifiedJson = await verifiedRes.json().catch(() => null);
          if (Array.isArray(verifiedJson?.data?.merchants)) {
            for (const m of verifiedJson.data.merchants as Array<{ id?: unknown; verifiedUntil?: unknown }>) {
              if (typeof m?.id === 'string') {
                verifiedById.set(
                  m.id,
                  typeof m.verifiedUntil === 'string' ? m.verifiedUntil : null
                );
              }
            }
          }
        }
        const next: Record<
          string,
          {
            trust: TrustGradeResult;
            accuracy: AccuracyCheck;
            verified: boolean;
            verifiedUntil: string | null;
          }
        > = {};
        await Promise.all(
          merchants.map(async (listing) => {
            const merchantSlug = slugById.get(listing.merchantId);
            const verified = verifiedById.has(listing.merchantId);
            const verifiedUntil = verifiedById.get(listing.merchantId) ?? null;
            if (!merchantSlug) {
              next[listing.merchantId] = { ...emptyTrust(), verified, verifiedUntil };
              return;
            }
            const [trustRes, accRes] = await Promise.all([
              fetchTimed(
                `/api/v1/merchants/${encodeURIComponent(merchantSlug)}/trust`,
                15000
              ),
              fetchTimed(
                `/api/v1/merchants/${encodeURIComponent(merchantSlug)}/accuracy`,
                15000
              ),
            ]);
            const entry = { ...emptyTrust(), verified, verifiedUntil };
            if (trustRes?.ok) {
              const trustJson = await trustRes.json().catch(() => null);
              if (trustJson?.success && trustJson.data) {
                entry.trust = {
                  grade: trustJson.data.grade ?? null,
                  score: trustJson.data.score ?? null,
                  missing: Array.isArray(trustJson.data.missing)
                    ? trustJson.data.missing
                    : ['returnWindowDays', 'warrantyMonths', 'reputationScore'],
                  breakdown: trustJson.data.breakdown ?? null,
                  reasons: Array.isArray(trustJson.data.reasons)
                    ? trustJson.data.reasons
                    : [],
                };
              }
            }
            if (accRes?.ok) {
              const accJson = await accRes.json().catch(() => null);
              if (accJson?.success && accJson.data) {
                const sampleCount =
                  typeof accJson.data.sampleCount === 'number'
                    ? accJson.data.sampleCount
                    : 0;
                entry.accuracy = {
                  score: accJson.data.score ?? null,
                  sampleCount,
                  matchCount: accJson.data.matchCount ?? 0,
                  mismatchCount: accJson.data.mismatchCount ?? 0,
                  caution: accJson.data.caution ?? false,
                  insufficientSamples:
                    sampleCount < ACCURACY_MIN_SAMPLES_FOR_CAUTION,
                  status: accJson.data.status ?? 'insufficient',
                  reasons: Array.isArray(accJson.data.reasons)
                    ? accJson.data.reasons
                    : [],
                };
              }
            }
            next[listing.merchantId] = entry;
          })
        );
        if (!cancelled) {
          setMerchantTrust(next);
          setMerchantTrustLoaded(true);
        }
      } catch {
        if (!cancelled) {
          const fallback: Record<
            string,
            {
              trust: TrustGradeResult;
              accuracy: AccuracyCheck;
              verified: boolean;
              verifiedUntil: string | null;
            }
          > = {};
          for (const listing of merchants) {
            fallback[listing.merchantId] = {
              ...emptyTrust(),
              verified: false,
              verifiedUntil: null,
            };
          }
          setMerchantTrust(fallback);
          setMerchantTrustLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [merchantsLoaded, merchants, fetchTimed]);

  const fetchAll = useCallback(async () => {
    // With server-provided initial data the hero is already on
    // screen — do not flash the full-page spinner while the refresh
    // runs, and never wipe the seed on a transient refresh failure.
    if (!initialProduct) setLoading(true);
    setLastCheckedAt(null);
    try {
      // 1. Product first, on its own: as soon as it is known, render the
      // page (header, image, name) instead of waiting for everything else.
      const productRes = await fetchTimed(`/api/v1/products/${slug}`, 30000);
      if (!productRes) {
        if (!initialProduct) setProduct(null);
        return;
      }
      const productData = await productRes.json();
      if (!productData.success || !productData.data) {
        if (!initialProduct) setProduct(null);
        return;
      }
      setProduct(productData.data);
      setLoading(false);
      // Section 20, #8: variants arrive with the product payload.
      // Non-array (older cached payload) reads as [] — never a crash.
      if (Array.isArray(productData.data.variants)) {
        setVariants(productData.data.variants as ProductVariant[]);
        if (productData.data.variants.length > 0) {
          setSelectedVariantId(
            (productData.data.variants[0] as ProductVariant).id
          );
        }
      } else {
        setVariants([]);
        setSelectedVariantId(null);
      }

      // Warm the prices server cache in the background now, so the
      // Price History tab does not start its first fetch only when
      // the user clicks it (live audit: ~20s after the click, mostly
      // cold-start + first DB query). The warmed response also
      // carries the last-checked time: the latest recorded_at across
      // the loaded history points (Option 14-A). Fire-and-forget and
      // failure-tolerant: a failed parse only leaves the timestamp
      // line hidden, it never blocks the page.
      void (async () => {
        const pricesRes = await fetchTimed(`/api/v1/products/${slug}/prices?limit=100`, 15000);
        if (!pricesRes || !pricesRes.ok) return;
        try {
          const pricesData = await pricesRes.json();
          const history = pricesData?.data?.history;
          if (pricesData?.success && Array.isArray(history)) {
            setLastCheckedAt(latestRecordedAt(history));
          }
        } catch {
          // Ignore: no timestamp rather than a wrong one.
        }
      })();

      // 2. Ancillary data (summary, prediction, reviews) loads in the
      // background and fills in as it arrives; a slow or failed one only
      // leaves its own section empty, it never blocks the page again.
      const [summaryRes, predictionRes, reviewsRes, aiReviewRes, merchantsRes] = await Promise.all([
        fetchTimed(`/api/v1/ai-summary/${slug}`),
        fetchTimed(`/api/v1/predictions/${slug}`),
        fetchTimed(`/api/v1/products/${slug}/reviews`),
        fetchTimed(`/api/v1/products/${slug}/review-summary`),
        fetchTimed(`/api/v1/products/${slug}/merchants`),
      ]);

      if (merchantsRes && merchantsRes.ok) {
        const merchantsData = await merchantsRes.json();
        if (merchantsData.success && Array.isArray(merchantsData.data)) {
          setMerchants(merchantsData.data);
          // Phase 3 Prep: affiliate disclosure flag from the server
          // (true only when a real tag/publisher id is configured).
          setAffiliateEnabled(merchantsData.meta?.affiliateEnabled === true);
        } else {
          setMerchantsFailed(true);
        }
      } else {
        setMerchantsFailed(true);
      }
      setMerchantsLoaded(true);

      // Coupons are fetched in the same ancillary batch (one small
      // request, failures ignored): the best currently-valid code is
      // shown per merchant row below, with copy-to-clipboard — the
      // closest a website can honestly get to "auto-apply", since the
      // retailer owns its own checkout (auto-apply lives only in the
      // browser extension's checkout panel).
      try {
        const couponsRes = await fetchTimed('/api/v1/coupons?pageSize=100', 15000);
        if (couponsRes && couponsRes.ok) {
          const couponsData = await couponsRes.json();
          if (couponsData.success && Array.isArray(couponsData.data)) {
            const all = couponsData.data as DealCoupon[];
            const byMerchant: Record<string, DealCoupon> = {};
            for (const merchantId of Array.from(new Set(all.map((c) => c.merchantId).filter(Boolean)))) {
              const best = bestCoupon(all.filter((c) => c.merchantId === merchantId));
              if (best && merchantId) byMerchant[merchantId] = best;
            }
            setCouponsByMerchant(byMerchant);
          }
        }
      } catch {
        // No coupons shown; the Buy rows still work.
      }

      if (summaryRes && summaryRes.ok) {
        const summaryData = await summaryRes.json();
        if (summaryData.success) setSummary(summaryData.data);
      }

      if (predictionRes && predictionRes.ok) {
        const predictionData = await predictionRes.json();
        if (predictionData.success) setPrediction(predictionData.data);
      }

      if (reviewsRes && reviewsRes.ok) {
        const reviewsData = await reviewsRes.json();
        if (reviewsData.success) {
          setReviews(reviewsData.data.reviews ?? []);
          setReviewPhotos(normalizeReviewPhotos(reviewsData.data.photos));
          const s = reviewsData.data.summary as Record<string, unknown> | null;
          setReviewSummary(
            s
              ? {
                  averageRating: Number(s.averageRating ?? s.avgRating ?? 0) || 0,
                  totalReviews: Number(s.totalReviews ?? s.total ?? 0) || 0,
                  ratingDistribution: (s.ratingDistribution ?? s.distribution ?? {}) as Record<number, number>,
                }
              : null
          );
        }
      }

      if (aiReviewRes && aiReviewRes.ok) {
        const aiReviewData = await aiReviewRes.json();
        if (aiReviewData.success) setAiReviewSummary(aiReviewData.data ?? null);
      }

      void fetch(`/api/v1/product-views`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: productData.data.id }),
      }).catch(() => {});
    } catch {
      // A failed refresh must not wipe the server-provided seed.
      if (!initialProduct) setProduct(null);
    } finally {
      setLoading(false);
    }
  }, [slug, fetchTimed, initialProduct]);

  // Lightweight refresh after a review is submitted: refetch only
  // the review list and the AI Review Summary, without re-running
  // the full page fetch (which would flash the loading spinner).
  const refreshReviews = useCallback(async () => {
    const [reviewsRes, aiReviewRes] = await Promise.all([
      fetchTimed(`/api/v1/products/${slug}/reviews`),
      fetchTimed(`/api/v1/products/${slug}/review-summary`),
    ]);
    if (reviewsRes && reviewsRes.ok) {
      const reviewsData = await reviewsRes.json();
      if (reviewsData.success) {
        setReviews(reviewsData.data.reviews ?? []);
        setReviewPhotos(normalizeReviewPhotos(reviewsData.data.photos));
        const s = reviewsData.data.summary as Record<string, unknown> | null;
        setReviewSummary(
          s
            ? {
                averageRating: Number(s.averageRating ?? s.avgRating ?? 0) || 0,
                totalReviews: Number(s.totalReviews ?? s.total ?? 0) || 0,
                ratingDistribution: (s.ratingDistribution ?? s.distribution ?? {}) as Record<number, number>,
              }
            : null
        );
      }
    }
    if (aiReviewRes && aiReviewRes.ok) {
      const aiReviewData = await aiReviewRes.json();
      if (aiReviewData.success) setAiReviewSummary(aiReviewData.data ?? null);
    }
  }, [slug, fetchTimed]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Section 6, Item 12: fetch admin-recorded warranty plans for this
  // product's category. Failure leaves the empty list — the table
  // shows its honest empty state.
  useEffect(() => {
    const category = product?.category;
    if (!category) return;
    let cancelled = false;
    fetch(`/api/v1/warranty-plans?category=${encodeURIComponent(category)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.success && Array.isArray(json.data)) {
          setWarrantyPlans(json.data as WarrantyPlan[]);
        }
      })
      .catch(() => {
        // Table shows its honest empty state on failure.
      });
    return () => {
      cancelled = true;
    };
  }, [product?.category]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <Package className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Product not found</h1>
        <Button onClick={() => router.push('/search')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Search
        </Button>
      </div>
    );
  }

  // Hero price: the prediction's current price when it loaded, else
  // the cheapest recorded merchant price — a failed prediction fetch
  // used to leave the hero with NO price at all even though Where to
  // Buy (below) had real prices. Merchant listings arrive cheapest
  // first from the API, so merchants[0] is the cheapest.
  const heroPrice =
    prediction?.currentPrice ??
    (merchantsLoaded && merchants.length > 0 ? merchants[0].price : null);
  // Canonical Deal Score (lib/deal-score.ts) — the ONE formula every
  // surface uses, extracted verbatim from the inline version that
  // used to live here. Null when the prediction inputs are missing
  // or not finite: no badge then, never a synthesized default. The
  // discount % shown alongside it (merchant rows below) is the
  // merchant compare-at basis (lib/deal-math discountPercent),
  // never the deals-table % — the two numbers answer different
  // questions and must never be mixed into one.
  // Section 15, B1: dealScoreForDisplay ALSO hides the badge while
  // the prediction rests on fewer than DEAL_SCORE_MIN_DATA_POINTS
  // (5) price points — the live catalog's 4 points per product all
  // score a meaningless 100/100. The formula itself is unchanged;
  // only the display is gated.
  const dealScore = dealScoreForDisplay(prediction);
  // Carbon label (lib/sustainability.ts resolveCarbonLabel — the pure
  // core of getSustainabilitySummary, which itself needs a Supabase
  // client and cannot run in this client component): recorded
  // footprint first, estimate labeled as an estimate, no number
  // when neither exists.
  const carbonLabel = resolveCarbonLabel({
    recordedKg: product?.endurance?.carbonFootprintKg ?? null,
    category: product?.category ?? null,
    priceUsd: heroPrice ?? null,
  });
  // Full landed cost for the checkout handoff (lib/local-payments.ts
  // — reuses the tax estimator; duty is the documented 10%
  // placeholder, shipping is 0 when unknown, never guessed).
  const destinationCountryCode = detectedCountryCode ?? region.code;
  const landedCost =
    merchantsLoaded && merchants.length > 0
      ? estimateLandedCostForCheckout({
          priceUsd: merchants[0].price,
          countryCode: destinationCountryCode,
        })
      : null;
  const landedCountryName =
    getRegionByCountry(destinationCountryCode)?.name ?? destinationCountryCode;
  // Seeded specs for the Specs tab, grouped by their stored group.
  // [] when the product has no attribute rows — the tab then shows
  // only the base Brand/Category/GTIN/Data-completeness rows, exactly as
  // before. Ungrouped rows join the main Specifications card; each
  // named group gets its own card below it.
  const attributeGroups = groupAttributes(product.attributes);
  const ungroupedAttributes =
    attributeGroups.find((g) => g.group === null)?.items ?? [];
  const namedAttributeGroups = attributeGroups.filter(
    (g) => g.group !== null
  );
  // Option 16: lifespan midpoint from the Option 9 category range
  // (typical for the category, never this product's measured life)
  // feeds the daily-cost math; spec tier feeds the regret-risk
  // overkill check. Both are null when no data supports them.
  const lifespanRange = lifespanForCategory(product?.category ?? null);
  const lifespanYears = lifespanRange
    ? (lifespanRange.minYears + lifespanRange.maxYears) / 2
    : null;
  const specTier = specTierFromAttributes(product?.attributes ?? []);
  // NOTE (P0 fix, 2026-11-09 audit): the Product JSON-LD moved to the
  // server page (lib/product-seo.ts) so crawlers see it without JS —
  // availability there comes from the recorded merchant rows and an
  // aggregate rating is emitted only with ≥1 real review, same rules
  // this client block used to apply after the merchants loaded.

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <SiteHeader />
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <Button variant="ghost" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="overflow-hidden">
            {/* Section 14, chunk 5: gallery replaces the single hero
                image. With no recorded product_images rows it renders
                exactly what was here before — the single product
                image (or the Package placeholder) — and with rows it
                adds thumbnail switching. Raw <img> (not next/image):
                product images come from arbitrary merchant hosts
                outside next.config.js remotePatterns. */}
            <ProductGallery
              images={product.images ?? []}
              fallbackImageUrl={product.imageUrl}
              productName={product.name}
            />
          </Card>

          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2">
                {product.brand && <Badge variant="secondary">{product.brand}</Badge>}
                {product.category && <Badge variant="outline">{product.category}</Badge>}
              </div>
              <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{product.name}</h1>
              {product.description && (
                <p className="mt-2 text-muted-foreground">{product.description}</p>
              )}
              {/* Translated description for the current UI language
                  (admin-verified only, source labeled). English is
                  the source language; "Not translated yet" is the
                  honest state when nothing is recorded — a
                  translation is never claimed when it does not
                  exist. A failed fetch renders nothing rather than
                  a false "not translated" claim. */}
              {language !== 'en' && translationState === 'translated' && translation && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <p className="text-sm leading-relaxed">{translation.text}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {translationSourceLabel(translation.source)} · {language}
                  </p>
                </div>
              )}
              {language !== 'en' && translationState === 'not-translated' && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Not translated yet — this description is shown in English.
                </p>
              )}
            </div>

            {heroPrice && (
              <div className="flex items-center gap-3">
                <Price usd={heroPrice} className="text-3xl font-bold text-blue-600" />
                {prediction && prediction.averagePrice !== null && prediction.averagePrice !== undefined && heroPrice > prediction.averagePrice && (
                  <Badge className="bg-red-500">
                    <TrendingUp className="mr-1 h-3 w-3" />
                    Above average
                  </Badge>
                )}
                {prediction && prediction.averagePrice !== null && prediction.averagePrice !== undefined && heroPrice < prediction.averagePrice && (
                  <Badge className="bg-green-500">
                    <TrendingDown className="mr-1 h-3 w-3" />
                    Below average
                  </Badge>
                )}
              </div>
            )}

            {/* Section 13, Chunk C: hero 30-day trend chip — reuses
                the existing PriceTrendSparkline (showChange), which
                reads the same recorded price history the Price
                History tab graphs (change across the last 30
                recorded points; history spans at most 30 days). It
                renders nothing with fewer than 2 recorded points or
                on fetch failure, so no chip ever shows a guessed
                move. The wrapper div is empty in that case (the
                title is only a tooltip), so no orphan label shows. */}
            <div title="Price change across the recorded price history (last 30 days)">
              <PriceTrendSparkline slug={slug} showChange />
            </div>

            {prediction && (
              <div className="flex items-center gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                {/* Canonical Deal Score (lib/deal-score.ts
                    dealScoreForDisplay): 100 − prob×0.4 +
                    price term + confidence×0.3, clamped 0–100. The
                    badge still clamps as a second line of defence.
                    Section 15, B1: hidden entirely while the
                    prediction rests on fewer than 5 price points.
                    Section 16, item 10: hidden no longer means
                    silent — the badge renders the withheld state
                    ("4 of 5 points") and the copy beside it says
                    why, so the missing score reads as a reasoned
                    "not yet", not a broken page. */}
                <DealScoreBadge
                  score={dealScore}
                  dataPoints={prediction.dataPoints}
                  size="lg"
                  showLabel
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">Deal Score</p>
                  {dealScore !== null ? (
                    <p className="text-xs text-muted-foreground">
                      {/* (6) Reconciles the "100 / Excellent Deal" badge
                          with a 0% discount probability: the score
                          rewards buying NOW (price at/near its recorded
                          low scores highest), while the discount
                          probability is about a FUTURE drop — and a high
                          future-drop chance LOWERS this score, because
                          waiting may pay off. So 100 next to 0% means
                          "good now, no drop expected", not "a drop is
                          coming". */}
                      Value of buying now, from recorded price history: highest when the price is at
                      or near its recorded low. A high chance of a future price drop lowers this
                      score instead — so a high score with a low discount probability means
                      &ldquo;good now, no drop expected&rdquo;, not &ldquo;a drop is coming&rdquo;.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Withheld until the prediction rests on at least 5
                      recorded price points
                      {prediction.dataPoints != null
                        ? ` — this product has ${prediction.dataPoints} so far`
                        : ''}
                      . A score from fewer points would be a 4-point
                      artifact, not a deal signal.
                    </p>
                  )}
                </div>
              </div>
            )}

            {prediction && (
              <BestTimeToBuyIndicator
                discountProbability={prediction.discountProbability}
                currentPrice={prediction.currentPrice}
                averagePrice={prediction.averagePrice}
                lowestPrice={prediction.lowestPrice}
                // Exact-date forecasts are retired (Option 7 honesty rule):
                // with only a few recorded points, SmartBuy shows an
                // estimate with its confidence, not a predicted sale date.
                expectedSaleDate={null}
              />
            )}

            {/* Section 19, Phase 2 (§12 #25): buying-opportunity
                composite — renders ONLY when all four conditions
                hold (near recorded low + fresh + validated discount
                + in stock); any missing condition renders nothing.
                Freshness comes from lastCheckedAt — the latest
                recorded_at across the price history, the most
                accurate check date this page holds (the local
                Product shape carries no dataFreshness). */}
            {prediction && product && (
              <BuyingOpportunityBadge
                slug={slug}
                currentPrice={prediction.currentPrice}
                lowestPrice={prediction.lowestPrice}
                dataFreshness={lastCheckedAt}
                inStock={merchants.some(
                  (m) => m.inStock || m.availability === 'in_stock'
                )}
              />
            )}

            {/* Option 15 Module 1: deterministic MA-based badge — renders nothing
                while loading, on fetch failure, or with <2 recorded price points. */}
            <PricePredictionBadge slug={slug} />

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => router.push(`/compare?products=${product.id}`)}>
                <GitCompare className="mr-2 h-4 w-4" /> Compare
              </Button>
              <PriceAlertDialog
                productId={product.id}
                productName={product.name}
                currentPrice={prediction?.currentPrice}
              />
              <WishlistButton
                productId={product.id}
                productName={product.name}
                productSlug={product.slug}
              />
              {/* P0 fix (2026-11-09 audit): public UI had no share
                  mechanism anywhere — a good deal was a dead end. */}
              <ShareButtons title={product.name} enableReferral />
            </div>

            {/* Section 12, Chunk E: push opt-in prompt, below the
                hero actions so it never blocks the price or the
                Where-to-Buy section. Dismissible; hidden entirely
                on browsers without push support. */}
            <PushOptInPrompt context="product" className="mt-4" />

            {summary && (
              <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50 dark:border-blue-800 dark:from-blue-950 dark:to-cyan-950">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-5 w-5 text-blue-500" />
                    {tFor(language, 'productAiSummary')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{summary.summary}</p>
                  {/* Section 19, Phase 2 (§12 #16): generated-at +
                      price-as-of stamp — real values only (createdAt
                      is the generation time; priceAsOf is the
                      product's dataFreshness). The freshness note
                      qualifies the verdict when the price is stale
                      or its age is unknown (§12 #20). */}
                  {(summary.createdAt || summary.priceAsOf) && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Summary generated{' '}
                      {summary.createdAt
                        ? formatLastChecked(summary.createdAt) ?? summary.createdAt
                        : '—'}
                      {' · '}Price as of{' '}
                      {summary.priceAsOf
                        ? (formatLastChecked(summary.priceAsOf) ?? summary.priceAsOf)
                        : 'unknown'}
                    </p>
                  )}
                  {summary.freshnessNote && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      {summary.freshnessNote}
                    </p>
                  )}
                  {/* Section 19, fix-up (§12 #70): shared transparency
                      block for the AI summary — what it was built
                      from, when, and what it never checks. Fed only
                      from this page's own state (the summary's real
                      generation time and price-as-of, the loaded
                      review count, the recorded specification count,
                      and the loaded price prediction); any value the
                      page has not loaded is stated as not shown here
                      rather than guessed. */}
                  <div className="mt-4">
                    <TransparencyBlock
                      title="How this summary was calculated"
                      dataUsed={[
                        `Recorded product details: ${product?.name ?? 'this product'}${product?.brand ? `, ${product.brand}` : ''}${product?.category ? ` (${product.category})` : ''}.`,
                        prediction
                          ? `Recorded price history: ${prediction.dataPoints ?? 'an unknown number of'} recorded points${prediction.currentPrice !== null && prediction.currentPrice !== undefined ? ` — current $${prediction.currentPrice.toFixed(2)}` : ''}${prediction.lowestPrice !== null && prediction.lowestPrice !== undefined ? `, lowest $${prediction.lowestPrice.toFixed(2)}` : ''}${prediction.highestPrice !== null && prediction.highestPrice !== undefined ? `, highest $${prediction.highestPrice.toFixed(2)}` : ''}.`
                          : 'Recorded price history (the summary generator reads it; this page has not loaded the price prediction, so the point count is not shown here).',
                        reviewSummary
                          ? `Recorded reviews: ${reviewSummary.totalReviews} recorded review${reviewSummary.totalReviews !== 1 ? 's' : ''}${reviewSummary.totalReviews > 0 ? `, average rating ${reviewSummary.averageRating.toFixed(1)}` : ''}.`
                          : 'Recorded reviews: the review count has not loaded on this page.',
                        `${product?.attributes?.length ?? 0} recorded specifications.`,
                        summary.alternatives.length > 0
                          ? `Alternatives: ${summary.alternatives.length} same-category product${summary.alternatives.length !== 1 ? 's' : ''} listed below the pros and cons.`
                          : 'No alternatives were listed for this product.',
                      ]}
                      dataTimestamp={summary.createdAt ?? null}
                      dataTimestampLabel="Summary generated at"
                      confidence="No confidence score — this summary is a deterministic template over the recorded rows above, not a scored prediction and not a language-model analysis."
                      assumptions={[
                        'The recorded price, reviews and specifications are taken as accurate as recorded; nothing is checked against the merchant’s live listing.',
                        'The verdict text was written when the summary was generated — if the price has gone stale since, the freshness note above qualifies it.',
                      ]}
                      missingInfo={[
                        ...(reviewSummary !== null && reviewSummary.totalReviews === 0
                          ? ['No review data exists for this product, so no quality claim in the summary is backed by reviews.']
                          : []),
                        ...((product?.attributes?.length ?? 0) === 0
                          ? ['No specifications are recorded for this product.']
                          : []),
                        'No merchant reliability, warranty or shipping data is used in this summary.',
                        'The summary does not check the merchant’s live price — it uses the last recorded price (see "Price as of" above).',
                      ]}
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Section 20, #8: variant selector — renders ONLY when the
            product actually has variants (0 rows live today, so this
            renders nothing on any live product). A variant is a
            recorded configuration (storage, colour, size); picking
            one shows its SKU + stock, never a price — variants
            carry no price column, so none is invented. */}
        {variants.length > 0 && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="text-base">Options</CardTitle>
              <CardDescription>
                {variants.length} option{variants.length !== 1 ? 's' : ''} for this product.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <label htmlFor="product-variant" className="mb-1 block text-sm font-medium">
                Choose an option
              </label>
              <select
                id="product-variant"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={selectedVariantId ?? ''}
                onChange={(e) => setSelectedVariantId(e.target.value)}
              >
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.inStock ? '' : ' (out of stock)'}
                  </option>
                ))}
              </select>
              {(() => {
                const selected = variants.find((v) => v.id === selectedVariantId);
                if (!selected) return null;
                return (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {selected.sku ? `SKU: ${selected.sku}` : 'No SKU recorded'}
                    {' — '}
                    {selected.inStock ? 'In stock' : 'Out of stock'}
                  </p>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* Where to Buy — merchant listings with price, stock and a
            retailer link. Previously this section did not exist at
            all, so a shopper could see a price and a Deal Score but
            never where to buy the product or whether it was in
            stock. Listings come from merchant_products (already
            sorted cheapest first by the API); prices here are the
            recorded merchant prices, not live retailer checkouts —
            the Buy button opens the retailer's own page. */}
        {merchantsLoaded && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="text-base">{tFor(language, 'whereToBuy')}</CardTitle>
              <CardDescription>
                {merchants.length > 0
                  ? `${merchants.length} retailer${merchants.length !== 1 ? 's' : ''} listing this product. Prices are the latest recorded merchant prices; the retailer sets the final price at checkout.`
                  : tFor(language, 'noListings')}
              </CardDescription>
              {/* Option 14-A: when prices were last checked, from the
                  recorded price history (max recorded_at). Renders
                  nothing when there is no price history — no invented
                  date, no fake timestamp. */}
              {lastCheckedLabel && (
                <p className="text-xs text-muted-foreground">
                  Prices last checked: {lastCheckedLabel}
                </p>
              )}
            </CardHeader>
            {merchants.length > 0 && (
              <CardContent className="space-y-3">
                {/* Section 13, Chunk C: side-by-side merchant
                    comparison — the same recorded rows as the cards
                    below, in one table so prices, discounts, stock
                    and last sync are comparable at a glance. "—"
                    where a row has no value (no compare-at price,
                    no sync timestamp) — never a guessed number. */}
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full min-w-[560px] text-sm">
                    <caption className="sr-only">Merchant price comparison</caption>
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-muted-foreground dark:border-slate-700 dark:bg-slate-800/50">
                        <th scope="col" className="px-3 py-2 font-medium">Merchant</th>
                        <th scope="col" className="px-3 py-2 font-medium">Price</th>
                        <th scope="col" className="px-3 py-2 font-medium">Compare at</th>
                        <th scope="col" className="px-3 py-2 font-medium">Discount</th>
                        <th scope="col" className="px-3 py-2 font-medium">Stock</th>
                        <th scope="col" className="px-3 py-2 font-medium">Last checked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {merchants.map((listing) => {
                        const tableInStock = listing.inStock || listing.availability === 'in_stock';
                        const tableSaving = discountPercent(listing.price, listing.compareAtPrice);
                        return (
                          <tr key={listing.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                            <td className="px-3 py-2 font-medium">{listing.merchantName ?? 'Retailer'}</td>
                            <td className="px-3 py-2 font-bold">
                              <Price usd={listing.price} />
                            </td>
                            <td className="px-3 py-2">
                              {listing.compareAtPrice !== null && listing.compareAtPrice > listing.price ? (
                                <span className="text-muted-foreground line-through">
                                  <Price usd={listing.compareAtPrice} showOriginal={false} />
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {tableSaving !== null ? (
                                <span className="font-semibold text-green-600">
                                  {/* Section 20, §12 #40 — discountPercentLabel carries the
                                      "vs list price" basis with the number. */}
                                  {discountPercentLabel(listing.price, listing.compareAtPrice)}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {tableInStock
                                ? `In stock${listing.stockQuantity !== null ? ` (${listing.stockQuantity})` : ''}`
                                : 'Out of stock'}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {formatMerchantSyncedAt(listing.lastSyncedAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {merchants.map((listing) => {
                  const inStock = listing.inStock || listing.availability === 'in_stock';
                  const coupon = couponsByMerchant[listing.merchantId];
                  // Merchant-basis saving (compare_at_price vs price),
                  // computed by the shared helper — additive badge only.
                  // The deals-table % shown on widgets is untouched.
                  const merchantSaving = discountPercent(listing.price, listing.compareAtPrice);
                  // Enterprise #11: urgency from this row's own real
                  // signals only — its coupon expiry, its stock, its
                  // recorded saving. No demand/velocity data exists,
                  // so none is ever shown; 'none' renders nothing.
                  const urgency = getDealUrgency({
                    endsAt: coupon?.validUntil ?? null,
                    endLabel: 'Coupon expires',
                    inStock,
                    stockQuantity: listing.stockQuantity,
                    dropPercent: merchantSaving,
                  });
                  // Phase 3 Prep: final Buy href (server affiliate
                  // transform, if any, + client Amazon domain rewrite).
                  // The same href is beaconed below — never a different
                  // URL than the one the shopper actually opens.
                  const buyHref = localizeAmazonUrl(listing.url, region) ?? listing.url ?? undefined;
                  return (
                    <div
                      key={listing.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                    >
                      <div>
                        <p className="font-medium">{listing.merchantName ?? 'Retailer'}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          <Badge variant={inStock ? 'default' : 'secondary'}>
                            {inStock ? tFor(language, 'inStock') : tFor(language, 'outOfStock')}
                          </Badge>
                          <DealUrgencyBadge urgency={urgency} />
                          {listing.shippingDays !== null && listing.shippingDays !== undefined && (
                            <span>Ships in {listing.shippingDays} day{listing.shippingDays !== 1 ? 's' : ''}</span>
                          )}
                          {listing.shippingCost !== null && listing.shippingCost !== undefined && (
                            <span>Shipping <Price usd={listing.shippingCost} showOriginal={false} /></span>
                          )}
                        </div>
                        {coupon && (
                          <div className="mt-1">
                            <button
                              type="button"
                              className="rounded border border-dashed border-green-300 bg-green-50 px-2 py-0.5 font-mono text-xs font-bold text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-300"
                              title="Copy coupon code — paste it at the retailer's checkout"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(coupon.code);
                                } catch {
                                  // Clipboard blocked: the code is still
                                  // visible for manual copying.
                                }
                                setCopiedCoupon(coupon.code);
                                window.setTimeout(() => setCopiedCoupon(null), 2000);
                              }}
                            >
                              {copiedCoupon === coupon.code
                                ? 'Copied!'
                                : `Coupon: ${coupon.code} · ${couponValueLabel(coupon)} (tap to copy)`}
                            </button>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {coupon.description ? `${coupon.description} · ` : ''}
                              {coupon.validUntil
                                ? `Valid until ${new Date(coupon.validUntil).toLocaleDateString()} · `
                                : ''}
                              Apply this code at the retailer&apos;s checkout — SmartBuy cannot apply
                              codes inside a retailer&apos;s checkout. {COUPON_CHECKOUT_UNVERIFIED_LABEL}
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <Price usd={listing.price} className="text-lg font-bold" />
                          {merchantSaving !== null && (
                            <p className="text-sm font-semibold text-green-600">
                              Save {merchantSaving}%
                            </p>
                          )}
                          {listing.compareAtPrice !== null && listing.compareAtPrice > listing.price && (
                            <p className="text-sm text-muted-foreground line-through">
                              <Price usd={listing.compareAtPrice} showOriginal={false} />
                            </p>
                          )}
                        </div>
                        {listing.url ? (
                          <Button asChild>
                            {/* Global: an Amazon search link's domain is
                                rewritten to the visitor region's Amazon
                                domain (path/query untouched); Best Buy
                                links are left unchanged (US/CA only).
                                These remain search links, never invented
                                product-page URLs. */}
                            <a
                              href={buyHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() =>
                                // Step B: shared beacon helper (same
                                // endpoint + payload as before; no
                                // location, IP, or user id is sent).
                                trackAffiliateClick({
                                  productId: product?.id ?? null,
                                  productSlug: slug,
                                  merchantName: listing.merchantName ?? null,
                                  targetUrl: buyHref ?? listing.url ?? '',
                                })
                              }
                            >
                              {tFor(language, 'buy')}
                            </a>
                          </Button>
                        ) : (
                          <Button disabled>{tFor(language, 'buy')}</Button>
                        )}
                        {product && (
                          <BuyListButton productId={product.id} merchantProductId={listing.id} productName={product.name} productSlug={slug} />
                        )}
                      </div>
                      {/* Merchant trust (Section 3 #14, Section 5 #7 &
                          #15): verified badge (renders nothing until a
                          merchant earns it), price-accuracy flag
                          ("No audits yet" until samples exist) and
                          the trust grade ("Not enough data" until
                          policy facts are recorded). The empty states
                          are the correct render — they are never
                          hidden or replaced with a guessed score. */}
                      {merchantTrustLoaded && merchantTrust[listing.merchantId] && (
                        <div className="w-full space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                          <div className="flex flex-wrap items-center gap-2">
                            <VerifiedMerchantBadge
                              verified={merchantTrust[listing.merchantId].verified}
                              verifiedUntil={merchantTrust[listing.merchantId].verifiedUntil}
                            />
                            <AccuracyFlag
                              result={merchantTrust[listing.merchantId].accuracy}
                              merchantName={listing.merchantName ?? 'Retailer'}
                            />
                          </div>
                          <TrustScoreCard
                            merchantName={listing.merchantName ?? 'Retailer'}
                            result={merchantTrust[listing.merchantId].trust}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Checkout handoff: full landed cost for the
                    cheapest recorded price at the visitor's
                    destination (lib/local-payments.ts — reuses the
                    tax estimator; duty is the documented 10%
                    placeholder, VAT is the standard rate or
                    shopper-entered, shipping excluded until the
                    retailer states it). Estimate only — never a
                    customs quote, and the retailer sets the final
                    price at checkout. */}
                {landedCost && (
                  <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <p className="text-sm">
                      <span className="font-medium">Estimated landed cost in {landedCountryName}: </span>
                      <Price usd={landedCost.estimate.totalUsd} className="font-bold" />
                      <span className="text-muted-foreground">
                        {' '}on the cheapest recorded price of <Price usd={landedCost.estimate.priceUsd} showOriginal={false} />
                        {landedCost.vatPct !== null
                          ? ` (includes ${landedCost.dutyPct}% duty and ${landedCost.vatPct}% tax)`
                          : ` (includes ${landedCost.dutyPct}% duty; no single tax rate recorded for this country)`}
                      </span>
                    </p>
                    {landedCost.notes.map((note) => (
                      <p key={note} className="mt-1 text-xs text-muted-foreground">{note}</p>
                    ))}
                  </div>
                )}
                {/* Phase 3 Prep: affiliate disclosure, rendered ONLY
                    when the server reports a real tag/publisher id
                    configured. With nothing configured there is no
                    note, because there is nothing to disclose. */}
                {affiliateEnabled && (
                  <p className="text-xs text-muted-foreground">
                    Affiliate disclosure: SmartBuy may earn a commission from qualifying
                    purchases made through these retailer links, at no extra cost to you.
                  </p>
                )}
                {/* Section 6, Item 9: BNPL line for the cheapest
                    recorded listing — verified instalment options
                    only, terms never guessed. */}
                {merchantsLoaded && merchants.length > 0 && (
                  <div className="mt-3 border-t pt-3">
                    <BnplLine
                      store={findBnplStore(merchants[0].merchantName)}
                      totalUsd={merchants[0].price}
                    />
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        )}

        {/* Section 13, Chunk C: budget alternative — the component
            and its API existed but were never wired into the product
            page (no import here until now). Shows only when the
            visitor stated a max budget in their agent preferences
            AND this product's cheapest recorded price is over it
            AND a real vector-matched alternative within budget
            exists; otherwise it renders nothing. */}
        {product && budgetUsd !== null && (
          <div className="mt-6">
            <BudgetAlternative
              productSlug={slug}
              budgetUsd={budgetUsd}
              sourcePriceUsd={heroPrice ?? null}
            />
          </div>
        )}

        {/* Option 9: Price negotiator (gap math + message draft only —
            SmartBuy never negotiates with retailers) and the return
            policy & warranty matrix (general summaries only). */}
        {product && (
          <PriceNegotiator
            slug={slug}
            productId={product.id}
            productName={product.name}
            cheapestPriceUsd={merchantsLoaded && merchants.length > 0 ? merchants[0].price : null}
          />
        )}
        {product && (
          <ReturnWarrantyMatrix
            merchantNames={[
              ...new Set(merchants.map((m) => m.merchantName).filter(Boolean) as string[]),
            ]}
            countryStoreNames={getStoresForCountry(
              detectedCountryCode ?? region.code
            ).stores.map((s) => s.name)}
          />
        )}

        {/* Section 6, Item 12: admin-recorded third-party warranty /
            insurance plans for this category. The manufacturer
            warranty stays a separate labelled column — never merged
            into a plan row. */}
        {product && (
          <WarrantyPlansTable
            plans={warrantyPlans}
            manufacturerWarranty={product?.globalReadiness?.globalWarrantyType ?? null}
          />
        )}

        {/* Option 7: Tax & duty estimator, fed by the cheapest in-stock
            merchant price (listings are cheapest-first). It is an
            estimate only — never added into a merchant price. */}
        {merchantsLoaded && merchants.length > 0 && (
          <TaxEstimator
            priceUsd={merchants[0].price}
            defaultCountryCode={detectedCountryCode ?? region.code}
          />
        )}

        {/* Option 9: Customs & duty optimizer — compares the user's own
            single vs split shipment scenarios on the estimator's rates.
            Estimate only, never a customs quote or a guaranteed saving. */}
        {merchantsLoaded && merchants.length > 0 && (
          <DutyOptimizer
            priceUsd={merchants[0].price}
            defaultCountryCode={detectedCountryCode ?? region.code}
          />
        )}

        {/* Option 11 Phase 1: Cross-border landed cost (destination
            picker + live-daily FX + de minimis) and the worldwide
            price comparison (FX conversions of the US price, never
            local retailer prices). Both estimate only. */}
        {merchantsLoaded && merchants.length > 0 && (
          <LandedCostCalculator
            priceUsd={merchants[0].price}
            defaultCountryCode={detectedCountryCode ?? region.code}
          />
        )}
        {merchantsLoaded && merchants.length > 0 && product && (
          <RegionArbitrageTable
            priceUsd={merchants[0].price}
            productName={product.name}
            visitorCountryCode={detectedCountryCode ?? region.code}
            productSlug={slug}
            affiliateEnabled={affiliateEnabled}
          />
        )}

        {/* Option 8: eco footprint (estimate only, real alternatives),
            and SmartPool group buying (no discount is ever promised).
            A recorded carbon footprint (Option 17) supersedes the
            estimate in this module — one product, one carbon number. */}
        {product && (
          <EcoFootprint
            slug={slug}
            category={product.category}
            cheapestPriceUsd={merchantsLoaded && merchants.length > 0 ? merchants[0].price : null}
            recordedCarbonKg={product?.endurance?.carbonFootprintKg ?? null}
          />
        )}
        {/* One carbon label per product (lib/sustainability.ts):
            recorded footprint first, estimate labeled as an
            estimate, no number when neither exists. Recorded and
            estimated values are never mixed on one card. */}
        {product && (
          <div className="mt-6">
            <CarbonLabelCard carbon={carbonLabel} productName={product.name} />
          </div>
        )}
        {/* Option 11 Phase 2: unified Trust Check — the Option 8 trust
            card (same component, same props) plus review-authenticity,
            an on-device link checker, and the per-retailer Fake Sale
            scan. This REPLACES the old standalone TrustSignals render
            so the trust score lives in exactly one place. */}
        {/* Batch 2 Module 2: fake-ness & inflation verdict — renders
            nothing while loading or on fetch failure; muted card when
            history is too thin to judge. */}
        <FakeNessChecker slug={slug} />
        {product && (
          <TrustCheckSection
            slug={slug}
            merchantNames={[...new Set(merchants.map((m) => m.merchantName).filter(Boolean) as string[])]}
            knownRetailers={['Amazon', 'Best Buy']}
            totalReviews={reviewSummary?.totalReviews ?? 0}
            ratingDistribution={reviewSummary?.ratingDistribution ?? {}}
            priceUsd={merchantsLoaded && merchants.length > 0 ? merchants[0].price : null}
            imageUrl={product.imageUrl}
            merchants={merchants}
            reviews={reviews}
          />
        )}
        {/* Section 19, §12 #18: consolidated buying considerations —
            price freshness, discount validation, price position and
            recorded trust signals, from data the page already holds.
            Renders the honest "not enough data" line when no signal
            exists for this product — never an invented checklist. */}
        {product && (
          <div className="mt-6">
            <BuyingConsiderations
              lastCheckedAt={lastCheckedAt}
              merchants={merchants}
              totalReviews={reviewSummary?.totalReviews ?? 0}
              averageRating={reviewSummary?.averageRating ?? null}
              verifiedReviews={reviews.filter((r) => r.verifiedPurchase).length}
            />
          </div>
        )}
        {/* Section 6, Item 10: manufacturer authenticity method —
            recorded only, never a "genuine" badge. */}
        {product && (
          <AuthenticityBlock authenticity={product?.authenticity ?? null} />
        )}
        {/* Option 9: Durability & longevity estimate — category range
            plus a review-gated reliability score. No repair-log data
            exists, so none is ever shown. */}
        {product && (
          <DurabilityPredictor
            category={product.category}
            totalReviews={reviewSummary?.totalReviews ?? 0}
            averageRating={reviewSummary?.averageRating ?? null}
            verifiedReviews={reviews.filter((r) => r.verifiedPurchase).length}
          />
        )}
        {product && (
          <SmartPool
            productId={product.id}
            productName={product.name}
            regionCode={detectedCountryCode ?? region.code}
          />
        )}

        {/* Option 10: upcycling ideas (templates + safety warnings only),
            drop-window simulator (simulation, alert shortcut — never a
            price lock), fluff check (real listing text only), and the
            compatibility matrix (honest grades — "Exact" is never claimed). */}
        {product && (
          <UpcyclingBlueprints category={product.category} productName={product.name} />
        )}
        {product && (
          <DropWindowSimulator
            slug={slug}
            productId={product.id}
            productName={product.name}
            cheapestPriceUsd={merchantsLoaded && merchants.length > 0 ? merchants[0].price : null}
          />
        )}
        {product && (
          <FluffDetector productName={product.name} description={product.description} />
        )}
        {product && (
          <CompatibilityMatrix
            slug={slug}
            productName={product.name}
            brand={product.brand}
            category={product.category}
          />
        )}

        {/* Section 8 — local first, then international (StoreSplitSection,
            dynamically imported with ssr:false above so it stays out of
            the First Load bundle). Store lookup uses the visitor's
            actual country (saved choice or raw detection via
            detectedCountryCode), NOT the display region: for a country
            outside the region registry the display region falls back
            to US, but the lookup must return the global fallback,
            never US local stores. Gated on merchantsLoaded (17):
            before the merchants fetch returns, the priced-merchant
            filter would be a no-op and the global fallback's Amazon
            row would flash unfiltered. */}
        {product && merchantsLoaded && (
          <StoreSplitSection
            productName={product.name}
            countryCode={detectedCountryCode ?? region.code}
            regionName={
              (getRegionByCountry(detectedCountryCode ?? region.code) ?? region).name
            }
            geoSource={detectedCountryCode ? regionSource : 'fallback'}
            pricedMerchantNames={merchants.map((m) => m.merchantName ?? '')}
            merchantsFailed={merchantsFailed}
          />
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-8">
          {/* Responsive fix: the old `grid grid-cols-2 sm:grid-cols-6`
              wrapped the tab row on narrow viewports and the panel
              overlapped/clipped the wrapped rows (Savings/Specs
              became unclickable). A single horizontally scrollable
              row with non-shrinking triggers can never wrap under
              or behind the panel. */}
          <TabsList className="flex w-full flex-nowrap justify-start overflow-x-auto">
            <TabsTrigger value="overview" className="shrink-0">Overview</TabsTrigger>
            <TabsTrigger value="price-history" className="shrink-0">Price History</TabsTrigger>
            <TabsTrigger value="prediction" className="shrink-0">Prediction</TabsTrigger>
            <TabsTrigger value="reviews" className="shrink-0">Reviews</TabsTrigger>
            <TabsTrigger value="savings" className="shrink-0">Savings</TabsTrigger>
            <TabsTrigger value="specs" className="shrink-0">Specs</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <div className="grid gap-4 md:grid-cols-2">
              {summary && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ThumbsUp className="h-5 w-5 text-green-500" />
                        {tFor(language, 'productPros')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {(summary.pros ?? []).map((pro, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
                            {pro}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ThumbsDown className="h-5 w-5 text-red-500" />
                        {tFor(language, 'productCons')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {(summary.cons ?? []).map((con, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                            {con}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </>
              )}
              {summary?.alternatives && (summary.alternatives ?? []).length > 0 && (
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">{tFor(language, 'productAlternatives')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {(summary.alternatives ?? []).map((alt, i) => (
                        <Button
                          key={i}
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/products/${alt}`)}
                        >
                          {alt}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="price-history" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-5 w-5 text-blue-500" />
                  {tFor(language, 'productPriceHistory')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Direct price_history data (not the prediction proxy), so
                    this tab works even when the prediction API has no data. */}
                <PriceHistoryGraph slug={slug} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="prediction" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingDown className="h-5 w-5 text-purple-500" />
                  {tFor(language, 'productPriceDropPrediction')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Option 7: Buy Now vs Wait engine over the real recorded
                    price_history points (same endpoint the graph uses).
                    It replaces the retired exact-date / exact-price
                    forecast: no future price or date is ever presented
                    as a fact — only a recommendation + capped confidence
                    + a reason tied to the recorded points.
                    Section 19, Phase 3 (§12 #33): the visitor's
                    stated max budget (when one was stated) is passed
                    through, so an over-budget price is never
                    recommended as a buy. */}
                <BuyVsWait slug={slug} budgetUsd={budgetUsd} />
                {/* Batch 2 Module 3: resale projection from the product's own
                    recorded decline — simulated, never a resale quote.
                    Option 19: a recorded annual rate overrides the
                    derived decline when present. */}
                <ResalePredictor
                  slug={slug}
                  currentPriceUsd={heroPrice ?? null}
                  recordedAnnualRate={product?.recorded?.annualDepreciationRate ?? null}
                />
                {/* (g) The legacy-engine StatBoxes lived here next to
                    BuyVsWait, so one tab showed TWO confidences for one
                    verdict (BuyVsWait 25% vs legacy 20% on the MacBook
                    shape) with no way to tell which to trust. Removed:
                    BuyVsWait is the single canonical engine for this
                    tab; the legacy prediction API still feeds the hero
                    Deal Score / BestTimeToBuy indicator, where its
                    inputs are labeled as such. */}
                <p className="mt-3 text-xs text-muted-foreground">
                  Exact-date and exact-price forecasts are not shown: with few
                  recorded points, SmartBuy shows an estimate with its
                  confidence instead of a guaranteed future price.
                </p>
              </CardContent>
            </Card>

            {/* Price forecast (ranges only, never an exact future price
                or date): 7 / 30 / 90-day ranges from the recorded
                price history plus the 30-day backtest. Honest empty
                state while history is too thin. */}
            <ForecastCard productIdOrSlug={slug} />

            {/* Option 15 Module 2: persona matcher — renders nothing while
                loading or on fetch failure; honest empty state when the
                product has no recorded specifications yet. */}
            <PersonaMatcher slug={slug} category={product?.category ?? null} productName={product?.name ?? ''} />

            {/* Batch 2 Module 1: total ownership — base price plus the
                viewer's own accessories / warranty / maintenance estimates.
                Option 19: recorded mandatory accessories are a separate
                line in the total when present. */}
            <TotalOwnershipCalculator
              slug={slug}
              productName={product?.name ?? ''}
              basePriceUsd={heroPrice ?? null}
              mandatoryAccessoriesUsd={product?.recorded?.mandatoryAccessoriesCost ?? null}
            />

            {/* Option 16: Next-Gen Decision Suite — regret risk (budget
                slider + needs), true cost per hour, repairability, and
                plain-language spec trade-offs. Every card renders an
                honest empty state when its inputs are not recorded. */}
            <div className="mt-6 space-y-6">
              <h3 className="text-lg font-semibold">Decision Suite</h3>
              <div className="grid gap-6 lg:grid-cols-2">
                <RegretRiskBadge
                  priceUsd={heroPrice ?? null}
                  specTier={specTier}
                  specsRecorded={(product?.attributes?.length ?? 0) > 0}
                />
                <CostPerHourCard
                  slug={slug}
                  priceUsd={heroPrice ?? null}
                  lifespanYears={lifespanYears}
                />
              </div>
              <RepairabilityMatrix repairability={product?.repairability ?? null} />
              <SpecTradeoffTable attributes={product?.attributes ?? []} />
            </div>

            {/* Option 17: Hardware Endurance, Sustainability & Modularity
                — endurance index, recorded carbon footprint, and
                upgradeability. Every card renders an honest empty state
                when its inputs are not recorded. */}
            <div className="mt-6 space-y-6">
              <h3 className="text-lg font-semibold">Hardware Endurance &amp; Sustainability</h3>
              <div className="grid gap-6 lg:grid-cols-2">
                <EnduranceCard endurance={product?.endurance ?? null} />
                <SustainabilityCard
                  carbonFootprintKg={product?.endurance?.carbonFootprintKg ?? null}
                  category={product?.category ?? null}
                />
              </div>
              <ModularityMatrix endurance={product?.endurance ?? null} />
              <SupplyChainBlock supplyChain={product?.supplyChain ?? null} />
            </div>

            {/* Option 18: Anti-Trap Checks — derived 90-day lowest +
                fake-deal check (recorded price history only) and
                recorded weight & power. Every card renders an honest
                empty state when its inputs are not recorded. */}
            <div className="mt-6 space-y-6">
              <h3 className="text-lg font-semibold">Anti-Trap Checks</h3>
              <FakeDeal90Card slug={slug} />
              <WeightPowerCard physical={product?.physical ?? null} />
            </div>

            {/* Option 20: Global Readiness — recorded regional
                availability, warranty scope & next-gen release
                schedule. Honest empty state until migration 023 data
                exists; FX, landed cost and Buy vs Wait live elsewhere
                and are not duplicated here. */}
            <div className="mt-6 space-y-6">
              <h3 className="text-lg font-semibold">Global Readiness</h3>
              <GlobalReadinessCard
                globalReadiness={product?.globalReadiness ?? null}
              />
            </div>
          </TabsContent>

          <TabsContent value="reviews" className="mt-4">
            <AIReviewSummarizer summary={aiReviewSummary} language={language} />
            <ReviewAuthenticity reviews={reviews} />
            <ReviewForm slug={slug} onReviewAdded={refreshReviews} />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{tFor(language, 'productReviews')}</CardTitle>
                {/* With 0 reviews there is no average to state: the old
                    code rendered "0.0 average from 0 reviews" above the
                    "No reviews yet." empty state. */}
                {reviewSummary && (reviewSummary.totalReviews ?? 0) > 0 && (
                  <CardDescription>
                    {(reviewSummary.averageRating ?? 0).toFixed(1)} average from {reviewSummary.totalReviews ?? 0} reviews
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                {reviews.length > 0 ? (
                  <div className="space-y-4">
                    {reviews.map((review) => (
                      <div key={review.id} className="border-b border-slate-100 pb-4 last:border-0 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{review.authorName ?? 'Anonymous'}</span>
                            {review.verifiedPurchase && (
                              <Badge variant="secondary" className="text-xs">Verified</Badge>
                            )}
                            {/* Enterprise #9: receipt-backed Verified
                                Buyer checkmark. Only ever on the
                                viewer's OWN review, and only when they
                                hold a vault receipt for this product —
                                the vault read is owner-scoped, so no
                                other reviewer's receipt can ever back
                                a badge here. */}
                            <VerifiedBuyerBadge
                              verified={isOwnVerifiedReview({
                                reviewUserId: review.userId,
                                viewerUserId: user?.id ?? null,
                                viewerHasReceipt:
                                  product !== null && ownVaultProductIds.has(product.id),
                              })}
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                className={cn('h-4 w-4', i < review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300')}
                              />
                            ))}
                          </div>
                        </div>
                        {review.title && <h4 className="mt-1 font-medium">{review.title}</h4>}
                        {review.content && <p className="mt-1 text-sm text-muted-foreground">{review.content}</p>}
                        {(reviewPhotos[review.id] ?? []).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {reviewPhotos[review.id].map((url, i) => (
                              // eslint-disable-next-line @next/next/no-img-element -- user-uploaded review photo on an arbitrary host; next/image remotePatterns allows only Unsplash + Pexels
                              <img
                                key={`${review.id}-photo-${i}`}
                                src={url}
                                alt={`Photo attached to the review by ${review.authorName ?? 'Anonymous'}`}
                                className="h-20 w-20 rounded-md object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-muted-foreground">No reviews yet.</p>
                    <p className="text-sm text-muted-foreground">
                      A sentiment summary will appear here once reviews arrive.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="savings" className="mt-4">
            <CashbackCouponsSection
              productId={product.id}
              // B6: the cheapest listing's own price + compare-at
              // pair, so the stacked "you pay" line stacks the
              // deal that produced this price — never a price from
              // one merchant with a compare-at from another.
              price={merchants.length > 0 ? merchants[0].price : null}
              compareAtPrice={merchants.length > 0 ? merchants[0].compareAtPrice : null}
            />
          </TabsContent>

          <TabsContent value="specs" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{tFor(language, 'productSpecifications')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2">
                  <SpecRow label="Brand" value={product.brand} />
                  <SpecRow label="Category" value={product.category} />
                  <SpecRow label="GTIN" value={product.gtin} />
                  {/* Section 20, #6: model number, hidden by SpecRow
                      when null — 0/10 live products have one, so this
                      row renders nothing today and never a guessed value. */}
                  <SpecRow label="Model number" value={product.modelNumber ?? null} />
                  {/* Sections 21–25, Stage H (H-P2-3) — was "Data
                      completeness {confidence}%": the confidence
                      number is a field-presence count, not a
                      quality score. The row now shows the
                      7-dimension data-quality score computed
                      server-side (identity / specs / images /
                      freshness / merchants / GTIN / attribution);
                      when the merchant price-source column is
                      missing (migration 045 unapplied) the score
                      may understate, and the row says so instead
                      of showing a bare number (H-P2-4). Absent
                      until the API fetch returns — the row hides
                      rather than falling back to the old number. */}
                  <SpecRow
                    label={DATA_QUALITY_SCORE_LABEL}
                    value={
                      product.dataQuality != null
                        ? product.dataQuality.merchantSourceMissing
                          ? `${product.dataQuality.score}/100 (may understate)`
                          : `${product.dataQuality.score}/100`
                        : null
                    }
                  />
                  {/* Seeded specs without a stored group. Key, value
                      and unit are verbatim from the database; a row
                      with an empty value is hidden by SpecRow. */}
                  {ungroupedAttributes.map((attr) => (
                    <SpecRow
                      key={attr.id}
                      label={attr.key}
                      value={formatAttributeValue(attr)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
            {/* Seeded specs with a stored group: one card per group,
                group name verbatim from the database. Products with no
                attribute rows get the honest empty state below. */}
            {namedAttributeGroups.map((g) => (
              <Card key={g.group ?? 'specs'} className="mt-4">
                <CardHeader>
                  <CardTitle className="text-base">{g.group}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {g.items.map((attr) => (
                      <SpecRow
                        key={attr.id}
                        label={attr.key}
                        value={formatAttributeValue(attr)}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
            {/* Section 19, §12 #26: products with no attribute rows
                previously rendered nothing here at all. Honest empty
                state instead — the base card above still shows the
                Brand/Category/GTIN/Data-completeness rows. */}
            {namedAttributeGroups.length === 0 &&
              ungroupedAttributes.length === 0 && (
                <Card className="mt-4">
                  <CardContent className="pt-6">
                    <p className="text-muted-foreground">
                      No specifications recorded for this product yet.
                    </p>
                  </CardContent>
                </Card>
              )}
            {/* Option 7: Size & 3D view. No catalog product carries
                dimensions or a 3D model file today, so this honestly
                renders the no-data notes; when real dimensions or a
                real model URL exist for a product, the diagram / AR
                slot activates from those values — nothing is invented. */}
            <Card className="mt-4">
              <CardContent className="pt-6">
                <ProductVisualizer
                  productName={product.name}
                  dimensions={
                    product?.dimensions?.lengthCm != null &&
                    product?.dimensions?.widthCm != null &&
                    product?.dimensions?.heightCm != null
                      ? {
                          lengthCm: product.dimensions.lengthCm,
                          widthCm: product.dimensions.widthCm,
                          heightCm: product.dimensions.heightCm,
                        }
                      : null
                  }
                  modelUrl={product?.modelUrl ?? null}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Product Q&A: questions and answers from the SmartBuy team
            (never auto-generated). Honest empty state until the first
            question arrives. */}
        <QaSection slug={slug} />

        {/* Section 13, Chunk C: recently-viewed strip on the
            product page — the same component the homepage mounts;
            it reads the device-local history this page records on
            mount and renders nothing when there is no history. */}
        <div className="mt-8">
          <RecentlyViewedStrip />
        </div>

        <div className="mt-8">
          <SimilarProducts
            productId={product.id}
            productSlug={product.slug}
            category={product.category}
            brand={product.brand}
          />
        </div>

        {/* Section 14, Chunk 2 (B12): "Complete your setup" affinity
            picks — a labelled suggestion row, not purchase data. */}
        <div className="mt-8">
          <SetupAffinitySection
            productId={product.id}
            productSlug={product.slug}
            category={product.category}
          />
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

/** Review-photo URLs from the reviews API, keyed by review id.
    Anything malformed is dropped — a bad photos map must never
    break the reviews list. */
function normalizeReviewPhotos(value: unknown): Record<string, string[]> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string[]> = {};
  for (const [key, urls] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(urls)) continue;
    const clean = urls.filter(
      (u): u is string => typeof u === 'string' && u.length > 0
    );
    if (clean.length > 0) out[key] = clean;
  }
  return out;
}

/** Section 13, Chunk C: a merchant row's last sync as a short
    date for the comparison table. "—" when never synced or
    unparseable — never a guessed date. */
function formatMerchantSyncedAt(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function SpecRow({ label, value }: { label: string; value: string | null }) {
  // A spec with no recorded value (e.g. GTIN is null in the database
  // for every catalog product) is hidden instead of shown as a dash:
  // a dash reads like a broken field, while a missing row is honest
  // about the data simply not existing. Never invent a value here.
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between border-b border-slate-100 py-2 text-sm dark:border-slate-800">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
