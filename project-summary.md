# SmartBuy AI — Project Summary

## Current Status

**Phase 2: Enterprise Data Platform — COMPLETE**

The Phase 2 enterprise upgrade has been completed. The data platform now supports 20+ database tables, 6 provider types, a 9-step ingestion pipeline, BullMQ queue architecture with dead-letter queues and idempotent jobs, adaptive data freshness, Redis SWR caching, storage abstraction (R2/S3/Local), and 29 API endpoints. The project builds successfully with zero errors.

**Phase 1: Foundation — COMPLETE** (authentication, database, UI, API foundation, security)

---

## Database Schema (20+ Tables)

### Phase 1 Tables (7)
| Table | Description | RLS |
|-------|-------------|-----|
| `roles` | Role definitions (guest, user, premium, merchant, admin) | Public read |
| `profiles` | User profiles linked 1:1 to auth.users | Owner-scoped |
| `user_settings` | Per-user preferences | Owner-scoped |
| `notifications` | User-facing notifications | Owner-scoped |
| `audit_logs` | Security audit trail | Owner-scoped read |
| `feature_flags` | Database-driven feature flags (13 pre-seeded) | Public read |
| `system_settings` | Global app configuration (6 pre-seeded) | Public read |

### Phase 2 Base Tables (5)
| Table | Description | RLS |
|-------|-------------|-----|
| `retailers` | Retailer catalog (Amazon, eBay, Daraz, AliExpress) | Public read |
| `products` | Normalized product catalog with GTIN, confidence, freshness | Public read |
| `product_images` | Multiple images per product | Public read |
| `price_history` | Append-only time-series price data | Public read |
| `product_sources` | Maps products to external provider sources | Public read |

### Phase 2 Enterprise Extension Tables (13)
| Table | Description | RLS |
|-------|-------------|-----|
| `currencies` | ISO 4217 currency codes (10 pre-seeded) | Public read |
| `countries` | ISO 3166-1 country codes (11 pre-seeded) | Public read |
| `regions` | Sub-country regions/states | Public read |
| `languages` | ISO 639-1 language codes (10 pre-seeded) | Public read |
| `providers` | External data provider registry (7 pre-seeded) | Public read |
| `brands` | Product brand catalog with soft delete | Public read |
| `categories` | Hierarchical category tree with soft delete | Public read |
| `tags` | Flexible product tagging system (7 pre-seeded) | Public read |
| `product_variants` | Product variants (size, color, etc.) with soft delete | Public read |
| `product_attributes` | EAV-style structured product specs | Public read |
| `product_tags` | Many-to-many product↔tag join | Public read |
| `merchants` | Registered merchants with account metadata | Public read |
| `merchant_products` | Merchant-specific pricing and availability | Public read |
| `data_sources` | Configured data feeds with cron scheduling | Public read |
| `deals` | Time-limited promotional deals | Public read |
| `coupons` | Coupon codes with usage limits | Public read |
| `cashback_offers` | Cashback programs | Public read |
| `review_sources` | Review platform registry (4 pre-seeded) | Public read |
| `reviews` | Product reviews (external + user-submitted) | Public read, owner write |
| `wishlists` | User product wishlists | Owner-scoped CRUD |
| `wishlist_items` | Products saved to wishlists | Owner-scoped via wishlist |
| `alerts` | Price drop, back-in-stock, deal alerts | Owner-scoped CRUD |
| `sync_history` | Audit log of all data sync operations | Public read |
| `provider_health` | Real-time provider health tracking | Public read |
| `queue_metrics` | Queue health snapshots | Public read |
| `cache_metrics` | Cache hit/miss statistics | Public read |

### Products Table Extensions
- `brand_id` (FK to brands), `category_id` (FK to categories)
- `deleted_at` (soft delete), `refresh_priority` (1-5), `next_refresh_at`, `refresh_status`, `view_count`

---

## Relationships

