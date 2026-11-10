/**
 * Multi-language product descriptions (Section 3, item 15).
 *
 * Translation infrastructure only: translations live in the
 * `product_translations` table (migration 029) and the table starts
 * EMPTY — every product is "not translated yet" until a real
 * translation is recorded. Nothing here writes a translation the
 * author cannot verify, and nothing here machine-translates silently.
 *
 * SOURCES (stored per row, shown in the UI):
 * - 'professional' — a human professional translation.
 * - 'community-verified' — a community translation checked by an admin.
 * - 'auto' — machine output. ALWAYS labeled "Auto-translated — may
 *   contain errors", never presented as perfect or verified.
 *
 * PROVIDER (pluggable, env-gated, dormant by default):
 * No translation API key exists for this project, so there is no live
 * provider. `getTranslationProvider()` returns null unless BOTH
 * TRANSLATION_PROVIDER_ENDPOINT and TRANSLATION_PROVIDER_API_KEY are
 * set in the server environment; when set, it POSTs { text, target }
 * to the endpoint and expects { translatedText: string } back. The
 * endpoint is the owner's choice (any JSON translation API) — the
 * interface is deliberately provider-agnostic, and no provider is
 * hard-coded, endorsed, or called without the owner's keys.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { SUPPORTED_LANGUAGES, type Language } from '@/lib/region';

export type TranslationField = 'name' | 'description';

export type TranslationSource = 'professional' | 'community-verified' | 'auto';

export interface ProductTranslation {
  productId: string;
  language: Language;
  field: TranslationField;
  text: string;
  source: TranslationSource;
}

/** Languages a description can be translated into (English is the source). */
export const TRANSLATABLE_LANGUAGES: Language[] = SUPPORTED_LANGUAGES.filter(
  (code) => code !== 'en'
);

export function isTranslatableLanguage(value: string): value is Language {
  return (TRANSLATABLE_LANGUAGES as string[]).includes(value);
}

/**
 * UI label for a translation's source. Machine output is always
 * called out as auto-translated — never "verified" or "perfect".
 */
export function translationSourceLabel(source: TranslationSource): string {
  switch (source) {
    case 'professional':
      return 'Professionally translated';
    case 'community-verified':
      return 'Community translation, verified by SmartBuy';
    case 'auto':
      return 'Auto-translated — may contain errors';
  }
}

function sanitizeLanguage(value: unknown): Language | null {
  if (typeof value !== 'string') return null;
  return (SUPPORTED_LANGUAGES as string[]).includes(value) ? (value as Language) : null;
}

function sanitizeField(value: unknown): TranslationField | null {
  return value === 'name' || value === 'description' ? value : null;
}

function sanitizeSource(value: unknown): TranslationSource | null {
  return value === 'professional' || value === 'community-verified' || value === 'auto'
    ? value
    : null;
}

interface TranslationRow {
  product_id: string;
  language_code: string;
  field: string;
  translated_text: string;
  source: string;
}

function mapTranslation(row: TranslationRow): ProductTranslation | null {
  const language = sanitizeLanguage(row.language_code);
  const field = sanitizeField(row.field);
  const source = sanitizeSource(row.source);
  if (!language || !field || !source) return null;
  if (typeof row.translated_text !== 'string' || row.translated_text.trim() === '') return null;
  return {
    productId: row.product_id,
    language,
    field,
    text: row.translated_text,
    source,
  };
}

/**
 * Fail-safe read of one translation. Returns null when the row does
 * not exist, when the table does not exist yet (migration 029 not
 * run), or on any error — callers render "Not translated yet".
 * Never throws.
 */
export async function getProductTranslation(
  supabase: AnySupabaseClient,
  productId: string,
  language: Language,
  field: TranslationField
): Promise<ProductTranslation | null> {
  try {
    const { data, error } = await supabase
      .from('product_translations')
      .select('product_id, language_code, field, translated_text, source')
      .eq('product_id', productId)
      .eq('language_code', language)
      .eq('field', field)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logger.warn('getProductTranslation: query failed (029 may not be run)', {
          error: error.message,
        });
      }
      return null;
    }
    return mapTranslation(data as TranslationRow);
  } catch (err) {
    logger.warn('getProductTranslation: unexpected error', { error: String(err) });
    return null;
  }
}

/**
 * Fail-safe read of every recorded translation for one product.
 * Returns [] when none exist or the table is missing. Never throws.
 */
export async function getProductTranslations(
  supabase: AnySupabaseClient,
  productId: string
): Promise<ProductTranslation[]> {
  try {
    const { data, error } = await supabase
      .from('product_translations')
      .select('product_id, language_code, field, translated_text, source')
      .eq('product_id', productId)
      .order('language_code', { ascending: true });
    if (error || !data) {
      if (error) {
        logger.warn('getProductTranslations: query failed (029 may not be run)', {
          error: error.message,
        });
      }
      return [];
    }
    const out: ProductTranslation[] = [];
    for (const row of data as TranslationRow[]) {
      const mapped = mapTranslation(row);
      if (mapped) out.push(mapped);
    }
    return out;
  } catch (err) {
    logger.warn('getProductTranslations: unexpected error', { error: String(err) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pluggable machine-translation provider (env-gated, dormant by default)
// ---------------------------------------------------------------------------

export interface TranslationProvider {
  /** Translate text into `target`. Returns null on any failure. */
  translate(text: string, target: Language): Promise<{ text: string; source: 'auto' } | null>;
}

/**
 * Provider configuration from the server environment only. Returns
 * null (dormant) unless BOTH variables are set — no key, no calls,
 * no silent fallback to a hard-coded service.
 */
export function getTranslationProviderConfig(): {
  endpoint: string;
  apiKey: string;
} | null {
  const endpoint = process.env.TRANSLATION_PROVIDER_ENDPOINT?.trim();
  const apiKey = process.env.TRANSLATION_PROVIDER_API_KEY?.trim();
  if (!endpoint || !apiKey) return null;
  return { endpoint, apiKey };
}

/**
 * The configured provider, or null when none is configured. The
 * provider POSTs { text, target } and expects { translatedText }.
 * Any non-200 response, bad shape, or empty result is a null —
 * never a partial or guessed translation.
 */
export function getTranslationProvider(): TranslationProvider | null {
  const config = getTranslationProviderConfig();
  if (!config) return null;
  return {
    async translate(text: string, target: Language) {
      try {
        const res = await fetch(config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({ text, target }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return null;
        const data = (await res.json().catch(() => null)) as {
          translatedText?: unknown;
        } | null;
        if (!data || typeof data.translatedText !== 'string' || data.translatedText.trim() === '') {
          return null;
        }
        return { text: data.translatedText, source: 'auto' };
      } catch {
        return null;
      }
    },
  };
}
