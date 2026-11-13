/**
 * Worker processors — the actual work each job type performs.
 *
 * Each processor receives a `JobDefinition` and returns a `JobResult`.
 * Processors are intentionally side-effect heavy: they call external
 * providers, write to the database, and invalidate caches.
 *
 * The processors run on the synchronous in-process queue only
 * (lib/workers/queue.ts). There is no BullMQ package installed —
 * the BullMQ adapter in queue.ts can never load — so no processor
 * ever runs on a BullMQ worker; do not describe this as a
 * BullMQ-backed queue (Sections 21–25, Stage D, item 8).
 */

import { getProviderRegistry, callProviderSearch, callProviderFetch } from '@/services/providers';
import { isNonRetryableProviderError } from '@/services/providers/errors';
import { ingestBatch, validateRawProduct, type ValidatedRawProduct } from '@/services/pipeline';
import { recordDataSourceSync } from '@/services/data-sources';
import { invalidateCache, cacheKey } from '@/lib/cache';
import { invalidateAiForProduct } from '@/lib/cache/ai-invalidation';
// Section 19, Phase 8 (§12 #12) — the `ai.analyze` processor runs
// the expensive visual analysis (BLIP caption + HF embedding +
// catalog vector match). Imported from the service, not the engine
// barrel: the engine's HF providers delegate to these same
// functions, and the processor must not pull the engine in.
import {
  captionPublicImageUrl,
  embedText,
  embedTextClip,
  type HfResult,
} from '@/services/visual-search';
import { logger } from '@/lib/config/logger';
import type { AiAnalyzeJobData, JobDefinition, JobResult } from './types';
// Section 19, Phase 1 (§12 #8) — recordProviderHealth had zero
// live callers; the price.refresh processor reports each provider
// fetch here (best-effort, never throws).
// Sections 21–25, Stage B (B4) — the same reporting now also
// writes sync history (recordSyncHistory had zero callers) and
// stamps data_sources.last_sync_at/status/error, all best-effort.
import {
  reportAiProviderHealth,
  reportProviderSyncHistory,
} from '@/services/ai-engine/health-report';
// Sections 21–25, Stage D — per-merchant pacing on the pipeline
// fetch loop (audit §1 #17): a minimum interval between
// successive fetches to the same provider. (Timeout / transient
// retry / backoff already live in services/providers/call-guard.ts
// via Stage B — this pacer is the missing spacing piece, not a
// second retry layer.)
import { acquireProviderFetchSlot } from '@/services/provider-rate-limits';
import {
  DEFAULT_CURRENCY_CODE,
  validateProviderCurrency,
} from '@/services/refresh-currency';
import { markProductSuccessfullyUpdated } from '@/services/last-successful-update';
import {
  assessPriceChange,
  insertPriceHistoryRow,
  isDuplicatePricePoint,
  PRICE_HISTORY_SOURCES,
  type PriceHistorySource,
} from '@/services/price-history-quality';

/**
 * Sections 21–25, Stage B (B11) — the refresh-leg re-check.
 * `price.refresh` used to trust provider output and insert it
 * straight into price_history; ingest validates with Zod but the
 * refresh leg never did. Same schema, same shape as ingest:
 * a provider row that fails validation is rejected (never
 * inserted) with its field errors. Exported for tests.
 */
export function validateProviderRefreshResult(fresh: unknown):
  | { ok: true; data: ValidatedRawProduct }
  | { ok: false; errors: Record<string, string[]> } {
  const result = validateRawProduct(fresh);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, errors: result.errors };
}

// ---------------------------------------------------------------------------
// Shared history write for the price processors (FINAL 100%, W3, F-P1-33)
// ---------------------------------------------------------------------------

export interface ProcessorPricePointInput {
  productId: string;
  retailerId: string;
  price: number;
  currency: string;
  /** Availability as supplied by the source; 'unknown' when not supplied. */
  availability?: string | null;
  url?: string | null;
  /** Provenance the row may claim; null claims none (never guessed). */
  source?: PriceHistorySource | null;
  /**
   * When the price was observed. An explicit null means
   * "observation time unknown" and is stored as NULL — a re-record
   * must never claim it observed the price "now".
   */
  observedAt?: string | null;
}

export interface ProcessorPricePointResult {
  recorded: boolean;
  /** True when the point was skipped as an unchanged re-record. */
  duplicateSkipped: boolean;
  suspicious: boolean;
  error?: string;
}

/**
 * The ONLY way a worker processor writes a price_history row.
 * Both direct `.insert({…, recorded_at: now()})` calls that used
 * to live here bypassed this: no source, no observed_at, no
 * suspicious assessment, no dedupe. This helper reads the latest
 * recorded point for the (product, retailer) pair, assesses the
 * new point against the last 30, skips an unchanged re-record
 * (same price + same availability), and inserts through
 * `insertPriceHistoryRow` — every row therefore carries source,
 * observed_at and a suspicious flag (or the 42703 legacy retry
 * when migration 057 is unapplied). An invalid price (non-finite
 * or ≤ 0) is rejected, never inserted.
 */
