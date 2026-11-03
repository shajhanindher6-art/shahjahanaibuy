/**
 * WhatsApp & Telegram webhook settings API.
 * GET  /api/v1/settings/webhooks — configuration status only (never sends).
 * POST /api/v1/settings/webhooks — save the user's channel prefs.
 *
 * Both endpoints are honest about the migration: if the owner has not
 * run supabase/add-alert-webhooks.sql yet, GET reports
 * migrationApplied=false and POST refuses with a plain message instead
 * of failing opaquely. No secret is ever returned: only booleans.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, apiError, unauthorized, internalError } from '@/lib/api/responses';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/config/logger';

const WEBHOOK_COLUMNS = [
  'whatsapp_enabled',
  'whatsapp_phone',
  'telegram_enabled',
  'telegram_chat_id',
] as const;

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorized('Sign in to view webhook settings.');

    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error || !data) {
      // No row (or a read error): report not-configured, never crash.
      return apiSuccess({
        migrationApplied: false,
        whatsapp: { enabled: false, destinationSet: false, ownerConfigured: Boolean(env.whatsappAccessToken && env.whatsappPhoneNumberId && env.whatsappTemplateName), state: 'migration_not_run' },
        telegram: { enabled: false, destinationSet: false, ownerConfigured: Boolean(env.telegramBotToken), state: 'migration_not_run' },
      });
    }
    const row = data as Record<string, unknown>;
    const migrationApplied = WEBHOOK_COLUMNS.every((c) => c in row);
    const waEnabled = row.whatsapp_enabled === true;
    const tgEnabled = row.telegram_enabled === true;
    const waOwner = Boolean(env.whatsappAccessToken && env.whatsappPhoneNumberId && env.whatsappTemplateName);
    const tgOwner = Boolean(env.telegramBotToken);
    return apiSuccess({
      migrationApplied,
      whatsapp: {
        enabled: waEnabled,
        destinationSet: Boolean(row.whatsapp_phone),
        ownerConfigured: waOwner,
        state: !migrationApplied
          ? 'migration_not_run'
          : waEnabled && row.whatsapp_phone && waOwner
            ? 'ready'
            : 'not_configured',
      },
      telegram: {
        enabled: tgEnabled,
        destinationSet: Boolean(row.telegram_chat_id),
        ownerConfigured: tgOwner,
        state: !migrationApplied
          ? 'migration_not_run'
          : tgEnabled && row.telegram_chat_id && tgOwner
            ? 'ready'
            : 'not_configured',
      },
    });
  } catch (err) {
    logger.error('webhooks GET failed', { error: String(err) });
    return internalError('Failed to load webhook status.');
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorized('Sign in to save webhook settings.');

    const body = (await request.json()) as Record<string, unknown>;
    const updateData: Record<string, unknown> = {
      whatsapp_enabled: body.whatsappEnabled === true,
      whatsapp_phone:
        typeof body.whatsappPhone === 'string' && body.whatsappPhone.trim() !== ''
          ? body.whatsappPhone.trim()
          : null,
      telegram_enabled: body.telegramEnabled === true,
      telegram_chat_id:
        typeof body.telegramChatId === 'string' && body.telegramChatId.trim() !== ''
          ? body.telegramChatId.trim()
          : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('user_settings')
      .update(updateData)
      .eq('user_id', user.id);
    if (error) {
      // Most likely cause: the migration has not been run, so the
      // columns do not exist. Say that plainly instead of a generic 500.
      logger.warn('webhooks POST failed', { error: error.message });
      return apiError(
        'SERVICE_UNAVAILABLE',
        'Webhook settings are not live yet — the owner still needs to run supabase/add-alert-webhooks.sql once.',
        503
      );
    }
    return apiSuccess({ saved: true });
  } catch (err) {
    logger.error('webhooks POST failed', { error: String(err) });
    return internalError('Failed to save webhook settings.');
  }
}
