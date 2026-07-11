/**
 * Background worker queue — BullMQ integration with synchronous fallback.
 *
 * When Redis is available (REDIS_URL configured):
 * - Jobs are enqueued to BullMQ queues and processed asynchronously by workers
 * - Supports retries, backoff, priority, delayed jobs, and concurrency
 * - Failed jobs after max retries are moved to a dead-letter queue (logged)
 *
 * When Redis is unavailable:
 * - Jobs execute synchronously in-process (development mode)
 * - The same processors run, just without the queue infrastructure
 *
 * Enhanced features:
 * - Dead-letter queue: jobs that exhaust their retry budget are logged.
 * - Idempotent jobs: an `idempotencyKey` prevents duplicate processing.
 * - Delayed jobs: a `delayMs` defers job execution.
 * - Scheduled jobs: cron expressions on `data_sources` drive recurring syncs.
 * - Queue monitoring: `recordQueueMetrics()` integration.
 *
 * This dual-mode design means the data pipeline works in all environments
 * without requiring Redis, while production can leverage full BullMQ features.
 */

import { logger } from '@/lib/config/logger';
import { env } from '@/lib/config/env';
import type { JobDefinition, JobResult, JobType } from './types';
import { processors } from './processors';

export type { JobType, JobDefinition, JobResult } from './types';
export type {
  ProductFetchJobData,
  ProductSearchJobData,
  PriceUpdateJobData,
  PriceRefreshJobData,
  ProductValidateJobData,
  CacheInvalidateJobData,
  DataSyncJobData,
  ImageProcessJobData,
} from './types';

interface QueueAdapter {
  enqueue<T>(job: JobDefinition<T>): Promise<string>;
  process(): void;
  size(): number;
  isUsingRedis(): boolean;
}

// ---------------------------------------------------------------------------
// Priority mapping — BullMQ uses numeric priority (lower = higher priority)
// ---------------------------------------------------------------------------

const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 1,
  high: 2,
  normal: 5,
  low: 10,
};

// ---------------------------------------------------------------------------
// Dead-letter queue — failed jobs after max retries are logged here
// ---------------------------------------------------------------------------

interface DeadLetterEntry {
  id: string;
  type: JobType;
  data: unknown;
  error: string;
  attempts: number;
  failedAt: string;
}

const deadLetterQueue: DeadLetterEntry[] = [];

function recordDeadLetter(entry: DeadLetterEntry): void {
  deadLetterQueue.push(entry);
  // Keep the DLQ bounded to avoid unbounded memory growth.
  if (deadLetterQueue.length > 1000) deadLetterQueue.shift();
  logger.error('Dead-letter queue: job moved to DLQ', {
    type: entry.type,
    id: entry.id,
    error: entry.error,
    attempts: entry.attempts,
  });
}

/**
 * Return a snapshot of the dead-letter queue (newest last).
 */
export function getDeadLetterQueue(): DeadLetterEntry[] {
  return [...deadLetterQueue];
}

// ---------------------------------------------------------------------------
// Idempotency tracking — prevent duplicate processing
// ---------------------------------------------------------------------------

const idempotencySeen = new Map<string, string>();

// ---------------------------------------------------------------------------
// Queue metrics — periodically recorded to the monitoring tables
// ---------------------------------------------------------------------------

async function recordQueueMetricsSnapshot(): Promise<void> {
  try {
    const { recordQueueMetrics } = await import('@/services/monitoring');
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      env.supabaseUrl,
      env.supabaseServiceRoleKey ?? env.supabaseAnonKey,
      { auth: { persistSession: false } }
    );

    const queue = getQueue();
    const queueName = queue.isUsingRedis() ? 'bullmq' : 'synchronous';

    await recordQueueMetrics(supabase, {
      queueName,
      waitingCount: queue.size(),
      activeCount: 0,
      completedCount: metrics.completed,
      failedCount: metrics.failed,
      delayedCount: 0,
      throughputPerMin: metrics.throughputPerMin,
    });
  } catch (err) {
    logger.warn('recordQueueMetricsSnapshot: failed', { error: String(err) });
  }
}

