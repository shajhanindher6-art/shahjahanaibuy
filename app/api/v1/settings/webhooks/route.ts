/**
 * WhatsApp & Telegram webhook settings API + generic outbound
 * webhook channel (Section 6, item 16).
 * GET  /api/v1/settings/webhooks — configuration status only (never sends).
 * POST /api/v1/settings/webhooks — save the user's channel prefs.
 *
 * Both endpoints are honest about the migrations: if the owner has not
 * run supabase/add-alert-webhooks.sql yet, GET reports
 * migrationApplied=false and POST refuses with a plain message instead
 * of failing opaquely. The generic channel needs migration 033
 * (generic_webhook_url / generic_webhook_secret_hash on
 * user_settings); its status is reported separately as
 * genericMigrationApplied. No secret is ever returned: only booleans.
 * A generic webhook secret is stored SHA-256 hashed only (same
 * pattern as lib/api-keys.ts) and is never stored or returned raw.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, apiError, unauthorized, internalError, badRequest } from '@/lib/api/responses';
import { env } from '@/lib/config/env';
import { rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logger } from '@/lib/config/logger';
import { hashGenericWebhookSecret, GENERIC_WEBHOOK_SECRET_MIN_LENGTH } from '@/lib/generic-webhook';

import { logApiError } from '@/lib/api/error-logging';
const WEBHOOK_COLUMNS = [
  'whatsapp_enabled',
  'whatsapp_phone',
  'telegram_enabled',
  'telegram_chat_id',
] as const;

const GENERIC_WEBHOOK_COLUMNS = [
  'generic_webhook_url',
  'generic_webhook_secret_hash',
] as const;

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`settings.webhooks:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorized('Sign in to view webhook settings.');

    // Section 18, item 30 — select('*') is INTENTIONALLY kept
    // here: the `c in row` migration checks below must see a column
    // as present exactly when its migration added it, including
    // PARTIALLY-applied states (only one of the two webhook
    // migrations run). An explicit list would 42703-fail the whole
    // select when any listed column is missing and misreport both
    // migrations as unapplied. This is the one row-returning
    // select('*') the audit's column-list pass deliberately leaves.
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error || !data) {
      // No row (or a read error): report not-configured, never crash.
      return apiSuccess({
        migrationApplied: false,
        genericMigrationApplied: false,
        whatsapp: { enabled: false, destinationSet: false, ownerConfigured: Boolean(env.whatsappAccessToken && env.whatsappPhoneNumberId && env.whatsappTemplateName), state: 'migration_not_run' },
        telegram: { enabled: false, destinationSet: false, ownerConfigured: Boolean(env.telegramBotToken), state: 'migration_not_run' },
        generic: { urlSet: false, secretSet: false, state: 'migration_not_run' },
      });
    }
    const row = data as Record<string, unknown>;
    const migrationApplied = WEBHOOK_COLUMNS.every((c) => c in row);
    const genericMigrationApplied = GENERIC_WEBHOOK_COLUMNS.every((c) => c in row);
    const waEnabled = row.whatsapp_enabled === true;
    const tgEnabled = row.telegram_enabled === true;
    const waOwner = Boolean(env.whatsappAccessToken && env.whatsappPhoneNumberId && env.whatsappTemplateName);
    const tgOwner = Boolean(env.telegramBotToken);
    const genericUrlSet = Boolean(row.generic_webhook_url);
    const genericSecretSet = Boolean(row.generic_webhook_secret_hash);
    return apiSuccess({
      migrationApplied,
      genericMigrationApplied,
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
      generic: {
        urlSet: genericUrlSet,
        secretSet: genericSecretSet,
        state: !genericMigrationApplied
          ? 'migration_not_run'
          : genericUrlSet
            ? 'ready'
            : 'not_configured',
      },
    });
  } catch (err) {
    logApiError(err, { request, route: 'settings.webhooks.get', status: 500 });
    logger.error('webhooks GET failed', { error: String(err) });
    return internalError('Failed to load webhook status.');
  }
}

export async function POST(request: NextRequest) {
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`settings.webhooks:${getClientIp(request)}`, 30);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorized('Sign in to save webhook settings.');

    const body = (await request.json()) as Record<string, unknown>;

    // Generic channel (Section 6, item 16). The URL is the user's
    // own endpoint; the secret is hashed before storage and never
    // returned. Absent fields leave the stored value unchanged, so
    // a WhatsApp/Telegram-only save can never wipe the generic URL.
    let genericUrl: string | null | undefined;
    let genericSecretHash: string | null | undefined;
    if ('genericWebhookUrl' in body) {
      const raw = typeof body.genericWebhookUrl === 'string' ? body.genericWebhookUrl.trim() : '';
      if (raw !== '' && !isValidHttpUrl(raw)) {
        return badRequest('genericWebhookUrl must be a valid http(s) URL.');
      }
      genericUrl = raw === '' ? null : raw;
    }
    if ('genericWebhookSecret' in body) {
      const raw = typeof body.genericWebhookSecret === 'string' ? body.genericWebhookSecret : '';
      if (raw !== '') {
        if (raw.length < GENERIC_WEBHOOK_SECRET_MIN_LENGTH) {
          return badRequest(
            `genericWebhookSecret must be at least ${GENERIC_WEBHOOK_SECRET_MIN_LENGTH} characters.`
          );
        }
        // Hash only — the raw secret is never stored, logged or returned.
        genericSecretHash = hashGenericWebhookSecret(raw);
      }
      // Empty string = leave the stored hash unchanged (the card
      // never sends the saved secret back, so a blank must not clear
      // it). There is deliberately no "clear secret" path here.
    }

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
    if (genericUrl !== undefined) updateData.generic_webhook_url = genericUrl;
    if (genericSecretHash !== undefined) {
      updateData.generic_webhook_secret_hash = genericSecretHash;
    }
    const { error } = await supabase
      .from('user_settings')
      .update(updateData)
      .eq('user_id', user.id);
    if (error) {
      // Most likely cause: a migration has not been run, so the
      // columns do not exist. Say that plainly instead of a generic 500.
      logger.warn('webhooks POST failed', { error: error.message });
      return apiError(
        'SERVICE_UNAVAILABLE',
        'Webhook settings are not live yet — the owner still needs to run supabase/add-alert-webhooks.sql once (WhatsApp/Telegram) and migration 033 once (generic webhook channel).',
        503
      );
    }
    return apiSuccess({ saved: true, genericSecretSet: genericSecretHash !== undefined });
  } catch (err) {
    logApiError(err, { request, route: 'settings.webhooks.post', status: 500 });
    logger.error('webhooks POST failed', { error: String(err) });
    return internalError('Failed to save webhook settings.');
  }
}