### Key Foreign Keys
- `products.brand_id` → `brands.id`
- `products.category_id` → `categories.id`
- `product_variants.product_id` → `products.id` (CASCADE)
- `product_attributes.product_id` → `products.id` (CASCADE, UNIQUE product_id+key)
- `product_tags` → `products.id` + `tags.id` (M2M)
- `merchant_products.product_id` → `products.id`, `merchant_products.merchant_id` → `merchants.id` (UNIQUE merchant+product)
- `data_sources.provider_id` → `providers.id`, `data_sources.merchant_id` → `merchants.id`
- `deals.product_id` → `products.id`, `deals.merchant_id` → `merchants.id`
- `reviews.product_id` → `products.id`, `reviews.review_source_id` → `review_sources.id`, `reviews.user_id` → `profiles.id`
- `wishlist_items.wishlist_id` → `wishlists.id` (CASCADE), `wishlist_items.product_id` → `products.id` (UNIQUE wishlist+product)
- `alerts.product_id` → `products.id`, `alerts.user_id` → `profiles.id`
- `countries.currency_id` → `currencies.id`
- `categories.parent_id` → `categories.id` (self-referencing tree)
- `brands.country_id` → `countries.id`

---

## API Endpoints (29 Routes)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/health` | No | Service health check |
| GET | `/api/v1/feature-flags` | No | Fetch all feature flags |
| GET | `/api/v1/products` | No | List products (paginated, filtered) |
| GET | `/api/v1/products/[slug]` | No | Product detail with images |
| GET | `/api/v1/products/[slug]/prices` | No | Price history with stats |
| GET | `/api/v1/products/[slug]/reviews` | No | Reviews for product |
| POST | `/api/v1/products/[slug]/reviews` | Yes | Create review |
| GET | `/api/v1/products/[slug]/deals` | No | Active deals for product |
| GET | `/api/v1/products/[slug]/merchants` | No | Merchant listings for product |
| GET | `/api/v1/brands` | No | List brands (paginated) |
| GET | `/api/v1/brands/[slug]` | No | Brand by slug |
| GET | `/api/v1/categories` | No | Category tree |
| GET | `/api/v1/categories/[slug]` | No | Category by slug |
| GET | `/api/v1/merchants` | No | List merchants |
| GET | `/api/v1/merchants/[slug]` | No | Merchant by slug |
| GET | `/api/v1/retailers` | No | List retailers |
| GET | `/api/v1/deals` | No | List active deals |
| GET | `/api/v1/coupons` | No | List active coupons |
| GET | `/api/v1/cashback` | No | List active cashback offers |
| GET | `/api/v1/wishlists` | Yes | List user wishlists |
| POST | `/api/v1/wishlists` | Yes | Create wishlist |
| GET | `/api/v1/wishlists/[id]` | Yes | Wishlist detail |
| PATCH | `/api/v1/wishlists/[id]` | Yes | Update wishlist |
| DELETE | `/api/v1/wishlists/[id]` | Yes | Delete wishlist |
| GET | `/api/v1/wishlists/[id]/items` | Yes | List wishlist items |
| POST | `/api/v1/wishlists/[id]/items` | Yes | Add item to wishlist |
| DELETE | `/api/v1/wishlists/[id]/items/[itemId]` | Yes | Remove wishlist item |
| GET | `/api/v1/alerts` | Yes | List user alerts |
| POST | `/api/v1/alerts` | Yes | Create alert |
| PATCH | `/api/v1/alerts/[id]` | Yes | Update alert |
| DELETE | `/api/v1/alerts/[id]` | Yes | Delete alert |
| GET | `/api/v1/monitoring` | No | Monitoring dashboard summary |
| GET | `/api/v1/monitoring/providers` | No | Provider health details |
| GET | `/api/v1/monitoring/sync-history` | No | Sync history log |
| POST | `/api/v1/data/refresh` | Yes | Trigger data fetch job |

---

## Provider Architecture

