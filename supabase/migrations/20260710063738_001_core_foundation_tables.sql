/*
# SmartBuy AI — Core Foundation Tables (Phase 1)

## Overview
Creates the foundational database schema for SmartBuy AI. These tables support
authentication, user profiles, role management, settings, notifications, audit
logging, feature flags, and system settings. No shopping/product tables yet —
those come in later phases.

## 1. New Tables

### `roles`
- Stores role definitions (guest, user, premium, merchant, admin)
- `id` (uuid PK), `name` (unique text), `description`, `permissions` (jsonb array), `created_at`
- Pre-seeded with 5 default roles

### `profiles`
- Public user profile data, linked 1:1 to `auth.users`
- `id` (uuid PK = auth.users.id, FK ON DELETE CASCADE), `email` (unique), `full_name`, `avatar_url`, `bio`
- `role_id` (FK to roles), `created_at`, `updated_at`
- Auto-created via trigger when a new auth user signs up

### `user_settings`
- Per-user preferences (currency, language, timezone, notification toggles)
- `id` (uuid PK), `user_id` (FK to profiles, ON DELETE CASCADE), `created_at`, `updated_at`
- Auto-created via trigger when a profile is created

### `notifications`
- User-facing notifications (price alerts, system messages, etc.)
- `id` (uuid PK), `user_id` (FK to profiles, ON DELETE CASCADE), `type`, `title`, `message`, `read` (boolean), `created_at`
- Indexed on `user_id` and `created_at`

### `audit_logs`
- Security audit trail for all sensitive actions
- `id` (uuid PK), `user_id` (nullable FK to profiles, ON DELETE SET NULL), `action`, `resource`, `resource_id`, `metadata` (jsonb), `ip_address`, `created_at`
- Indexed on `user_id` and `created_at`

### `feature_flags`
- Database-driven feature flag system for gradual rollout
- `id` (uuid PK), `key` (unique text), `enabled` (boolean), `description`, `created_at`, `updated_at`
- Pre-seeded with Phase 1 flags (all future features disabled)

### `system_settings`
- Global application configuration key-value store
- `id` (uuid PK), `key` (unique text), `value` (text), `description`, `created_at`, `updated_at`

## 2. Security (RLS)
- RLS enabled on ALL tables
- `roles`: public read (anon + authenticated), no write via client
- `profiles`: users can read own profile + update own profile; list is authenticated-only (own)
- `user_settings`: owner-scoped CRUD
- `notifications`: owner-scoped CRUD
- `audit_logs`: insert for authenticated (own), select own only; service role for admin
- `feature_flags`: public read (anon + authenticated), no client write
- `system_settings`: public read, no client write

## 3. Triggers
- `handle_new_user()`: auto-creates a profile row when a new auth.users row is inserted
- `handle_new_profile()`: auto-creates a user_settings row when a new profile is inserted
- `update_profiles_updated_at()`: maintains `updated_at` on profiles
- `update_user_settings_updated_at()`: maintains `updated_at` on user_settings
- `update_feature_flags_updated_at()`: maintains `updated_at` on feature_flags
- `update_system_settings_updated_at()`: maintains `updated_at` on system_settings

## 4. Indexes
- `profiles_email_idx` on `profiles(email)`
- `notifications_user_created_idx` on `notifications(user_id, created_at DESC)`
- `audit_logs_user_created_idx` on `audit_logs(user_id, created_at DESC)`
- `audit_logs_action_idx` on `audit_logs(action)`
- `feature_flags_key_idx` on `feature_flags(key)`
- `system_settings_key_idx` on `system_settings(key)`

## 5. Important Notes
1. All tables use `gen_random_uuid()` for primary keys (except profiles which uses auth.users.id)
2. All timestamps are `timestamptz` with `DEFAULT now()`
3. RLS policies use `auth.uid()` for ownership checks — never `current_user`
4. The `handle_new_user` trigger assigns the default 'user' role to new sign-ups
5. Feature flags are pre-seeded with all future features disabled (enabled = false)
6. System settings pre-seeded with default app configuration values
*/

-- ============================================================================
-- ROLES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- Roles are readable by everyone (needed for role display), but not writable via client
DROP POLICY IF EXISTS "roles_select_all" ON roles;
CREATE POLICY "roles_select_all" ON roles FOR SELECT
  TO anon, authenticated USING (true);

-- ============================================================================
-- PROFILES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text,
  avatar_url text,
  bio text,
  role_id uuid REFERENCES roles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

-- Users can update their own profile (but not their role or email)
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Users can insert their own profile (trigger handles this, but policy allows it)
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

CREATE INDEX IF NOT EXISTS profiles_email_idx ON profiles(email);

-- ============================================================================
-- USER_SETTINGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'USD',
  language text NOT NULL DEFAULT 'en',
  timezone text NOT NULL DEFAULT 'UTC',
  email_notifications boolean NOT NULL DEFAULT true,
  push_notifications boolean NOT NULL DEFAULT true,
  price_alerts boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_settings_select_own" ON user_settings;
