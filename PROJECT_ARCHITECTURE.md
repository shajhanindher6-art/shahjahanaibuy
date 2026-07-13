# PROJECT ARCHITECTURE — SmartBuy AI

**Version:** 1.0.0  
**Date:** 2026-07-12

---

## Overview

SmartBuy AI is an AI-powered shopping intelligence SaaS platform that helps users find the best prices, track product prices over time, compare products, receive deal alerts, and get AI-powered recommendations.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 13.5.1 (App Router) |
| Language | TypeScript 5.2.2 |
| Database | PostgreSQL (Supabase) |
| Auth | Supabase Auth (email/password) |
| Payments | Stripe (Subscriptions) |
| Email | Resend |
| Push | Web Push API (VAPID) |
| UI | React 18, Tailwind CSS, shadcn/ui, Radix UI |
| Charts | Recharts |
| Icons | Lucide React |
| Deployment | Netlify |

---

## Directory Structure

```
project/
├── app/                    # Next.js App Router
│   ├── (public)/          # Public pages (home, search, deals, compare)
│   ├── dashboard/         # Authenticated user dashboard
│   ├── admin/             # Admin panel
│   ├── api/               # API routes (57 routes)
│   │   └── v1/            # Versioned API
│   ├── auth/              # Auth callback
│   └── *.tsx              # Layout, error, not-found, sitemap, robots
├── components/
│   ├── ui/                # shadcn/ui components (40+)
│   ├── layout/            # Headers, footers, navigation
│   ├── products/          # Price chart
│   ├── providers/         # Theme provider
│   └── pwa/               # Service worker registration
├── features/
│   └── auth/              # Auth provider, protected route, role hook
├── services/              # Business logic (24 service modules)
│   ├── pipeline/          # Data ingestion pipeline
│   └── providers/         # Data provider integrations
├── lib/
│   ├── api/               # API helpers (responses, middleware, validation)
│   ├── config/            # Environment, app config, logger, feature flags
│   ├── supabase/          # Supabase client (browser, server, middleware)
│   ├── workers/           # Background job queue (BullMQ-ready)
│   ├── cache/             # Caching layer
│   └── stripe.ts          # Stripe client
├── hooks/                 # Custom React hooks
├── types/                 # TypeScript type definitions
├── extension/             # Browser extension (Chrome/Firefox)
├── public/                # Static assets (manifest, SW, robots)
├── supabase/migrations/   # 13 SQL migrations
└── docs/                  # Documentation
```

---

## Architecture Layers

### 1. Presentation Layer (App Router)
- **Server Components**: Product detail page (`/products/[slug]`) uses SSR for SEO
- **Client Components**: Dashboard pages use `'use client'` for interactivity
- **Layout**: Root layout with metadata, manifest, theme color, JSON-LD
- **Error Handling**: `error.tsx` (client), `global-error.tsx` (root), `not-found.tsx`

### 2. API Layer (`app/api/`)
- **Versioned**: All routes under `/api/v1/`
- **Consistent**: Every route uses `apiSuccess`/`apiError` response helpers
- **Auth**: `requireAuth()` middleware returns discriminated union
- **Validation**: Zod schemas via `validateBody<T>`
- **Rate Limiting**: In-memory token bucket per IP
- **Logging**: `logApiRequest()` on every route

### 3. Service Layer (`services/`)
- **24 service modules** covering: products, catalog, commerce, reviews, wishlists, alerts, AI (search, summary, predictions, comparison, recommendations, deals), notifications, email, push, stripe, health, monitoring, admin, chat, affiliate, profiles, settings, user-preferences, alert-history, freshness, feature-flags, audit-logs
- **Data Pipeline**: Ingestion → Validation → Normalization → Brand Detection → Category Assignment → Deduplication → Image Processing
- **Provider Pattern**: Registry-based data provider system (Apify, CSV, Mock)

### 4. Data Layer (Supabase)
- **60 tables** with RLS on every table
- **119 RLS policies** (0 "always true")
- **3 database functions** (all with immutable search_path)
- **13 migrations** applied sequentially

