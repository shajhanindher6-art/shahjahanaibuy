/**
 * Worker processors — the actual work each job type performs.
 *
 * Each processor receives a `JobDefinition` and returns a `JobResult`.
 * Processors are intentionally side-effect heavy: they call external
 * providers, write to the database, and invalidate caches.
 *
 * The processors are shared between the synchronous queue (in-process)
 * and the BullMQ queue (Redis-backed), so they must be pure of queue
 * infrastructure concerns.
 */

import { getProviderRegistry } from '@/services/providers';
import { ingestBatch } from '@/services/pipeline';
import { invalidateCache, cacheKey } from '@/lib/cache';
import { logger } from '@/lib/config/logger';
import type { JobDefinition, JobResult } from './types';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = job.data as any;
  const query: string = data.query;
  const retailerSlug: string | undefined = data.retailerSlug;
  const limit: number = data.limit ?? 50;

  const registry = getProviderRegistry();
  const provider = retailerSlug
    ? registry.getForRetailer(retailerSlug)
    : registry.getPreferred();

  if (!provider) {
    return {
      success: false,
      processed: 0,
      errors: ['No available provider for product.fetch'],
    };
  }

  const results = await provider.search({ query, retailerSlug, limit });
  if (results.length === 0) {
    return { success: true, processed: 0, metadata: { provider: provider.key } };
  }

  const ingestionResults = await ingestBatch(results, provider.key);
  const succeeded = ingestionResults.filter((r) => r.success).length;
  const failed = ingestionResults.filter((r) => !r.success);

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = job.data as any;
  const query: string = data.query;
  const retailerSlug: string | undefined = data.retailerSlug;
  const limit: number = data.limit ?? 50;

  const registry = getProviderRegistry();
  const provider = retailerSlug
    ? registry.getForRetailer(retailerSlug)
    : registry.getPreferred();

  if (!provider) {
    return {
      success: false,
      processed: 0,
      errors: ['No available provider for product.search'],
    };
  }

  const results = await provider.search({ query, retailerSlug, limit });
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = job.data as any;

  const supabase = await getServiceClient();
  const { error } = await supabase.from('price_history').insert({
    product_id: data.productId,
    retailer_id: data.retailerId,
    price: data.price,
    currency: data.currency,
    availability: data.availability ?? 'in_stock',
    url: data.url ?? null,
    recorded_at: new Date().toISOString(),
  });

  if (error) {
    return {
      success: false,
      processed: 0,
      errors: [error.message],
    };
  }

  return { success: true, processed: 1 };
}

// ---------------------------------------------------------------------------
// price.refresh — re-fetch the price for a product from its source
// ---------------------------------------------------------------------------

async function processPriceRefresh(
  job: JobDefinition
): Promise<JobResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const errors: string[] = [];

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

    const fresh = await provider.fetch({
      externalId: source.external_id,
      retailerSlug: retailer.slug,
    });

    if (!fresh) {
      errors.push(`Provider returned no data for source ${source.id}`);
      continue;
    }

    // Record the new price point.
    const { error: insertError } = await supabase.from('price_history').insert({
      product_id: productId,
      retailer_id: source.retailer_id,
      price: fresh.price,
      currency: fresh.currency,
      availability: fresh.availability,
      url: fresh.url ?? null,
      recorded_at: new Date().toISOString(),
    });

    if (insertError) {
      errors.push(insertError.message);
    } else {
      processed++;
    }

    // Update the source's last_fetched_at.
    await supabase
      .from('product_sources')
      .update({ last_fetched_at: new Date().toISOString() })
      .eq('id', source.id);
  }

  return {
    success: processed > 0,
    processed,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ---------------------------------------------------------------------------
// product.validate — check data freshness, flag stale products
// ---------------------------------------------------------------------------

async function processProductValidate(
  job: JobDefinition
): Promise<JobResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  logger.info('image.process: processing requested (placeholder)', {
    productId,
    count: urls.length,
  });

  return {
    success: true,
    processed: urls.length,
    metadata: { productId, placeholder: true },
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
};
