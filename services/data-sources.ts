/**
 * Section 20, §12 #58 — data_sources / providers population for the
 * CSV provider (code side only).
 *
 * The `data_sources` and `product_sources` tables existed as
 * schema-only: zero rows, and nothing ever wrote them. The two
 * halves are populated by different paths:
 *
 *   - `product_sources` rows are written by the pipeline itself:
 *     `services/pipeline/ingestion.ts` (`upsertProductSource`)
 *     upserts one row per ingested product, keyed by
 *     (retailer_id, external_id) with `provider_key`. Once the
 *     CsvProvider is registered (services/providers/registry.ts)
 *     and a CSV source is configured, a product.fetch through it
 *     populates product_sources with provider_key='csv' — no extra
 *     code needed here.
 *   - `data_sources` rows need a `providers` row first
 *     (provider_id FK). `ensureCsvDataSource` below is the
 *     admin/config path for that half: it upserts the `providers`
 *     row (key='csv') and the `data_sources` row for the
 *     configured CSV URL, idempotently. It is called best-effort
 *     from the admin POST /api/v1/data/refresh route when
 *     CSV_SOURCE_URL is set — never on a public path, never
 *     auto-creating a source the owner did not configure.
 *
 * Fail-safe throughout: any DB error returns 'skipped' (logged),
 * never throws, never blocks the refresh that called it. Until
 * the owner sets CSV_SOURCE_URL, nothing calls this helper and
 * both tables stay honestly empty.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

export type EnsureCsvDataSourceResult = 'created' | 'exists' | 'skipped';

export interface CsvDataSourceConfig {
  /** Public CSV file URL (the same value as CSV_SOURCE_URL). */
  sourceUrl: string;
  /** Display name for the data_sources row. */
  name?: string;
}

/**
 * Record the configured CSV source in `providers` + `data_sources`.
 * Idempotent: a second call with the same URL returns 'exists'
 * without inserting a duplicate row. Never throws.
 */
export async function ensureCsvDataSource(
  supabase: AnySupabaseClient,
  config: CsvDataSourceConfig
): Promise<EnsureCsvDataSourceResult> {
  const sourceUrl = config.sourceUrl.trim();
  if (!sourceUrl) return 'skipped';
  try {
    // providers row first (data_sources.provider_id is an FK).
    const { data: provider, error: providerError } = await supabase
      .from('providers')
      .select('id')
      .eq('key', 'csv')
      .maybeSingle();
    let providerId = (provider as { id: string } | null)?.id ?? null;
    if (providerError) {
      logger.warn('ensureCsvDataSource: providers lookup failed', {
        error: providerError.message,
      });
      return 'skipped';
    }
    if (!providerId) {
      const { data: created, error: createError } = await supabase
        .from('providers')
        .upsert(
          {
            key: 'csv',
            name: 'CSV Provider',
            type: 'csv_import',
            base_url: sourceUrl,
            active: true,
          },
          { onConflict: 'key' }
        )
        .select('id')
        .single();
      if (createError || !created) {
        logger.warn('ensureCsvDataSource: providers upsert failed', {
          error: createError?.message,
        });
        return 'skipped';
      }
      providerId = (created as { id: string }).id;
    }

    const { data: existing, error: existingError } = await supabase
      .from('data_sources')
      .select('id')
      .eq('provider_id', providerId)
      .eq('source_url', sourceUrl)
      .maybeSingle();
    if (existingError) {
      logger.warn('ensureCsvDataSource: data_sources lookup failed', {
        error: existingError.message,
      });
      return 'skipped';
    }
    if (existing) return 'exists';

    const { error: insertError } = await supabase.from('data_sources').insert({
      provider_id: providerId,
      name: config.name ?? 'CSV product feed',
      source_type: 'csv',
      source_url: sourceUrl,
      active: true,
    });
    if (insertError) {
      logger.warn('ensureCsvDataSource: data_sources insert failed', {
        error: insertError.message,
      });
      return 'skipped';
    }
    return 'created';
  } catch (err) {
    logger.warn('ensureCsvDataSource: unexpected failure', {
      error: String(err),
    });
    return 'skipped';
  }
}