### Provider Types
| Type | Description | Status |
|------|-------------|--------|
| `official_api` | Official retailer APIs (Amazon, eBay) | Architecture ready |
| `affiliate_feed` | Affiliate network data feeds | Architecture ready |
| `merchant_upload` | Direct merchant product uploads | Architecture ready |
| `csv_import` | CSV file imports | Implemented (CsvProvider) |
| `scraping` | Approved scraping (Apify) | Implemented (ApifyProvider) |
| `mock` | Development sample data | Active (MockProvider) |

### Provider Registry
- Priority ordering: official_api → affiliate_feed → scraping → csv_import → merchant_upload → mock
- `getPreferred()` returns highest-priority available provider
- `getForRetailer(slug)` returns provider for specific retailer
- All providers implement the same `DataProvider` interface (`search()`, `fetch()`, `isAvailable()`)
- Providers degrade gracefully — unavailable providers return empty results

### Data Pipeline (9 Steps)
1. **Validation** — Zod schema validation of RawProductData
2. **Normalization** — Provider data → internal Product model (slug, category, confidence)
3. **Deduplication** — GTIN match (primary) → slug match (fallback)
4. **Category Assignment** — Match/create category hierarchy
5. **Brand Detection** — Match/create brand records
6. **Image Processing** — Deduplicate, validate URLs
7. **Product Insert/Update** — Create or update product with all relations
8. **Price History Recording** — Append to price_history time-series
9. **Audit Logging** — Record all create/update actions

---

## Queue Architecture

### Job Types
| Job Type | Description | Default Priority |
|----------|-------------|-----------------|
| `product.fetch` | Search provider and ingest results | normal |
| `product.search` | Search products | normal |
| `price.update` | Update price for a product | high |
| `price.refresh` | Re-fetch current price from provider | high |
| `product.validate` | Check data freshness | low |
| `cache.invalidate` | Clear cache entries | high |
| `data.sync` | Full sync from data source | normal |
| `image.process` | Process product images | low |

### Queue Features
- **Priority queues**: 4 levels (low, normal, high, critical)
- **Delayed jobs**: `delayMs` parameter
- **Scheduled jobs**: Cron expressions via `data_sources.schedule_cron`
- **Retry policies**: Configurable attempts with exponential backoff
- **Dead-letter queues**: Failed jobs after max retries are logged to DLQ
- **Idempotent jobs**: `idempotencyKey` prevents duplicate processing
- **Queue monitoring**: Metrics recorded to `queue_metrics` table
- **Dual-mode**: BullMQ (Redis) or synchronous (in-process) fallback

---

## Redis Integration

### Caching (Stale-While-Revalidate)
- **Product Details**: Cached via `getCachedProductBySlug()` — 1 min fresh, 5 min stale
- **Price History**: Cached via `getCachedPriceHistory()` — 30 sec fresh, 2 min stale
- **Search Results**: Cache key namespace `smartbuy:search:*`
- **Categories**: Cache key namespace `smartbuy:categories`
- **Brands**: Cache key namespace `smartbuy:brands`
- **Cache invalidation**: Pattern-based via `invalidateCache(prefix)`
- **Dual-mode**: Redis (ioredis) when `REDIS_URL` set, in-memory LRU fallback otherwise

### Cache Metrics
- Hit/miss tracking per namespace via `cache_metrics` table
- Eviction count and size tracking

---

## Storage Integration

### Storage Providers
| Provider | Key | Available When | Status |
|----------|-----|----------------|--------|
| Cloudflare R2 | `r2` | `CLOUDFLARE_R2_*` env vars set | Architecture ready |
| AWS S3 | `s3` | `AWS_S3_*` env vars set | Architecture ready |
| Local (in-memory) | `local` | Always | Active (dev) |

### Storage Interface
- `upload(key, data, options)` — Upload file
- `getSignedUrl(key, expiresInSec)` — Presigned download URL
- `getPublicUrl(key)` — Public CDN URL
- `delete(key)` — Remove file
- `exists(key)` — Check existence