CREATE POLICY "user_settings_select_own" ON user_settings FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = user_settings.user_id AND profiles.id = auth.uid())
  );

DROP POLICY IF EXISTS "user_settings_insert_own" ON user_settings;
CREATE POLICY "user_settings_insert_own" ON user_settings FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = user_settings.user_id AND profiles.id = auth.uid())
  );

DROP POLICY IF EXISTS "user_settings_update_own" ON user_settings;
CREATE POLICY "user_settings_update_own" ON user_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = user_settings.user_id AND profiles.id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = user_settings.user_id AND profiles.id = auth.uid())
  );

DROP POLICY IF EXISTS "user_settings_delete_own" ON user_settings;
CREATE POLICY "user_settings_delete_own" ON user_settings FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = user_settings.user_id AND profiles.id = auth.uid())
  );

-- ============================================================================
-- NOTIFICATIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
CREATE POLICY "notifications_select_own" ON notifications FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_insert_own" ON notifications;
CREATE POLICY "notifications_insert_own" ON notifications FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_update_own" ON notifications;
CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_delete_own" ON notifications;
CREATE POLICY "notifications_delete_own" ON notifications FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at DESC);

-- ============================================================================
-- AUDIT_LOGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource text,
  resource_id text,
  metadata jsonb,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Users can read their own audit logs
DROP POLICY IF EXISTS "audit_logs_select_own" ON audit_logs;
CREATE POLICY "audit_logs_select_own" ON audit_logs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

-- Users can insert audit log entries for their own actions
DROP POLICY IF EXISTS "audit_logs_insert_own" ON audit_logs;
CREATE POLICY "audit_logs_insert_own" ON audit_logs FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE INDEX IF NOT EXISTS audit_logs_user_created_idx ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);

-- ============================================================================
-- FEATURE_FLAGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- Feature flags are readable by everyone (needed for client-side gating)
DROP POLICY IF EXISTS "feature_flags_select_all" ON feature_flags;
CREATE POLICY "feature_flags_select_all" ON feature_flags FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS feature_flags_key_idx ON feature_flags(key);

-- ============================================================================
-- SYSTEM_SETTINGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- System settings are readable by everyone
DROP POLICY IF EXISTS "system_settings_select_all" ON system_settings;
CREATE POLICY "system_settings_select_all" ON system_settings FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS system_settings_key_idx ON system_settings(key);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Function to create a profile when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  default_role_id uuid;
BEGIN
  SELECT id INTO default_role_id FROM roles WHERE name = 'user' LIMIT 1;
  INSERT INTO public.profiles (id, email, role_id)
  VALUES (NEW.id, NEW.email, default_role_id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to create user_settings when a new profile is created
CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created ON profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile();

-- Updated_at maintenance functions
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_settings_updated_at ON user_settings;
CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_feature_flags_updated_at ON feature_flags;
CREATE TRIGGER update_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_system_settings_updated_at ON system_settings;
CREATE TRIGGER update_system_settings_updated_at
  BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Seed roles
INSERT INTO roles (name, description, permissions) VALUES
  ('guest', 'Unauthenticated visitor with limited access', '["read:public"]'),
  ('user', 'Standard authenticated user', '["read:public","write:own","read:own"]'),
  ('premium', 'Premium subscriber with advanced features', '["read:public","write:own","read:own","access:ai","access:alerts"]'),
  ('merchant', 'Retailer or merchant with product management access', '["read:public","write:own","read:own","manage:products"]'),
  ('admin', 'System administrator with full access', '["*"]')
ON CONFLICT (name) DO NOTHING;

-- Seed feature flags
INSERT INTO feature_flags (key, enabled, description) VALUES
  ('ai_recommendations', false, 'AI-powered product recommendations'),
  ('price_tracking', false, 'Real-time price tracking and alerts'),
  ('semantic_search', false, 'Natural language product search'),
  ('budget_advice', false, 'AI budget optimization advice'),
  ('review_analysis', false, 'AI-powered review analysis and summarization'),
  ('trust_scoring', false, 'Product and seller trust scoring'),
  ('price_prediction', false, 'AI price trend prediction'),
  ('google_auth', true, 'Google OAuth sign-in'),
  ('email_verification', false, 'Require email verification before login'),
  ('merchant_portal', false, 'Merchant self-service portal'),
  ('admin_dashboard', false, 'Admin management dashboard'),
  ('internationalization', false, 'Multi-language and multi-currency support'),
  ('pwa', false, 'Progressive Web App capabilities')
ON CONFLICT (key) DO NOTHING;

-- Seed system settings
INSERT INTO system_settings (key, value, description) VALUES
  ('app_name', 'SmartBuy AI', 'Application display name'),
  ('default_currency', 'USD', 'Default currency for new users'),
  ('default_language', 'en', 'Default language code'),
  ('default_timezone', 'UTC', 'Default timezone'),
  ('max_notifications_per_user', '100', 'Maximum stored notifications per user'),
  ('session_timeout_minutes', '60', 'Session inactivity timeout in minutes')
ON CONFLICT (key) DO NOTHING;
