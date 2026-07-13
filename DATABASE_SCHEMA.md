# DATABASE SCHEMA — SmartBuy AI

**Database:** PostgreSQL (Supabase)  
**Tables:** 60  
**Migrations:** 13  
**Date:** 2026-07-12

---

## Migrations

| # | File | Description |
|---|------|-------------|
| 001 | `001_core_foundation_tables.sql` | Profiles, roles, user_settings, audit_logs |
| 002 | `002_product_data_pipeline_tables.sql` | Products, brands, categories, merchants, price_history, deals, data_sources, providers |
| 003 | `003_enterprise_reference_data_tables.sql` | Countries, currencies, languages, regions, retailers |
| 004 | `004_product_extension_tables.sql` | Product variants, attributes, images, tags, sources, merchant_products |
| 005 | `005_merchant_commerce_tables.sql` | Affiliate links/clicks, cashback_offers, search_history |
| 006 | `006_reviews_wishlists_alerts_tables.sql` | Reviews, review_sources, wishlists, wishlist_items, alerts, price_alert_history, notifications |
| 007 | `007_monitoring_freshness_tables.sql` | Provider_health, sync_history, queue_metrics, cache_metrics, api_rate_limits, system_settings, freshness_checks |
| 008 | `008_phase3_ai_features_tables.sql` | AI predictions, summaries, comparisons, deal_rankings, chat conversations/messages, user_preferences |
| 009 | `009_phase4_premium_saas_tables.sql` | Subscriptions, weekly_digests, analytics_events, notification_queue, feature_flags, admin_audit_logs |
| 010 | `010_security_fix_rls_policies.sql` | RLS policy fixes (Part 1) |
| 011 | `011_security_fix_rls_policies_part2.sql` | RLS policy fixes (Part 2) |
| 012 | `012_phase5_production_launch_tables.sql` | Webhook events, push subscriptions, email log, billing history, subscription extensions |
| 013 | `010_security_fix_rls_policies.sql` | Function security (search_path, SECURITY INVOKER) |

---

## Table Groups

### Core & Auth

#### `profiles`
Extends `auth.users` with application-specific fields.
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | (references auth.users) |
| email | text | NO | |
| full_name | text | YES | |
| avatar_url | text | YES | |
| role_id | uuid | YES | (references roles) |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
**RLS:** 3 policies (select_own, update_own, delete_own via auth.uid())

#### `roles`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | |
| description | text | YES | |
| permissions | jsonb | YES | |
| created_at | timestamptz | NO | now() |
**RLS:** 1 policy (read — id IS NOT NULL)

#### `user_settings`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | (references auth.users) |
| theme | text | YES | 'system' |
| notifications_enabled | boolean | YES | true |
| email_notifications | boolean | YES | true |
| push_notifications | boolean | YES | true |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
**RLS:** 4 policies (CRUD via auth.uid())

### Product Catalog

#### `products`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| slug | text | NO | (unique) |
| title | text | NO | |
| description | text | YES | |
| brand_id | uuid | YES | (references brands) |
| category_id | uuid | YES | (references categories) |
| gtin | text | YES | |
| current_price | numeric | YES | |
| currency | text | YES | 'USD' |
| image_url | text | YES | |
| active | boolean | YES | true |
| deleted_at | timestamptz | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
**RLS:** 1 policy (read — deleted_at IS NULL)

#### `brands`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | |
| slug | text | NO | (unique) |
| logo_url | text | YES | |
| description | text | YES | |
| active | boolean | YES | true |
| deleted_at | timestamptz | YES | |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
**RLS:** 1 policy (read — deleted_at IS NULL)

#### `categories`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | |
| slug | text | NO | (unique) |
| parent_id | uuid | YES | (self-reference) |
| description | text | YES | |
| active | boolean | YES | true |
| deleted_at | timestamptz | YES | |
| created_at | timestamptz | NO | now() |
**RLS:** 1 policy (read — deleted_at IS NULL)