### Registry
- `getStorageProvider()` singleton picks R2 > S3 > Local based on availability
- No AWS SDK dependency — uses SigV4 signing with native `fetch()`

---

## Monitoring Architecture

### Tracked Metrics
| Metric | Table | Description |
|-------|-------|-------------|
| Provider health | `provider_health` | Circuit breaker state, success/failure counts, avg response time |
| Sync history | `sync_history` | Audit log of all data sync operations |
| Queue metrics | `queue_metrics` | Queue depth, throughput, latency snapshots |
| Cache metrics | `cache_metrics` | Hit/miss/eviction per namespace |
| Data freshness | `products.next_refresh_at` | Products due for refresh |
| Failed jobs | DLQ (in-memory + BullMQ) | Jobs that exhausted retries |

### Monitoring API
- `GET /api/v1/monitoring` — Dashboard summary (providers, recent syncs, queue metrics, product counts)
- `GET /api/v1/monitoring/providers` — Detailed provider health
- `GET /api/v1/monitoring/sync-history` — Sync operation log

### Circuit Breaker
- Opens after 5 consecutive failures (`provider_health.status = 'circuit_open'`)
- Tracks `circuit_opened_at` timestamp
- `consecutive_failures` counter resets on success

---

## Adaptive Data Freshness

### Refresh Priority Levels
| Priority | Label | Interval | Use Case |
|----------|-------|----------|----------|
| 1 | Critical | 15 min | High-priority, trending products |
| 2 | High | 1 hour | Popular products |
| 3 | Normal | 6 hours | Standard products |
| 4 | Low | 24 hours | Less popular products |
| 5 | Dormant | 7 days | Rarely viewed products |

### Adaptive Logic
- View count > 1000: interval × 0.5
- View count > 100: interval × 0.75
- Active alerts: minimum 30 min interval
- `getProductsDueForRefresh()` queries products past `next_refresh_at` with status idle/failed
- `markProductRefreshed()` updates freshness and calculates next refresh

---

## Environment Variables

| Variable | Required | Phase | Description |
|----------|----------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | 1 | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | 1 | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | No | 1 | Supabase service role (server) |
| `NEXT_PUBLIC_APP_URL` | No | 1 | App URL |
| `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH` | No | 1 | Enable Google OAuth |
| `REDIS_URL` | No | 2 | Redis for caching + workers |
| `APIFY_API_TOKEN` | No | 2 | Apify API token |
| `APIFY_ACTOR_ID` | No | 2 | Apify actor ID |
| `CLOUDFLARE_R2_ACCOUNT_ID` | No | 2 | R2 account ID |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | No | 2 | R2 access key |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | No | 2 | R2 secret key |
| `CLOUDFLARE_R2_BUCKET` | No | 2 | R2 bucket name |
| `CLOUDFLARE_R2_PUBLIC_BASE_URL` | No | 2 | R2 CDN base URL |
| `AWS_S3_ACCESS_KEY_ID` | No | 2 | S3 access key |
| `AWS_S3_SECRET_ACCESS_KEY` | No | 2 | S3 secret key |
| `AWS_S3_REGION` | No | 2 | S3 region |
| `AWS_S3_BUCKET` | No | 2 | S3 bucket name |
| `AWS_S3_PUBLIC_BASE_URL` | No | 2 | S3 CDN base URL |
| `OPENAI_API_KEY` | No | — | OpenAI (future) |
| `LOG_LEVEL` | No | 1 | Log level |

---

## Folder Structure

