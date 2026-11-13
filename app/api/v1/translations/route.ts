/**
 * API v1 translations endpoint (Section 3, item 15).
 *
 * GET /api/v1/translations?productId=<uuid>&language=<code>&field=name|description
 *   — one recorded translation, or { translation: null, status:
 *   'not-translated' } when none is recorded. The table starts empty
 *   (migration 029); "not translated yet" is the normal honest state.
 * GET /api/v1/translations?productId=<uuid>
 *   — every recorded translation for the product.
 * POST /api/v1/translations — admin only. Body: { productId,
 *   language, field, text, source }. Stores a translation an admin
 *   verified. source 'auto' is machine output and is always labeled
 *   "Auto-translated" in the UI — never presented as perfect.
 *
 * No machine translation happens here: there is no translation API
 * key, and the pluggable provider (lib/product-translations.ts) is
 * dormant without one. This route stores what a human provides.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import {
  logApiRequest,
  rateLimitResponse,
  getClientIp,
  requireAdmin,
} from '@/lib/api/middleware';
import {
  getProductTranslation,
  getProductTranslations,
  isTranslatableLanguage,
  type TranslationField,
  type TranslationSource,
} from '@/lib/product-translations';

import { logApiError } from '@/lib/api/error-logging';
// Live DB data must never be served from a stale edge cache.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'translations' });

  const limited = await rateLimitResponse(`translations:${getClientIp(request)}`, 60);
  if (limited) return limited;

  try {
    const { searchParams } = request.nextUrl;
    const productId = searchParams.get('productId');
    const languageRaw = searchParams.get('language');
    const fieldRaw = searchParams.get('field');

    if (!productId) {
      return badRequest('productId is required.');
    }

    const supabase = await createSupabaseServerClient();

    if (languageRaw !== null || fieldRaw !== null) {
      if (!languageRaw || !isTranslatableLanguage(languageRaw)) {
        return badRequest('language must be one of ur, de, fr, es, it, pt, tr.');
      }
      if (fieldRaw !== 'name' && fieldRaw !== 'description') {
        return badRequest('field must be "name" or "description".');
      }
      const translation = await getProductTranslation(
        supabase,
        productId,
        languageRaw,
        fieldRaw as TranslationField
      );
      return apiSuccess({
        translation,
        status: translation ? 'translated' : 'not-translated',
      });
    }

    const translations = await getProductTranslations(supabase, productId);
    return apiSuccess({ translations, count: translations.length });
  } catch (err) {
    logApiError(err, { request, route: 'translations.get', status: 500 });
    return internalError('Failed to load translations');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'translations' });

  const limited = await rateLimitResponse(`translations-write:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const admin = await requireAdmin(request);
  if ('error' in admin) return admin.error;

  try {
    const body = await request.json().catch(() => null);
    const productId = typeof body?.productId === 'string' ? body.productId.trim() : '';
    const language = typeof body?.language === 'string' ? body.language.trim() : '';
    const field = typeof body?.field === 'string' ? body.field.trim() : '';
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const source = typeof body?.source === 'string' ? body.source.trim() : '';

    if (!productId) return badRequest('productId is required.');
    if (!isTranslatableLanguage(language)) {
      return badRequest('language must be one of ur, de, fr, es, it, pt, tr.');
    }
    if (field !== 'name' && field !== 'description') {
      return badRequest('field must be "name" or "description".');
    }
    if (!text) return badRequest('text is required.');
    if (text.length > 5000) return badRequest('text must be 5000 characters or fewer.');
    const validSources: TranslationSource[] = ['professional', 'community-verified', 'auto'];
    if (!(validSources as string[]).includes(source)) {
      return badRequest('source must be "professional", "community-verified", or "auto".');
    }

    const service = createSupabaseServiceClient();
    if (!service) return internalError('Translation storage unavailable');

    const { data, error } = await service
      .from('product_translations')
      .upsert(
        {
          product_id: productId,
          language_code: language,
          field,
          translated_text: text,
          source,
        },
        { onConflict: 'product_id,language_code,field' }
      )
      .select('product_id, language_code, field, translated_text, source')
      .single();

    if (error) {
      return internalError('Failed to save translation');
    }
    return apiSuccess({ translation: data }, 201);
  } catch (err) {
    logApiError(err, { request, route: 'translations.post', status: 500 });
    return internalError('Failed to save translation');
  }
}