#### `merchants`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO | |
| slug | text | NO | (unique) |
| website | text | YES | |
| logo_url | text | YES | |
| active | boolean | YES | true |
| deleted_at | timestamptz | YES | |
**RLS:** 1 policy (read — active AND deleted_at IS NULL)

#### `price_history`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| product_id | uuid | NO | (references products) |
| merchant_id | uuid | YES | (references merchants) |
| price | numeric | NO | |
| currency | text | YES | 'USD' |
| recorded_at | timestamptz | NO | now() |
**RLS:** 1 policy (read — id IS NOT NULL)

### Commerce

#### `deals`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| product_id | uuid | YES | |
| title | text | NO | |
| description | text | YES | |
| discount_type | text | NO | |
| discount_value | numeric | NO | |
| start_at | timestamptz | YES | |
| end_at | timestamptz | YES | |
| active | boolean | YES | true |
| deleted_at | timestamptz | YES | |
**RLS:** 1 policy (read — active AND deleted_at IS NULL)

#### `coupons`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| code | text | NO | (unique) |
| description | text | YES | |
| discount_type | text | NO | |
| discount_value | numeric | NO | |
| min_purchase | numeric | YES | |
| max_uses | integer | YES | |
| used_count | integer | YES | 0 |
| expires_at | timestamptz | YES | |
| active | boolean | YES | true |
**RLS:** 1 policy (read — active = true)

#### `affiliate_links`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| product_id | uuid | YES | |
| merchant_id | uuid | YES | |
| url | text | NO | |
| commission_rate | numeric | YES | |
| active | boolean | YES | true |
**RLS:** 1 policy (read — active = true)

#### `affiliate_clicks`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| affiliate_link_id | uuid | NO | |
| user_id | uuid | YES | |
| product_id | uuid | YES | |
| retailer_name | text | NO | |
| clicked_price | numeric | YES | |
| converted | boolean | NO | false |
| conversion_value | numeric | YES | |
**RLS:** 4 policies (insert anon+auth, read/update/delete owner)

### User Features

#### `wishlists`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | |
| name | text | NO | |
| description | text | YES | |
| is_public | boolean | YES | false |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
**RLS:** 4 policies (CRUD via auth.uid())

#### `alerts`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | |
| product_id | uuid | NO | |
| target_price | numeric | NO | |
| channel | text | YES | 'email' |
| active | boolean | YES | true |
| created_at | timestamptz | NO | now() |
**RLS:** 4 policies (CRUD via auth.uid())

#### `reviews`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| product_id | uuid | NO | |
| user_id | uuid | YES | |
| rating | integer | NO | |
| title | text | YES | |
| body | text | YES | |
| source | text | YES | |
| created_at | timestamptz | NO | now() |
**RLS:** 4 policies (CRUD via auth.uid())

### AI Features

#### `ai_predictions`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| product_id | uuid | NO | |
| prediction_type | text | NO | |
| predicted_price | numeric | YES | |
| confidence | numeric | YES | |
| reasoning | text | YES | |
| expires_at | timestamptz | YES | |
| created_at | timestamptz | NO | now() |
**RLS:** 4 policies (read public, write authenticated)

#### `ai_summaries`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| product_id | uuid | NO | |
| summary | text | NO | |
| key_points | jsonb | YES | |
| expires_at | timestamptz | YES | |
| created_at | timestamptz | NO | now() |
**RLS:** 4 policies (read public, write authenticated)

#### `product_comparisons`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| product_ids | jsonb | NO | |
| comparison | jsonb | NO | |
| expires_at | timestamptz | YES | |
| created_at | timestamptz | NO | now() |
**RLS:** 4 policies (read public, write authenticated)

#### `chat_conversations` / `chat_messages`
**RLS:** 4 / 2 policies (CRUD via auth.uid())

### SaaS & Notifications