// Lightweight in-process metrics counters.
const metrics = {
  completed: 0,
  failed: 0,
  enqueued: 0,
  // Rolling throughput estimate (jobs in the last 60s).
  throughputPerMin: 0,
  _timestamps: [] as number[],
};

function recordCompletion(success: boolean): void {
  if (success) metrics.completed++;
  else metrics.failed++;

  const now = Date.now();
  metrics._timestamps.push(now);
  // Prune timestamps older than 60s.
  metrics._timestamps = metrics._timestamps.filter((t) => now - t < 60_000);
  metrics.throughputPerMin = metrics._timestamps.length;
}

// ---------------------------------------------------------------------------
// Synchronous (in-process) queue — used when Redis is not available
// ---------------------------------------------------------------------------

class SynchronousQueue implements QueueAdapter {
  private counter = 0;

  async enqueue<T>(job: JobDefinition<T>): Promise<string> {
    const jobId = `sync-${Date.now()}-${this.counter++}`;
    metrics.enqueued++;

    // Idempotency: drop duplicate jobs sharing the same key.
    if (job.idempotencyKey) {
      if (idempotencySeen.has(job.idempotencyKey)) {
        logger.info('Sync queue: dropping duplicate idempotent job', {
          type: job.type,
          idempotencyKey: job.idempotencyKey,
        });
        return idempotencySeen.get(job.idempotencyKey)!;
      }
      idempotencySeen.set(job.idempotencyKey, jobId);
    }

    // Delayed job support: wait for delayMs before processing.
    if (job.delayMs && job.delayMs > 0) {
      logger.info('Sync queue: delaying job', {
        type: job.type,
        jobId,
        delayMs: job.delayMs,
      });
      setTimeout(() => {
        void this.runJob(job, jobId);
      }, job.delayMs);
      return jobId;
    }

    await this.runJob(job, jobId);
    return jobId;
  }

  private async runJob<T>(job: JobDefinition<T>, jobId: string): Promise<void> {
    const processor = processors[job.type];
    if (!processor) {
      logger.error('Sync queue: no processor for job type', { type: job.type });
      recordDeadLetter({
        id: jobId,
        type: job.type,
        data: job.data,
        error: `No processor registered for type: ${job.type}`,
        attempts: 1,
        failedAt: new Date().toISOString(),
      });
      recordCompletion(false);
      return;
    }

    const maxAttempts = job.attempts ?? 1;
    const backoffMs = job.backoffMs ?? 1000;
    let attempt = 0;
    let lastError = '';

    while (attempt < maxAttempts) {
      attempt++;
      try {
        const result = await processor(job as JobDefinition);
        recordCompletion(result.success);
        logger.info('Sync job complete', {
          type: job.type,
          jobId,
          success: result.success,
          processed: result.processed,
          attempt,
        });
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'unknown';
        logger.warn('Sync job attempt failed', {
          type: job.type,
          jobId,
          attempt,
          maxAttempts,
          error: lastError,
        });
        if (attempt < maxAttempts) {
          // Exponential backoff between retries.
          const delay = backoffMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // Exhausted retries → dead-letter queue.
    recordDeadLetter({
      id: jobId,
      type: job.type,
      data: job.data,
      error: lastError,
      attempts: attempt,
      failedAt: new Date().toISOString(),
    });
    recordCompletion(false);
  }

  process() {
    // No-op: synchronous queue processes immediately on enqueue.
    // Start a metrics recorder that periodically snapshots queue state.
    if (!this.metricsTimer) {
      this.metricsTimer = setInterval(() => {
        void recordQueueMetricsSnapshot();
      }, 60_000);
      // Don't keep the Node.js event loop alive solely for this timer.
      if (this.metricsTimer.unref) this.metricsTimer.unref();
    }
  }

  private metricsTimer: ReturnType<typeof setInterval> | null = null;

  size() {
    return 0;
  }

  isUsingRedis() {
    return false;
  }
}

// ---------------------------------------------------------------------------
// BullMQ queue — used when Redis is available
// ---------------------------------------------------------------------------

class BullMQQueue implements QueueAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private queues = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private workers = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dlq: any = null;
  private connection: unknown;
  private redisAvailable = false;

  constructor(redisUrl: string) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = eval('require')('bullmq');
      if (!mod || !mod.Queue) {
        throw new Error('bullmq module missing Queue export');
      }
      this.connection = { connection: { url: redisUrl } };
      this.redisAvailable = true;
      logger.info('BullMQ queue: initialized with Redis', { url: redisUrl });
    } catch (err) {
      logger.warn('BullMQ: bullmq package not installed, falling back to synchronous', {
        error: err instanceof Error ? err.message : 'unknown',
      });
      this.redisAvailable = false;
    }
  }