### 5. Infrastructure Layer
- **Middleware**: Supabase session refresh on every request, auth-gated routes
- **Workers**: Job queue with BullMQ support (graceful fallback to sync)
- **Caching**: Cache abstraction with provider registry
- **PWA**: Service worker with stale-while-revalidate, push handlers

---

## Authentication Flow

```
User → /sign-up → Supabase Auth → Trigger: handle_new_user() → INSERT profiles
                                                          → Trigger: handle_new_profile() → INSERT user_settings
User → /sign-in → Supabase Auth → Session cookie → onAuthStateChange → AuthProvider context
User → /dashboard → Middleware (updateSession) → ProtectedRoute → Dashboard
User → /sign-out → supabase.auth.signOut() → Session cleared → Redirect to /
```

## Payment Flow

```
User → /dashboard/billing → Click "Upgrade" → POST /api/v1/subscriptions/checkout
  → Stripe Checkout Session → User pays on Stripe → Redirect to /dashboard/billing?status=success
  → Stripe sends webhook → POST /api/webhooks/stripe → processWebhookEvent()
  → Sync subscription → Send confirmation email → Record billing history
```

## Notification Flow

```
Trigger (alert/digest) → queueNotification() → INSERT notification_queue (status=pending)
  → Cron: POST /api/v1/notifications/process → processNotificationQueue()
  → dispatchNotification() → sendEmail() or sendPushNotification()
  → Success: UPDATE status=sent | Failure: UPDATE retry_count++ (with backoff)
```

---

## Database Schema Overview

### Core (Migration 001)
- `profiles` — User profiles (extends auth.users)
- `roles` — Role definitions (guest, user, pro, admin)
- `user_settings` — Per-user settings
- `audit_logs` — System audit trail

### Product Data (Migrations 002-004)
- `products`, `product_variants`, `product_attributes`, `product_images`, `product_tags`, `product_sources`
- `brands`, `categories`, `tags`, `regions`, `countries`, `currencies`, `languages`
- `merchants`, `merchant_products`, `retailers`, `price_history`
- `deals`, `coupons`, `cashback_offers`
- `reviews`, `review_sources`
- `data_sources`, `providers`, `product_views`

### Commerce (Migration 005)
- `affiliate_links`, `affiliate_clicks`
- `search_history`

### User Features (Migration 006)
- `wishlists`, `wishlist_items`
- `alerts`, `price_alert_history`
- `notifications`

### Monitoring (Migration 007)
- `provider_health`, `sync_history`, `queue_metrics`, `cache_metrics`
- `api_rate_limits`, `system_settings`
- `freshness_checks`

### AI Features (Migration 008)
- `ai_predictions`, `ai_summaries`, `product_comparisons`, `deal_rankings`
- `chat_conversations`, `chat_messages`
- `user_preferences`

### SaaS (Migration 009)
- `subscriptions`, `weekly_digests`, `analytics_events`
- `notification_queue`, `feature_flags`
- `admin_audit_logs`

### Phase 5 Extensions (Migration 012)
- `webhook_events`, `push_subscriptions`, `email_log`, `billing_history`
- Extended `subscriptions` (quantity, trial dates, cancellation tracking)
- Extended `notification_queue` (retry tracking)

---

## Performance Architecture

- **Image Optimization**: Next.js Image with AVIF/WebP, restricted remote patterns
- **Package Optimization**: `optimizePackageImports` for lucide-react tree-shaking
- **Code Splitting**: Dynamic imports for optional providers (Resend, web-push, Sentry)
- **Service Worker**: Stale-while-revalidate for images, network-first for pages
- **Bundle Size**: 79.5 kB shared JS (optimized)
- **Font**: Self-hosted Inter via `next/font/google` with CSS variable

---

## Security Architecture

- **RLS**: Every table has Row Level Security with meaningful policies
- **Auth**: Supabase Auth with session cookies, middleware refresh
- **Authorization**: Role-based (guest=0, user=1, pro=2, admin=3) via `useRole` hook
- **API Security**: requireAuth, rate limiting, Zod validation, consistent error responses
- **Webhook Security**: Stripe signature verification, idempotency table
- **PII Masking**: Logger redacts sensitive fields (password, token, secret, key, etc.)
- **Security Headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **Service Role**: Only used server-side, never exposed to browser
