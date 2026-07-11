/**
 * Worker queue job types and payload definitions.
 *
 * These types describe the jobs that flow through the background worker
 * queue (see `./queue.ts`). Each `JobType` maps to a processor in
 * `./processors.ts` and to a strongly-typed data payload.
 */

// ---------------------------------------------------------------------------
// Job types & priority
// ---------------------------------------------------------------------------

export type JobType =
  | 'product.fetch'
  | 'product.search'
  | 'price.update'
  | 'price.refresh'
  | 'product.validate'
  | 'cache.invalidate'
  | 'data.sync'
  | 'image.process';

export type JobPriority = 'low' | 'normal' | 'high' | 'critical';

// ---------------------------------------------------------------------------
// Generic job definition & result
// ---------------------------------------------------------------------------

/**
 * A job definition submitted to the queue. The `data` field is
 * discriminated by `type` — see the per-type payload interfaces below.
 */
export interface JobDefinition<T = unknown> {
  /** Discriminant: identifies which processor handles this job. */
  type: JobType;
  /** Strongly-typed payload for the job. */
  data: T;
  /** Queue priority. Lower-priority jobs run first when the queue is busy. */
  priority?: JobPriority;
  /** Maximum number of attempts (including the first) before moving to DLQ. */
  attempts?: number;
  /** Base backoff delay (ms) between retries; exponential backoff is applied. */
  backoffMs?: number;
  /** Delay (ms) before the job becomes eligible to run. */
  delayMs?: number;
  /**
   * Idempotency key. When provided, the queue drops duplicate jobs that
   * share the same key, preventing redundant processing.
   */
  idempotencyKey?: string;
}

/**
 * The result returned by a job processor.
 */
export interface JobResult {
  success: boolean;
  /** Number of records/items processed by the job. */
  processed: number;
  /** Non-fatal errors encountered during processing (job may still succeed). */
  errors?: string[];
  /** Optional provider/processor-specific metadata. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Per-job-type data payloads
// ---------------------------------------------------------------------------

/** `product.fetch` — search a provider for products matching a query. */
export interface ProductFetchJobData {
  query: string;
  retailerSlug?: string;
  limit?: number;
}

/** `product.search` — search providers for products matching a query. */
export interface ProductSearchJobData {
  query: string;
  retailerSlug?: string;
  limit?: number;
}

/** `price.update` — record a new price point for a product/retailer pair. */
export interface PriceUpdateJobData {
  productId: string;
  retailerId: string;
  price: number;
  currency: string;
  availability?: string;
  url?: string;
}

/** `price.refresh` — re-fetch the current price for a product from its source. */
export interface PriceRefreshJobData {
  productId: string;
  /** Optional retailer filter; when omitted, refreshes all retailers for the product. */
  retailerId?: string;
}

/** `product.validate` — check data freshness and flag stale products. */
export interface ProductValidateJobData {
  /** Product ID to validate. When omitted, a batch of products is validated. */
  productId?: string;
  /** Max batch size when validating multiple products. */
  batchSize?: number;
}

/** `cache.invalidate` — clear cache entries matching a glob-style pattern. */
export interface CacheInvalidateJobData {
  /** Glob-style pattern, e.g. `product:*` or `price-history:*`. */
  pattern: string;
}

/** `data.sync` — full sync from a configured data source. */
export interface DataSyncJobData {
  /** The `data_sources.id` to sync from. */
  dataSourceId: string;
  /** Optional provider key override; otherwise the source's provider is used. */
  providerKey?: string;
}

/** `image.process` — process images for a product (resize, dedupe, validate). */
export interface ImageProcessJobData {
  productId: string;
  /** Optional list of image URLs to process; defaults to the product's stored images. */
  imageUrls?: string[];
}

// ---------------------------------------------------------------------------
// Job data payload union (for typed processors)
// ---------------------------------------------------------------------------

export type JobDataMap = {
  'product.fetch': ProductFetchJobData;
  'product.search': ProductSearchJobData;
  'price.update': PriceUpdateJobData;
  'price.refresh': PriceRefreshJobData;
  'product.validate': ProductValidateJobData;
  'cache.invalidate': CacheInvalidateJobData;
  'data.sync': DataSyncJobData;
  'image.process': ImageProcessJobData;
};