  async enqueue<T>(job: JobDefinition<T>): Promise<string> {
    if (!this.redisAvailable) {
      throw new Error('BullMQ not available');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { Queue } = eval('require')('bullmq') as any;
    let queue = this.queues.get(job.type);
    if (!queue) {
      queue = new Queue(job.type, this.connection);
      this.queues.set(job.type, queue);
    }

    // Idempotency: BullMQ supports a custom job ID which acts as the
    // idempotency key. Re-adding a job with the same ID is a no-op.
    const jobId = job.idempotencyKey ?? undefined;

    const opts: Record<string, unknown> = {
      priority: PRIORITY_WEIGHT[job.priority ?? 'normal'] ?? 5,
    };
    if (job.attempts) opts.attempts = job.attempts;
    if (job.backoffMs) opts.backoff = { type: 'exponential', delay: job.backoffMs };
    if (job.delayMs && job.delayMs > 0) opts.delay = job.delayMs;

    const queuedJob = await queue.add(job.type, job.data, { ...opts, jobId });
    metrics.enqueued++;
    return queuedJob.id ?? `bull-${Date.now()}`;
  }

  process() {
    if (!this.redisAvailable) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { Worker, Queue: DLQQueue } = eval('require')('bullmq') as any;

    // Set up the dead-letter queue once.
    if (!this.dlq && DLQQueue) {
      this.dlq = new DLQQueue('dead-letter', this.connection);
    }

    for (const [type, processor] of Object.entries(processors)) {
      if (this.workers.has(type)) continue;
      const worker = new Worker(
        type,
        async (job: JobDefinition) => {
          return processor(job);
        },
        { connection: this.connection, concurrency: 5 }
      );
      worker.on('completed', (job: { id: string }) => {
        recordCompletion(true);
        logger.info('BullMQ job completed', { type, id: job.id });
      });
      worker.on('failed', (job: { id: string; attemptsMade: number; data: unknown }, err: Error) => {
        recordCompletion(false);
        logger.error('BullMQ job failed', {
          type,
          id: job.id,
          error: err.message,
          attemptsMade: job.attemptsMade,
        });

        // When a job has exhausted its attempts, move it to the DLQ.
        const maxAttempts = (job as { opts?: { attempts?: number } }).opts?.attempts ?? 1;
        if (job.attemptsMade >= maxAttempts) {
          recordDeadLetter({
            id: job.id,
            type: type as JobType,
            data: job.data,
            error: err.message,
            attempts: job.attemptsMade,
            failedAt: new Date().toISOString(),
          });
          // Also move to the BullMQ DLQ queue if available.
          if (this.dlq) {
            this.dlq.add(`${type}-failed-${job.id}`, {
              originalType: type,
              data: job.data,
              error: err.message,
            }).catch(() => {
              // best-effort; DLQ write failures are non-fatal
            });
          }
        }
      });
      this.workers.set(type, worker);
    }

    // Periodically record queue metrics.
    if (!this.metricsTimer) {
      this.metricsTimer = setInterval(() => {
        void recordQueueMetricsSnapshot();
      }, 60_000);
      if (this.metricsTimer.unref) this.metricsTimer.unref();
    }
  }

  private metricsTimer: ReturnType<typeof setInterval> | null = null;

  size() {
    return this.queues.size;
  }

  isUsingRedis() {
    return this.redisAvailable;
  }
}

// ---------------------------------------------------------------------------
// Scheduled jobs — cron expressions on data_sources drive recurring syncs
// ---------------------------------------------------------------------------

let scheduledTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start scheduled job processing. Reads `data_sources` rows with a
 * `schedule_cron` expression and enqueues `data.sync` jobs on their
 * schedule. This is a lightweight, best-effort scheduler — for precise
 * scheduling in production, use a dedicated cron service or BullMQ's
 * `Queue.upsertJobScheduler`.
 */
export async function startScheduledJobs(): Promise<void> {
  if (scheduledTimer) return;

  // Run the scheduled-job sweep every minute.
  scheduledTimer = setInterval(() => {
    void runScheduledJobs();
  }, 60_000);
  if (scheduledTimer.unref) scheduledTimer.unref();

  // Run once immediately on startup.
  void runScheduledJobs();
}

async function runScheduledJobs(): Promise<void> {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      env.supabaseUrl,
      env.supabaseServiceRoleKey ?? env.supabaseAnonKey,
      { auth: { persistSession: false } }
    );