```
project/
├── app/
│   ├── api/v1/                       # 29 API routes
│   │   ├── alerts/                   # Alert CRUD
│   │   ├── brands/                   # Brand listing
│   │   ├── cashback/                 # Cashback offers
│   │   ├── categories/              # Category tree
│   │   ├── coupons/                  # Coupon listing
│   │   ├── data/refresh/            # Trigger data fetch
│   │   ├── deals/                    # Deal listing
│   │   ├── feature-flags/           # Feature flags
│   │   ├── health/                  # Health check
│   │   ├── merchants/               # Merchant listing
│   │   ├── monitoring/              # Monitoring dashboard
│   │   │   ├── route.ts
│   │   │   ├── providers/route.ts
│   │   │   └── sync-history/route.ts
│   │   ├── products/                # Product API
│   │   │   ├── route.ts
│   │   │   └── [slug]/
│   │   │       ├── route.ts
│   │   │       ├── deals/route.ts
│   │   │       ├── merchants/route.ts
│   │   │       ├── prices/route.ts
│   │   │       └── reviews/route.ts
│   │   ├── retailers/               # Retailer listing
│   │   └── wishlists/               # Wishlist CRUD
│   ├── auth/callback/
│   ├── dashboard/                   # Protected dashboard
│   ├── forgot-password/
│   ├── sign-in/
│   ├── sign-up/
│   ├── verify-email/
│   ├── error.tsx, layout.tsx, not-found.tsx, page.tsx, globals.css
├── components/
│   ├── layout/                       # Header, footer, sidebar, mobile nav
│   ├── providers/                    # Theme + Auth providers
│   └── ui/                           # 50+ shadcn/ui + custom components
├── features/auth/                    # Auth provider, protected route, use-role
├── hooks/
├── lib/
│   ├── ai/                           # AI provider abstraction
│   ├── api/                          # API foundation (responses, middleware, validation)
│   ├── cache/                        # Redis SWR caching
│   ├── config/                       # Env, app, feature-flags, logger, providers
│   ├── storage/                      # Storage abstraction (R2, S3, Local, SigV4)
│   ├── supabase/                     # Client, server, middleware, types
│   ├── workers/                      # Queue, processors, types (BullMQ + sync)
│   └── utils.ts
├── services/
│   ├── providers/                   # DataProvider abstraction (mock, apify, csv, registry)
│   ├── pipeline/                     # 9-step ingestion pipeline
│   │   ├── validation.ts             # Zod schemas
│   │   ├── normalization.ts         # Provider → internal model
│   │   ├── deduplication.ts         # GTIN + slug dedup
│   │   ├── category-assignment.ts   # Category matching/creation
│   │   ├── brand-detection.ts       # Brand matching/creation
│   │   ├── image-processing.ts      # Image dedup/validation
│   │   ├── ingestion.ts             # Pipeline orchestrator
│   │   └── index.ts
│   ├── alerts.ts                     # Alert CRUD
│   ├── audit-logs.ts                # Audit log service
│   ├── catalog.ts                   # Brands, categories, tags, currencies, countries, languages
│   ├── commerce.ts                  # Merchants, deals, coupons, cashback
│   ├── feature-flags.ts             # Feature flag service
│   ├── freshness.ts                 # Adaptive data freshness
│   ├── monitoring.ts                # Provider health, sync history, queue/cache metrics
│   ├── notifications.ts             # Notification service
│   ├── price-history.ts             # Price history with stats
│   ├── products.ts                  # Product CRUD with caching
│   ├── profiles.ts                  # Profile service
│   ├── retailers.ts                 # Retailer service
│   ├── reviews.ts                   # Review service
│   ├── settings.ts                  # Settings service
│   ├── wishlists.ts                 # Wishlist CRUD
│   └── index.ts                     # Barrel export
├── types/
│   ├── api.ts                        # API response types
│   ├── auth.ts                       # Auth types
│   ├── catalog.ts                    # Enterprise domain types (20+ interfaces)
│   └── index.ts                     # Core domain types
├── middleware.ts
├── next.config.js
├── tailwind.config.ts
├── .prettierrc, .eslintrc.json
└── project-summary.md
```

---

## Architecture Decisions

### ADR-001 through ADR-010 (Phase 1 + Phase 2 Base)
See previous project summary versions for ADRs 1-10 covering Supabase, auth, service layer, feature flags, provider abstraction, rate limiting, GTIN dedup, SWR caching, dual-mode queue, and service-role writes.