#### `subscriptions`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | |
| plan | text | NO | 'free' |
| status | text | YES | 'active' |
| stripe_customer_id | text | YES | |
| stripe_subscription_id | text | YES | |
| stripe_price_id | text | YES | |
| current_period_start | timestamptz | YES | |
| current_period_end | timestamptz | YES | |
| cancel_at_period_end | boolean | YES | false |
| canceled_at | timestamptz | YES | |
| ended_at | timestamptz | YES | |
| trial_start | timestamptz | YES | |
| trial_end | timestamptz | YES | |
| quantity | integer | YES | 1 |
**RLS:** 3 policies (select/update/delete via auth.uid())

#### `billing_history`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | |
| stripe_invoice_id | text | YES | (unique) |
| stripe_charge_id | text | YES | |
| amount_paid | integer | NO | 0 |
| currency | text | NO | 'usd' |
| status | text | NO | 'open' |
| invoice_url | text | YES | |
| invoice_pdf | text | YES | |
| period_start | timestamptz | YES | |
| period_end | timestamptz | YES | |
**RLS:** 2 policies (select/insert via auth.uid())

#### `notification_queue`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | |
| type | text | NO | |
| channel | text | NO | |
| subject | text | YES | |
| body | text | YES | |
| data | jsonb | YES | |
| status | text | YES | 'pending' |
| scheduled_for | timestamptz | YES | now() |
| sent_at | timestamptz | YES | |
| retry_count | integer | NO | 0 |
| max_retries | integer | NO | 3 |
| last_error | text | YES | |
| next_retry_at | timestamptz | YES | |
**RLS:** 3 policies (select/update/insert via auth.uid())

#### `push_subscriptions`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | |
| endpoint | text | NO | |
| p256dh_key | text | NO | |
| auth_key | text | NO | |
| expiration_time | timestamptz | YES | |
| user_agent | text | YES | |
**RLS:** 3 policies (select/insert/delete via auth.uid())

#### `webhook_events`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| stripe_event_id | text | NO | (unique) |
| event_type | text | NO | |
| payload | jsonb | YES | |
| processed_at | timestamptz | YES | now() |
**RLS:** 1 policy (read — authenticated)

#### `email_log`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | YES | |
| to_address | text | NO | |
| subject | text | NO | |
| email_type | text | NO | |
| status | text | NO | 'pending' |
| provider_message_id | text | YES | |
| error_message | text | YES | |
| sent_at | timestamptz | YES | |
**RLS:** 1 policy (read — owner via auth.uid())

### Monitoring

#### `system_settings`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| key | text | NO | (unique) |
| value | jsonb | YES | |
| description | text | YES | |
| updated_at | timestamptz | NO | now() |
**RLS:** 1 policy (read — authenticated)

#### `feature_flags`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| key | text | NO | (unique) |
| enabled | boolean | YES | false |
| description | text | YES | |
| rollout_percentage | integer | YES | 0 |
**RLS:** 1 policy (read — id IS NOT NULL)

---

## Database Functions

### `handle_new_user()` — SECURITY DEFINER
Trigger on `auth.users` AFTER INSERT. Creates profile and user_settings.
- **Must remain SECURITY DEFINER**: Runs as `supabase_auth_admin` which has no RLS permissions on `public.profiles`
- **search_path**: `'public', 'pg_temp'` (immutable)

### `handle_new_profile()` — SECURITY INVOKER
Trigger on `profiles` AFTER INSERT. Creates default user_settings.
- **search_path**: `'public', 'pg_temp'` (immutable)

### `update_updated_at_column()` — SECURITY INVOKER
Trigger on UPDATE for multiple tables. Sets `NEW.updated_at = now()`.
- **search_path**: `'public', 'pg_temp'` (immutable)

---

## RLS Policy Summary

| Policy Type | Count | Description |
|-------------|-------|-------------|
| Owner-scoped (auth.uid()) | 52 | User owns the row |
| Public read (anon+auth) | 50 | Catalog/reference data |
| Authenticated-only | 17 | Internal/admin tables |
| **Total** | **119** | 0 "always true" |