    const { data: sources } = await supabase
      .from('data_sources')
      .select('id, name, schedule_cron, last_sync_at, active')
      .eq('active', true)
      .not('schedule_cron', 'is', null);

    if (!sources || sources.length === 0) return;

    const now = Date.now();
    for (const source of sources) {
      // Best-effort cron matching: only re-enqueue if the last sync was
      // more than a minute ago. A full cron parser can be plugged in here.
      const lastSyncMs = source.last_sync_at
        ? new Date(source.last_sync_at).getTime()
        : 0;
      if (now - lastSyncMs < 60_000) continue;

      logger.info('Scheduled job: enqueuing data.sync', {
        dataSourceId: source.id,
        name: source.name,
        cron: source.schedule_cron,
      });

      await enqueueJob({
        type: 'data.sync',
        data: { dataSourceId: source.id },
        priority: 'low',
        attempts: 3,
        backoffMs: 10_000,
        idempotencyKey: `data-sync-${source.id}-${Math.floor(now / 60_000)}`,
      });
    }
  } catch (err) {
    logger.warn('runScheduledJobs: failed', { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let queue: QueueAdapter | null = null;

export function getQueue(): QueueAdapter {
  if (queue) return queue;

  if (env.redisUrl || process.env.REDIS_URL) {
    const redisUrl = env.redisUrl ?? process.env.REDIS_URL!;
    queue = new BullMQQueue(redisUrl);
    if (!queue.isUsingRedis()) {
      queue = new SynchronousQueue();
    }
  } else {
    logger.info('Worker queue: using synchronous mode (no REDIS_URL)');
    queue = new SynchronousQueue();
  }

  return queue;
}

export async function enqueueJob<T>(job: JobDefinition<T>): Promise<string> {
  return getQueue().enqueue(job);
}

export function startWorkers(): void {
  getQueue().process();
}

// ---------------------------------------------------------------------------
// Metrics accessors (for monitoring endpoints)
// ---------------------------------------------------------------------------

export function getQueueMetrics() {
  return {
    completed: metrics.completed,
    failed: metrics.failed,
    enqueued: metrics.enqueued,
    throughputPerMin: metrics.throughputPerMin,
    deadLetterCount: deadLetterQueue.length,
  };
}
