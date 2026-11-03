-- ============================================================================
-- SmartBuy AI — WhatsApp & Telegram alert webhook preferences
-- OWNER: run this ONCE in the Supabase SQL editor (Ctrl+A, then Run).
-- Idempotent: every statement is guarded, so re-running is safe.
--
-- What it adds (all nullable / defaulted — existing rows are untouched):
--   user_settings.whatsapp_enabled  boolean, default false
--   user_settings.whatsapp_phone    text, nullable (E.164-ish, country code)
--   user_settings.telegram_enabled  boolean, default false
--   user_settings.telegram_chat_id  text, nullable
--
-- Until this runs, the settings hub reports "setup not live yet" and
-- refuses saves with a plain message — it never crashes and never
-- pretends webhooks work. No provider credentials live here: those are
-- server env vars only (WHATSAPP_*, TELEGRAM_BOT_TOKEN).
-- ============================================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_phone text,
  ADD COLUMN IF NOT EXISTS telegram_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS telegram_chat_id text;

-- Verify (the SQL editor shows only the last statement's result):
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'user_settings'
  AND column_name IN ('whatsapp_enabled', 'whatsapp_phone', 'telegram_enabled', 'telegram_chat_id')
ORDER BY column_name;