### ADR-011: Extended provider type system (Phase 2 Enterprise)
- **Decision**: Support 6 provider types (official_api, affiliate_feed, merchant_upload, csv_import, scraping, mock)
- **Rationale**: Real-world data collection uses multiple channels; each needs different handling but the same interface
- **Alternatives**: Single provider type with configuration flags
- **Trade-offs**: More provider implementations vs. accurate modeling of real data sources

### ADR-012: 9-step ingestion pipeline (Phase 2 Enterprise)
- **Decision**: Every product passes through 9 independent, testable steps
- **Rationale**: Each step can be tested, monitored, and modified independently; failures at any step don't corrupt downstream data
- **Alternatives**: Monolithic ingestion function
- **Trade-offs**: More code vs. testability and observability

### ADR-013: Soft deletes for products, brands, categories (Phase 2 Enterprise)
- **Decision**: Use `deleted_at` column instead of hard deletes
- **Rationale**: Preserves referential integrity for historical price data and audit logs; allows recovery
- **Alternatives**: Hard deletes with CASCADE
- **Trade-offs**: Larger tables vs. data integrity and recoverability

### ADR-014: Circuit breaker in provider_health (Phase 2 Enterprise)
- **Decision**: Track consecutive failures and open circuit after 5
- **Rationale**: Prevents cascading failures when a provider is down; allows graceful degradation
- **Alternatives**: Simple retry without circuit breaker
- **Trade-offs**: May block a recovering provider temporarily vs. system stability

### ADR-015: Adaptive refresh priority (Phase 2 Enterprise)
- **Decision**: 5-level priority system with view-count and alert-based adjustments
- **Rationale**: Popular products need fresher data; dormant products waste resources if refreshed frequently
- **Alternatives**: Fixed refresh interval for all products
- **Trade-offs**: More complex scheduling vs. efficient resource usage

### ADR-016: Storage abstraction with SigV4 (Phase 2 Enterprise)
- **Decision**: Custom SigV4 signing instead of AWS SDK
- **Rationale**: Avoids large SDK dependency; works in Edge runtime; supports both R2 and S3
- **Alternatives**: AWS SDK, presigned URLs via server
- **Trade-offs**: More code to maintain vs. smaller bundle and runtime flexibility

---

## Security Features

- Environment variable validation with fail-fast
- Secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
- RLS on all 25+ database tables
- `auth.uid()` ownership checks for user-scoped tables
- PII masking in structured logger
- Zod validation for all API inputs and pipeline data
- Rate limiting (in-memory, Redis-ready)
- Service-role-only writes for product data
- Provider API keys stored as env var NAMES (not values) in database
- No hardcoded secrets
- Ownership verification on all wishlist/alert mutations
- Review authorship verification

---

## Known Limitations

- No product/shopping UI yet (API endpoints exist, frontend pages come in Phase 3)
- No AI features active (Phase 3+)
- BullMQ and ioredis packages not installed — system falls back to synchronous/in-memory
- No Redis configured — caching uses in-memory LRU fallback
- Apify provider not configured — mock provider is used for all data
- No monitoring dashboard UI (API endpoints exist, admin UI comes later)
- No internationalization implementation (reference data tables ready)
- No PWA implementation
- No adaptive refresh scheduler running (architecture ready, needs cron/worker process)

---

## Recommended Phase 3

**Phase 3: Product Search & User Experience**

Recommended focus:
1. Product search and listing UI (frontend pages with filters, sorting, pagination)
2. Product detail pages with price history charts, reviews, deals, merchant comparisons
3. Price tracking and alert system (user-facing alert management)
4. Category navigation and browsing UI
5. Brand directory and brand-filtered product pages
6. Wishlist management UI
7. Image optimization and CDN-ready architecture
8. Search API with semantic search architecture
9. User dashboard with tracked products, alerts, and recommendations preview
10. Admin monitoring dashboard UI (provider health, sync history, queue metrics)