export async function recordProcessorPricePoint(
  supabase: Awaited<ReturnType<typeof getServiceClient>>,
  input: ProcessorPricePointInput
): Promise<ProcessorPricePointResult> {
  if (!Number.isFinite(input.price) || input.price <= 0) {
    return {
      recorded: false,
      duplicateSkipped: false,
      suspicious: false,
      error: `Invalid price for history: ${String(input.price)}`,
    };
  }
  const availability = input.availability ?? 'unknown';
  const nowIso = new Date().toISOString();
  let history: Array<{ price: number; recordedAt: string }> = [];
  let latestAvailability: string | null = null;
  try {
    const { data } = await supabase
      .from('price_history')
      .select('price, availability, recorded_at')
      .eq('product_id', input.productId)
      .eq('retailer_id', input.retailerId)
      .order('recorded_at', { ascending: false })
      .limit(30);
    const rows = (data ?? []) as Array<{
      price: number | string;
      availability?: string | null;
      recorded_at: string;
    }>;
    latestAvailability = rows.length > 0 ? (rows[0].availability ?? null) : null;
    history = rows
      .map((row) => ({
        price: parseFloat(String(row.price)),
        recordedAt: row.recorded_at,
      }))
      .filter((p) => Number.isFinite(p.price));
  } catch {
    history = [];
  }
  if (
    isDuplicatePricePoint(
      history.length > 0
        ? { price: history[0].price, availability: latestAvailability }
        : null,
      input.price,
      availability
    )
  ) {
    return { recorded: false, duplicateSkipped: true, suspicious: false };
  }
  const assessment = assessPriceChange(history, input.price, nowIso);
  if (assessment.suspicious) {
    logger.warn('Processor: suspicious price change flagged', {
      productId: input.productId,
      reasons: assessment.reasons,
    });
  }
  const source: PriceHistorySource | null =
    input.source && (PRICE_HISTORY_SOURCES as readonly string[]).includes(input.source)
      ? input.source
      : null;
  const { error } = await insertPriceHistoryRow(supabase, {
    product_id: input.productId,
    retailer_id: input.retailerId,
    price: input.price,
    currency: input.currency,
    availability,
    url: input.url ?? null,
    recorded_at: nowIso,
    source,
    observed_at: input.observedAt === undefined ? nowIso : input.observedAt,
    suspicious_change: assessment.suspicious,
  });
  if (error) {
    return {
      recorded: false,
      duplicateSkipped: false,
      suspicious: assessment.suspicious,
      error: error.message,
    };
  }
  return { recorded: true, duplicateSkipped: false, suspicious: assessment.suspicious };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lazily create a Supabase service-role client for use inside processors.
 * Uses dynamic imports so that webpack does not try to bundle the
 * service-role key into the browser bundle.
 */
async function getServiceClient() {
  const { createClient } = await import('@supabase/supabase-js');
  const { env } = await import('@/lib/config/env');
  const supabase = createClient(
    env.supabaseUrl,
    env.supabaseServiceRoleKey ?? env.supabaseAnonKey,
    { auth: { persistSession: false } }
  );
  return supabase;
}

// ---------------------------------------------------------------------------
// product.fetch — search a provider and ingest the results
// ---------------------------------------------------------------------------

async function processProductFetch(
  job: JobDefinition
): Promise<JobResult> {
  const data = job.data as any;
  const query: string = data.query;
  const retailerSlug: string | undefined = data.retailerSlug;
  const limit: number = data.limit ?? 50;

  const registry = getProviderRegistry();
  // Sections 21–25, Stage B (B5) — requireForRetailer throws a
  // typed error naming the merchant when no provider is
  // configured for it; there is no silent fallback to another
  // merchant's provider. A config error is a returned failure,
  // never a queue retry (retrying a missing client cannot help).
  let provider: ReturnType<typeof registry.requireForRetailer> | undefined;
  try {
    provider = retailerSlug
      ? registry.requireForRetailer(retailerSlug)
      : registry.getPreferred();
  } catch (err) {
    return {
      success: false,
      processed: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  if (!provider) {
    return {
      success: false,
      processed: 0,
      errors: ['No available provider for product.fetch'],
    };
  }

  // Section 20, §12 #52 — timed provider-health record for the
  // registry-provider search (best-effort; a missing
  // provider_health table or RLS denial never fails the fetch).
  // The client is built lazily and guarded: when no service key
  // is configured there is no client and health is simply not
  // recorded.
  let healthClient: Awaited<ReturnType<typeof getServiceClient>> | null = null;
  try {
    healthClient = await getServiceClient();
  } catch {
    healthClient = null;
  }
  const searchStart = Date.now();
  let results: Awaited<ReturnType<typeof provider.search>> = [];
  let searchError: string | null = null;
  try {
    // Sections 21–25, Stage B (B3/B6/B12) — budget + breaker +
    // 10s timeout + 3 attempts + 100-row cap, via the shared guard.
    results = await callProviderSearch(provider, { query, retailerSlug, limit });
  } catch (err) {
    searchError = err instanceof Error ? err.message : String(err);
    // A config/budget/breaker failure is final: return it, do
    // not throw it into the queue retry loop.
    if (isNonRetryableProviderError(err)) {
      void reportAiProviderHealth(healthClient, provider.key, {
        success: false,
        responseMs: Date.now() - searchStart,
        error: searchError.slice(0, 200),
      });
      return { success: false, processed: 0, errors: [searchError] };
    }
  }
  void reportAiProviderHealth(healthClient, provider.key, {
    success: searchError === null,
    responseMs: Date.now() - searchStart,
    ...(searchError ? { error: searchError.slice(0, 200) } : {}),
  });
  if (searchError) {
    // Preserve the old behaviour: a throwing search propagates
    // to the queue runner (which retries), it is not converted
    // into a returned failure result.
    throw new Error(searchError);
  }
  if (results.length === 0) {
    return { success: true, processed: 0, metadata: { provider: provider.key } };
  }

  const ingestionResults = await ingestBatch(results, provider.key, {
    // Sections 21–25, Stage D (R1) — the search above JUST
    // fetched these rows from the provider: that is the real
    // fetch time the freshness stamp must carry, not the later
    // insert time. Without it ingestion stamped insert-time.
    fetchedAt: new Date().toISOString(),
  });
  const succeeded = ingestionResults.filter((r) => r.success).length;
  const failed = ingestionResults.filter((r) => !r.success);

  // Sections 21–25, Stage B (B4) — this is a REAL provider call
  // with real results, so sync history + the data_sources stamp
  // are written (best-effort; a missing table never fails the fetch).
  void reportProviderSyncHistory(healthClient, {
    providerKey: provider.key,
    syncType: 'product.fetch',
    status: failed.length === 0 ? 'success' : 'partial',
    recordsFetched: results.length,
    recordsInserted: succeeded,
    recordsRejected: failed.length,
    durationMs: Date.now() - searchStart,
  });
  if (healthClient) {
    void recordDataSourceSync(healthClient, provider.key, {
      status: succeeded > 0 ? 'success' : 'failed',
      ...(succeeded > 0 ? {} : { error: 'provider fetch returned no ingestible products' }),
      recordsFetched: results.length,
    });
  }

  return {
    success: true,
    processed: succeeded,
    errors: failed.flatMap((r) => r.errors ?? []),
    metadata: {
      provider: provider.key,
      fetched: results.length,
      rejected: failed.length,
    },
  };
}

// ---------------------------------------------------------------------------
// product.search — search providers (read-only, no ingestion)
// ---------------------------------------------------------------------------

async function processProductSearch(
  job: JobDefinition
): Promise<JobResult> {
  const data = job.data as any;
  const query: string = data.query;
  const retailerSlug: string | undefined = data.retailerSlug;
  const limit: number = data.limit ?? 50;

  const registry = getProviderRegistry();
  // Sections 21–25, Stage B (B5) — no silent cross-merchant
  // fallback: a retailer with no configured provider fails
  // honestly instead of being served another merchant's data.
  let provider: ReturnType<typeof registry.requireForRetailer> | undefined;
  try {
    provider = retailerSlug
      ? registry.requireForRetailer(retailerSlug)
      : registry.getPreferred();
  } catch (err) {
    return {
      success: false,
      processed: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  if (!provider) {
    return {
      success: false,
      processed: 0,
      errors: ['No available provider for product.search'],
    };
  }

  // Sections 21–25, Stage B (B3/B4/B6/B12) — the read-only search
  // goes through the same guard as fetch, and its health is
  // reported too (previously this path wrote no health at all).
  let healthClient: Awaited<ReturnType<typeof getServiceClient>> | null = null;
  try {
    healthClient = await getServiceClient();
  } catch {
    healthClient = null;
  }
  const searchStart = Date.now();
  let results: Awaited<ReturnType<typeof provider.search>> = [];
  try {
    results = await callProviderSearch(provider, { query, retailerSlug, limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void reportAiProviderHealth(healthClient, provider.key, {
      success: false,
      responseMs: Date.now() - searchStart,
      error: message.slice(0, 200),
    });
    if (isNonRetryableProviderError(err)) {
      return { success: false, processed: 0, errors: [message] };
    }
    throw err instanceof Error ? err : new Error(message);
  }
  void reportAiProviderHealth(healthClient, provider.key, {
    success: true,
    responseMs: Date.now() - searchStart,
  });
  return {
    success: true,
    processed: results.length,
    metadata: { provider: provider.key },
  };
}

// ---------------------------------------------------------------------------
// price.update — record a new price point in price_history
// ---------------------------------------------------------------------------

async function processPriceUpdate(
  job: JobDefinition
): Promise<JobResult> {
  const data = job.data as any;

  const supabase = await getServiceClient();
  // FINAL 100% (W3, F-P1-33) — this used to write a raw
  // `.insert({…, recorded_at: now()})` with no source, no
  // observed_at, no suspicious assessment and no dedupe. Every
  // history write now goes through recordProcessorPricePoint.
  // Availability is 'unknown' when the job did not supply one —
  // the old `?? 'in_stock'` asserted stock nobody observed.
  // observed_at is null (unknown): a price.update job carries no
  // observation time, and claiming "now" would invent one.
  const result = await recordProcessorPricePoint(supabase, {
    productId: data.productId,
    retailerId: data.retailerId,
    price: Number(data.price),
    currency: data.currency,
    availability: data.availability ?? 'unknown',
    url: data.url ?? null,
    source: null,
    observedAt: null,
  });

  if (!result.recorded && result.error) {
    return {
      success: false,
      processed: 0,
      errors: [result.error],
    };
  }
  if (result.duplicateSkipped) {
    return {
      success: true,
      processed: 0,
      metadata: { duplicateSkipped: true },
    };
  }

  // Section 19, Phase 8 (§12 #14) — a new price point changes
  // the inputs the AI summary / prediction were computed from, so
  // their cached entries for this product are invalidated
  // (in-memory + stored rows). Best-effort: never fails the job.
  try {
    await invalidateAiForProduct(supabase, data.productId as string);
  } catch {
    // Invalidation is best-effort; the price point was recorded.
  }

  return { success: true, processed: 1 };
}

// ---------------------------------------------------------------------------
// price.refresh — re-fetch the price for a product from its source
// ---------------------------------------------------------------------------

async function processPriceRefresh(
  job: JobDefinition
): Promise<JobResult> {
  const data = job.data as any;
  const productId: string = data.productId;
  const retailerId: string | undefined = data.retailerId;

  const supabase = await getServiceClient();

  // Resolve the product's source(s) to find which provider/retailer to refetch from.
  let sourceQuery = supabase
    .from('product_sources')
    .select('id, product_id, retailer_id, external_id, provider_key, last_fetched_at')
    .eq('product_id', productId);

  if (retailerId) {
    sourceQuery = sourceQuery.eq('retailer_id', retailerId);
  }

  const { data: sources, error } = await sourceQuery;
  if (error || !sources || sources.length === 0) {
    return {
      success: false,
      processed: 0,
      errors: [error?.message ?? 'No product sources found for product'],
    };
  }

  const registry = getProviderRegistry();
  let processed = 0;
  // FINAL 100% (W3, F-P1-33) — re-fetches that confirm an unchanged
  // price record no new history row (dedupe), but they are still
  // successful fetches: they count toward `success` below.
  let duplicatesSkipped = 0;
  const errors: string[] = [];
  // Sections 21–25, Stage D (item 4) — price points recorded
  // with the currency explicitly assumed as USD because the
  // provider reported no usable currency (see the insert below).
  let currencyAssumedUsd = 0;
  // Sections 21–25, Stage B (B4) — aggregate sync reporting for
  // this refresh job: one sync_history row + one data_sources
  // stamp per provider key touched.
  const providersTouched = new Map<string, { attempted: number; succeeded: number; lastError: string | null }>();
  const touchProvider = (key: string, ok: boolean, error?: string) => {
    const entry = providersTouched.get(key) ?? { attempted: 0, succeeded: 0, lastError: null };
    entry.attempted += 1;
    if (ok) entry.succeeded += 1;
    else entry.lastError = error ?? 'provider call failed';
    providersTouched.set(key, entry);
  };

  for (const source of sources) {
    const provider = registry.get(source.provider_key);
    if (!provider) {
      errors.push(`Provider not registered: ${source.provider_key}`);
      continue;
    }

    // Look up the retailer slug for the fetch request.
    const { data: retailer } = await supabase
      .from('retailers')
      .select('slug')
      .eq('id', source.retailer_id)
      .maybeSingle();

    if (!retailer) {
      errors.push(`Retailer not found for source ${source.id}`);
      continue;
    }

    const fetchStart = Date.now();
    let fresh: Awaited<ReturnType<typeof provider.fetch>> | null = null;
    let fetchError: string | null = null;
    try {
      // Sections 21–25, Stage D (item 1) — pace the loop: wait
      // for this provider's slot before fetching, so 100 sources
      // on one provider are spaced instead of fired back-to-back.
      // Best-effort: the pacer never throws, and a pacing failure
      // must not skip the fetch.
      await acquireProviderFetchSlot(provider.key);
      // Sections 21–25, Stage B (B3/B6/B12) — guarded fetch.
      fresh = await callProviderFetch(provider, {
        externalId: source.external_id,
        retailerSlug: retailer.slug,
      });
    } catch (err) {
      fetchError = err instanceof Error ? err.message : String(err);
    }
    // Section 19, Phase 1 (§12 #8, #9) — timed provider-health
    // record for the refresh call site (best-effort; a missing
    // provider_health table or RLS denial never fails the refresh).
    void reportAiProviderHealth(supabase, provider.key, {
      success: fetchError === null && fresh !== null,
      responseMs: Date.now() - fetchStart,
      ...(fetchError
        ? { error: fetchError.slice(0, 200) }
        : fresh === null
          ? { error: 'Provider returned no data' }
          : {}),
    });

    if (fetchError) {
      touchProvider(provider.key, false, fetchError);
      errors.push(`Provider fetch failed for source ${source.id}: ${fetchError}`);
      continue;
    }

    if (!fresh) {
      touchProvider(provider.key, false, 'Provider returned no data');
      errors.push(`Provider returned no data for source ${source.id}`);
      continue;
    }

    // Sections 21–25, Stage B (B11) — re-validate provider
    // output with the same Zod schema as ingest before it is
    // trusted into price_history. A row that fails validation is
    // rejected, never inserted.
    const validated = validateProviderRefreshResult(fresh);
    if (!validated.ok) {
      const detail = Object.entries(validated.errors)
        .map(([field, messages]) => `${field}: ${messages.join('; ')}`)
        .join(' | ');
      touchProvider(provider.key, false, `Provider returned invalid data: ${detail}`);
      errors.push(`Provider returned invalid data for source ${source.id}: ${detail}`);
      void reportAiProviderHealth(supabase, provider.key, {
        success: false,
        responseMs: Date.now() - fetchStart,
        error: `Invalid provider data: ${detail}`.slice(0, 200),
      });
      continue;
    }
    // The Zod-validated row allows null for the optional text
    // fields, but RawProductData only allows `string | undefined`
    // — null means "absent" here, never a stored value, so the
    // nulls are normalised to undefined (same convention as
    // normalizeProduct, which maps them to null for storage).
    const validatedData = validated.data;
    fresh = {
      ...validatedData,
      description: validatedData.description ?? undefined,
      brand: validatedData.brand ?? undefined,
      category: validatedData.category ?? undefined,
      gtin: validatedData.gtin ?? undefined,
      url: validatedData.url ?? undefined,
      // FINAL 100% (W5, F-P1-45): the product modelNumber is
      // `string | null` in the validated row; RawProductData
      // only allows `string | undefined` — same normalization.
      modelNumber: validatedData.modelNumber ?? undefined,
      variants: validatedData.variants?.map((v) => ({
        ...v,
        gtin: v.gtin ?? undefined,
        // FINAL 100% (W5, F-P1-45): the variant modelNumber is
        // `string | null` in the validated row; RawProductData
        // only allows `string | undefined` — same null-means-
        // absent normalization as the other text fields above.
        modelNumber: v.modelNumber ?? undefined,
      })),
    };

    // Record the new price point.
    // Sections 21–25, Stage D (item 4) — the currency is
    // recorded explicitly: a provider row with no usable currency
    // is recorded as USD *and counted* as assumed (see
    // currencyAssumedUsd in the result metadata), never silently
    // treated as USD. No FX conversion is applied here or
    // anywhere in refresh — a non-USD price stays in its native
    // currency.
    const providerCurrency = validateProviderCurrency(fresh.currency);
    const recordedCurrency = providerCurrency ?? DEFAULT_CURRENCY_CODE;
    if (!providerCurrency) currencyAssumedUsd += 1;
    // FINAL 100% (W3, F-P1-33) — this used to write a raw
    // `.insert({…, recorded_at: now()})` with no source, no
    // observed_at, no suspicious assessment and no dedupe. The
    // point arrived through a provider fetch, so its source is
    // 'merchant-feed' and its observed time is the fetch time —
    // never the insert time. An unchanged re-fetch records
    // nothing (duplicateSkipped) but still counts as a successful
    // fetch for this source.
    const historyResult = await recordProcessorPricePoint(supabase, {
      productId,
      retailerId: source.retailer_id,
      price: fresh.price,
      currency: recordedCurrency,
      availability: fresh.availability,
      url: fresh.url ?? null,
      source: 'merchant-feed',
      observedAt: new Date(fetchStart).toISOString(),
    });

    if (historyResult.error) {
      touchProvider(provider.key, false, historyResult.error);
      errors.push(historyResult.error);
    } else if (historyResult.duplicateSkipped) {
      touchProvider(provider.key, true);
      duplicatesSkipped += 1;
      // A re-fetch that confirms the recorded price is a
      // successful update of the record, even with no new point.
      try {
        await markProductSuccessfullyUpdated(supabase, productId);
      } catch {
        // Freshness bookkeeping must never fail the refresh.
      }
    } else {
      touchProvider(provider.key, true);
      processed++;
      // Section 19, Phase 8 (§12 #14) — a new price point was
      // recorded, so the AI cache entries for this product are
      // invalidated (in-memory + stored ai_summaries /
      // ai_predictions rows). Best-effort: never fails the refresh.
      try {
        await invalidateAiForProduct(supabase, productId);
      } catch {
        // Invalidation is best-effort; the price point was recorded.
      }
      // Sections 21–25, Stage D (item 3) — a real provider
      // response was validated and saved: this is a successful
      // update. Best-effort; the writer never throws.
      try {
        await markProductSuccessfullyUpdated(supabase, productId);
      } catch {
        // Freshness bookkeeping must never fail the product.
      }
    }

    // Update the source's last_fetched_at.
    await supabase
      .from('product_sources')
      .update({ last_fetched_at: new Date().toISOString() })
      .eq('id', source.id);
  }

  // Sections 21–25, Stage B (B4) — aggregate sync reporting for
  // this refresh job (best-effort; a missing table never fails it).
  for (const [providerKey, entry] of providersTouched) {
    void reportProviderSyncHistory(supabase, {
      providerKey,
      syncType: 'price.refresh',
      status: entry.succeeded > 0 ? (entry.succeeded === entry.attempted ? 'success' : 'partial') : 'failed',
      recordsFetched: entry.attempted,
      recordsInserted: entry.succeeded,
      recordsRejected: entry.attempted - entry.succeeded,
      ...(entry.lastError ? { errorMessage: entry.lastError.slice(0, 500) } : {}),
    });
    void recordDataSourceSync(supabase, providerKey, {
      status: entry.succeeded > 0 ? 'success' : 'failed',
      ...(entry.succeeded > 0 ? {} : { error: entry.lastError ?? 'provider refresh failed' }),
      recordsFetched: entry.attempted,
    });
  }

  return {
    success: processed > 0 || duplicatesSkipped > 0,
    processed,
    errors: errors.length > 0 ? errors : undefined,
    metadata: { currencyAssumedUsd, duplicatesSkipped },
  };
}

// ---------------------------------------------------------------------------
// product.validate — check data freshness, flag stale products
// ---------------------------------------------------------------------------

async function processProductValidate(
  job: JobDefinition
): Promise<JobResult> {
  const data = job.data as any;
  const productId: string | undefined = data.productId;
  const batchSize: number = data.batchSize ?? 100;

  const supabase = await getServiceClient();
  const now = new Date().toISOString();

  // Products are stale when next_refresh_at is in the past.
  let query = supabase
    .from('products')
    .select('id, name, slug, data_freshness, next_refresh_at, refresh_status')
    .is('deleted_at', null)
    .lt('next_refresh_at', now)
    .limit(batchSize);

  if (productId) {
    query = query.eq('id', productId);
  }

  const { data: stale, error } = await query;
  if (error) {
    return { success: false, processed: 0, errors: [error.message] };
  }

  const staleProducts = stale ?? [];
  if (staleProducts.length === 0) {
    return { success: true, processed: 0, metadata: { stale: 0 } };
  }

  // Flag stale products by updating refresh_status to 'stale'.
  const ids = staleProducts.map((p) => p.id);
  const { error: updateError } = await supabase
    .from('products')
    .update({ refresh_status: 'stale' })
    .in('id', ids);

  if (updateError) {
    return { success: false, processed: 0, errors: [updateError.message] };
  }

  logger.info('product.validate: flagged stale products', {
    count: staleProducts.length,
  });

  return {
    success: true,
    processed: staleProducts.length,
    metadata: { stale: staleProducts.length },
  };
}

// ---------------------------------------------------------------------------
// cache.invalidate — clear cache entries matching a pattern
// ---------------------------------------------------------------------------

async function processCacheInvalidate(
  job: JobDefinition
): Promise<JobResult> {
  const data = job.data as any;
  const pattern: string = data.pattern;

  // The cache layer exposes prefix-based invalidation. Convert a glob-style
  // pattern (e.g. `product:*`) into the namespaced prefix the cache uses.
  // `invalidateCache` matches by `startsWith`, so we strip the trailing `:*`
  // wildcard and invalidate the namespace prefix.
  const normalized = pattern.replace(/:\*$/, '');
  const prefix = normalized.includes(':')
    ? `smartbuy:${normalized}`
    : cacheKey(normalized);

  invalidateCache(prefix);

  return {
    success: true,
    processed: 1,
    metadata: { pattern, prefix },
  };
}

// ---------------------------------------------------------------------------
// data.sync — full sync from a data source (placeholder)
// ---------------------------------------------------------------------------

async function processDataSync(
  job: JobDefinition
): Promise<JobResult> {
  const data = job.data as any;
  const dataSourceId: string = data.dataSourceId;

  const supabase = await getServiceClient();
  const { data: source, error } = await supabase
    .from('data_sources')
    .select('id, provider_id, name, source_type, source_url, schedule_cron, active')
    .eq('id', dataSourceId)
    .maybeSingle();

  if (error || !source) {
    return {
      success: false,
      processed: 0,
      errors: [error?.message ?? `Data source not found: ${dataSourceId}`],
    };
  }

  // Placeholder: full sync logic is implemented in the pipeline service.
  // For now we record that the sync was requested.
  logger.info('data.sync: sync requested (placeholder)', {
    dataSourceId,
    name: source.name,
    sourceType: source.source_type,
  });

  return {
    success: true,
    processed: 0,
    metadata: {
      dataSourceId,
      name: source.name,
      sourceType: source.source_type,
      placeholder: true,
    },
  };
}

// ---------------------------------------------------------------------------
// image.process — process images for a product (placeholder)
// ---------------------------------------------------------------------------

async function processImageProcess(
  job: JobDefinition
): Promise<JobResult> {
  const data = job.data as any;
  const productId: string = data.productId;
  const imageUrls: string[] | undefined = data.imageUrls;

  const supabase = await getServiceClient();

  // If no explicit URLs provided, load the product's stored images.
  let urls = imageUrls;
  if (!urls || urls.length === 0) {
    const { data: images, error } = await supabase
      .from('product_images')
      .select('url')
      .eq('product_id', productId)
      .order('sort_order', { ascending: true });

    if (error) {
      return { success: false, processed: 0, errors: [error.message] };
    }
    urls = (images ?? []).map((i) => i.url);
  }

  if (urls.length === 0) {
    return { success: true, processed: 0, metadata: { productId } };
  }

  // Placeholder: actual image processing (resize, dedupe, validate) is
  // implemented in the pipeline's image-processing module.
  // Section 18, item 40 — this processor does NO work yet, so it
  // must not report any: `processed` is 0 (it used to report
  // `urls.length`, claiming success for work that never happened).
  // `success: true` means only "the placeholder ran without
  // error"; `placeholder: true` says no processing happened.
  logger.info('image.process: processing requested (placeholder)', {
    productId,
    count: urls.length,
  });

  return {
    success: true,
    processed: 0,
    metadata: { productId, placeholder: true },
  };
}

// ---------------------------------------------------------------------------
// ai.analyze — expensive AI visual analysis (Section 19, Phase 8, §12 #12)
// ---------------------------------------------------------------------------

interface AiAnalyzeMatch {
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
  similarity: number;
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205';
}

/**
 * Run one embedding-space RPC (`match_clip_products` or
 * `match_products`) and normalise the result, mirroring the
 * visual-search route's contract: a missing table is a setup
 * problem the caller can recognise (never thrown), any other
 * failure is reported as an error.
 */
async function matchEmbeddingRpcForJob(
  supabase: Awaited<ReturnType<typeof getServiceClient>>,
  rpcName: string,
  vector: number[],
  limit: number
): Promise<
  | { ok: true; matches: Array<{ product_id: string; similarity: number }> }
  | { ok: false; missingTable: boolean; error: string }
> {
  const { data, error } = await supabase.rpc(rpcName, {
    query_embedding: vector,
    match_count: limit,
  });
  if (error) {
    return {
      ok: false,
      missingTable: isMissingTableError(error),
      error: error.message ?? 'Vector match failed.',
    };
  }
  const matches = (Array.isArray(data) ? data : []) as Array<{
    product_id: string;
    similarity: number;
  }>;
  return { ok: true, matches };
}

/**
 * The `ai.analyze` processor — the single most expensive AI
 * analysis (visual caption + embedding + catalog vector match),
 * run as a job on the existing queue instead of inline in a
 * request. It mirrors the visual-search route's CLIP → MiniLM
 * fallback exactly (CLIP first when the CLIP table has rows, then
 * MiniLM on any CLIP-side failure or zero matches).
 *
 * RETRY CONTRACT — honours the `retryable` flag (§12 #6, #55):
 * the queue only retries a job when the processor THROWS, so a
 * retryable HF failure (503 model loading, 429, network/timeout)
 * is thrown, and the queue retries it with exponential backoff
 * (up to `attempts`, then DLQ). A non-retryable failure (401/403
 * bad token, bad input, missing embeddings table) is RETURNED as
 * `{ success: false }` — never retried, never DLQ'd. 401/403 are
 * never retried, by construction: `hfErrorMessage` marks them
 * `retryable: false`, so they take the return path.
 *
 * RESULT STORAGE — no new table and no new migration: the outcome
 * (caption, embedding space, matched products) is returned in
 * `JobResult.metadata` and read back via `getJobResult(jobId)`
 * (last 100 jobs, this instance), exactly like the other
 * synchronous jobs. As a side effect the caption + embedding land
 * in the §12 #11 visual-search cache, so the next live
 * visual-search request for the same image is a cache hit and
 * spends no HF budget.
 */
async function processAiAnalyze(job: JobDefinition): Promise<JobResult> {
  const data = job.data as AiAnalyzeJobData;
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : '';
  const captionInput = typeof data.caption === 'string' ? data.caption.trim() : '';
  const limit = Math.min(Math.max(Math.floor(data.limit ?? 5) || 5, 1), 10);

  if (!imageUrl && !captionInput) {
    return {
      success: false,
      processed: 0,
      errors: ['ai.analyze needs an imageUrl or a caption.'],
    };
  }

  // 1. Caption the image (BLIP via HF) — or use the supplied caption.
  let caption = captionInput;
  let captionCached = false;
  if (imageUrl) {
    const captioned: HfResult<string> = await captionPublicImageUrl(imageUrl);
    if (!captioned.ok) {
      if (captioned.retryable) throw new Error(captioned.error);
      return { success: false, processed: 0, errors: [captioned.error] };
    }
    caption = captioned.value;
    captionCached = captioned.cached === true;
  }

  const supabase = await getServiceClient();

  // 2. CLIP table check (mirror the visual-search route): the CLIP
  // space is preferred only when the table actually has rows.
  const { count: clipCount, error: clipCountError } = await supabase
    .from('product_clip_embeddings')
    .select('product_id', { count: 'exact', head: true });
  const preferClip = data.preferClip !== false && !clipCountError && !!clipCount && clipCount > 0;

  // 3. Embed + match, CLIP first, MiniLM fallback. Each embed
  // failure follows the same retry contract as the caption: a
  // retryable HF error throws (queue retries), a non-retryable one
  // returns a failed result.
  const embedOrThrow = async (
    useClip: boolean
  ): Promise<{ vector: number[]; space: 'clip' | 'minilm'; cached: boolean }> => {
    const embedded: HfResult<number[]> = useClip
      ? await embedTextClip(caption)
      : await embedText(caption);
    if (!embedded.ok) {
      if (embedded.retryable) throw new Error(embedded.error);
      const error = new Error(embedded.error) as Error & { retryable?: boolean };
      error.retryable = false;
      throw error;
    }
    return {
      vector: embedded.value,
      space: useClip ? 'clip' : 'minilm',
      cached: embedded.cached === true,
    };
  };

  let embedded: { vector: number[]; space: 'clip' | 'minilm'; cached: boolean };
  let fallbackUsed = false;
  try {
    embedded = await embedOrThrow(preferClip);
  } catch (err) {
    // A non-retryable embed failure carries retryable: false —
    // return it as a failed result instead of letting the queue
    // retry it. A retryable failure (no flag, or retryable true)
    // re-throws so the queue retries with backoff.
    if ((err as { retryable?: unknown })?.retryable === false) {
      return {
        success: false,
        processed: 0,
        errors: [err instanceof Error ? err.message : 'Embedding failed.'],
      };
    }
    throw err;
  }

  let matched = await matchEmbeddingRpcForJob(
    supabase,
    embedded.space === 'clip' ? 'match_clip_products' : 'match_products',
    embedded.vector,
    limit
  );
  if (!matched.ok) {
    if (matched.missingTable) {
      return {
        success: false,
        processed: 0,
        errors: [
          'Product embeddings are not set up yet. An admin needs to run supabase/add-visual-embeddings.sql and the backfill once (see docs/visual-search.md).',
        ],
      };
    }
    return { success: false, processed: 0, errors: [matched.error] };
  }

  // CLIP matched nothing (or the CLIP RPC failed non-fatally) —
  // fall through to MiniLM, exactly like the route.
  if (embedded.space === 'clip' && matched.matches.length === 0) {
    try {
      embedded = await embedOrThrow(false);
    } catch (err) {
      if ((err as { retryable?: unknown })?.retryable === false) {
        return {
          success: false,
          processed: 0,
          errors: [err instanceof Error ? err.message : 'Embedding failed.'],
        };
      }
      throw err;
    }
    fallbackUsed = true;
    matched = await matchEmbeddingRpcForJob(
      supabase,
      'match_products',
      embedded.vector,
      limit
    );
    if (!matched.ok) {
      if (matched.missingTable) {
        return {
          success: false,
          processed: 0,
          errors: [
            'Product embeddings are not set up yet. An admin needs to run supabase/add-visual-embeddings.sql and the backfill once (see docs/visual-search.md).',
          ],
        };
      }
      return { success: false, processed: 0, errors: [matched.error] };
    }
  }

  if (matched.matches.length === 0) {
    return {
      success: true,
      processed: 0,
      metadata: {
        caption,
        mode: embedded.space === 'clip' ? 'vector-clip' : 'vector',
        fallbackUsed,
        captionCached,
        embedCached: embedded.cached,
        matches: [],
        note: 'No matches yet — the catalog has no product embeddings. An admin needs to run the backfill once (see docs/visual-search.md).',
      },
    };
  }

  // Enrich the RPC matches with product rows (deleted products are
  // skipped, never invented). Prices are deliberately NOT loaded
  // here — the job result is the match list; the live route loads
  // the lowest recorded price at request time.
  const ids = matched.matches.map((m) => m.product_id);
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, slug, name, brand')
    .in('id', ids)
    .neq('slug', 'sample-laptop')
    .is('deleted_at', null);
  if (productsError) {
    return { success: false, processed: 0, errors: [productsError.message] };
  }
  const byId = new Map(
    ((products ?? []) as Array<{ id: string; slug: string; name: string; brand: string | null }>).map(
      (p) => [p.id, p]
    )
  );
  const results: AiAnalyzeMatch[] = [];
  for (const match of matched.matches) {
    const product = byId.get(match.product_id);
    if (!product) continue;
    results.push({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      similarity: Math.round(match.similarity * 1000) / 1000,
    });
  }

  return {
    success: true,
    processed: results.length,
    metadata: {
      caption,
      mode: embedded.space === 'clip' ? 'vector-clip' : 'vector',
      fallbackUsed,
      captionCached,
      embedCached: embedded.cached,
      matches: results,
    },
  };
}

// ---------------------------------------------------------------------------
// Processor registry
// ---------------------------------------------------------------------------

export const processors: Record<
  string,
  (job: JobDefinition) => Promise<JobResult>
> = {
  'product.fetch': processProductFetch,
  'product.search': processProductSearch,
  'price.update': processPriceUpdate,
  'price.refresh': processPriceRefresh,
  'product.validate': processProductValidate,
  'cache.invalidate': processCacheInvalidate,
  'data.sync': processDataSync,
  'image.process': processImageProcess,
  'ai.analyze': processAiAnalyze,
};
