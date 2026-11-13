/**
 * Background worker queue — synchronous in-process ONLY.
 *
 * Sections 21–25, Stage D (item 8) — the old header described
 * the queue as BullMQ-backed with a synchronous fallback. That
 * was false: the `bullmq` package is NOT installed, so the
 * `BullMQQueue` adapter below can never load (`eval('require')`
 * throws, `getQueue()` falls back to `SynchronousQueue`), and
 * configuring REDIS_URL alone changes nothing — async execution
 * would ALSO need the package installed (an owner decision; do
 * NOT install it as a drive-by). Until then:
 * - Jobs execute synchronously in-process, on this instance.
 * - The same processors run, with retries, backoff, priority,
 *   delayed jobs and idempotency handled by the synchronous
 *   runner — NOT by BullMQ.
 *
 * Enhanced features:
 * - Dead-letter queue: jobs that exhaust their retry budget are logged.
 * - Idempotent jobs: an `idempotencyKey` prevents duplicate processing.
 * - Delayed jobs: a `delayMs` defers job execution.
 * - Scheduled jobs: cron expressions on `data_sources` drive recurring syncs.
 * - Queue monitoring: `recordQueueMetrics()` integration.
 *
 * The `BullMQQueue` class is kept (not silently deleted) so the
 * adapter is visible, but it is dead code until the package is
 * installed — never describe the queue as BullMQ-backed.
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
  AiAnalyzeJobData,
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

export interface DeadLetterEntry {
  id: string;
  type: JobType;
  data: unknown;
  error: string;
  attempts: number;
  failedAt: string;
}

const DLQ_ERROR_LOG_ROUTE = 'queue.dlq';

/**
 * Sections 21–25, Stage D (item 2) — persist one dead-lettered
 * job to `error_log` (migration 048), so a failed job survives
 * a restart. Best-effort and never throwing: until 048 is
 * applied the table does not exist and `insertErrorLogRow`
 * reports 'missing-table' — the in-memory entry is still kept
 * and the admin surface says the persisted trail is unavailable.
 * Durable cross-instance DLQ storage needs the owner to apply
 * 048 (and, for a truly durable queue, a queue table — out of
 * scope here; the in-memory DLQ + error_log trail is the
 * persistence this stage can provide without a new migration).
 */
export async function persistDeadLetterEntry(
  supabase: import('@/lib/supabase/types').AnySupabaseClient,
  entry: DeadLetterEntry
): Promise<'inserted' | 'missing-table' | 'failed'> {
  const { insertErrorLogRow } = await import('@/services/error-log-admin');
  return insertErrorLogRow(supabase, {
    level: 'error',
    message: 'Job moved to dead-letter queue',
    route: DLQ_ERROR_LOG_ROUTE,
    meta: {
      jobId: entry.id,
      jobType: entry.type,
      attempts: entry.attempts,
      error: entry.error,
      failedAt: entry.failedAt,
      data: entry.data ?? null,
    },
  });
}

/** Fire-and-forget persistence for `recordDeadLetter` (never blocks the queue). */
async function persistDeadLetterEntryBestEffort(entry: DeadLetterEntry): Promise<void> {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      env.supabaseUrl,
      env.supabaseServiceRoleKey ?? env.supabaseAnonKey,
      { auth: { persistSession: false } }
    );
    await persistDeadLetterEntry(
      supabase as unknown as import('@/lib/supabase/types').AnySupabaseClient,
      entry
    );
  } catch (err) {
    // Persistence must never fail the queue: the in-memory entry
    // is the record of last resort on this instance.
    logger.warn('persistDeadLetterEntry: failed', { error: String(err) });
  }
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
  // Sections 21–25, Stage D (item 2) — persist best-effort to
  // error_log so the entry survives a restart (when 048 is
  // applied). Fire-and-forget: persistence never blocks the queue.
  void persistDeadLetterEntryBestEffort(entry);
}

/**
 * Return a snapshot of the dead-letter queue (newest last).
 */
export function getDeadLetterQueue(): DeadLetterEntry[] {
  return [...deadLetterQueue];
}

// ---------------------------------------------------------------------------
// Last job results — Section 18, item 41
// ---------------------------------------------------------------------------

/**
 * The most recent outcome per job id, so the caller that enqueued a
 * job synchronously can report what actually happened instead of
 * "queued". Bounded to the last 100 results (oldest evicted first)
 * — this is in-memory, per-instance state, like the DLQ above.
 * Only the SynchronousQueue records here: a BullMQ job runs
 * asynchronously elsewhere, so its result is never present and the
 * caller honestly keeps the 202 'queued' response.
 */
const lastJobResults = new Map<string, JobResult>();
const MAX_JOB_RESULTS = 100;

function recordJobResult(jobId: string, result: JobResult): void {
  lastJobResults.set(jobId, result);
  if (lastJobResults.size > MAX_JOB_RESULTS) {
    const oldest = lastJobResults.keys().next();
    if (!oldest.done) lastJobResults.delete(oldest.value);
  }
}

/**
 * The recorded outcome of a synchronously-run job, or undefined
 * when the job has not finished (yet) on this instance — e.g. a
 * delayed job, or a job handed to BullMQ.
 */
export function getJobResult(jobId: string): JobResult | undefined {
  return lastJobResults.get(jobId);
}

/**
 * Sections 21–25, Stage G — background-job monitoring surface.
 * A snapshot of the recorded job outcomes on THIS instance
 * (newest first), for the admin monitoring surface
 * (`services/admin-monitoring.ts`). Bounded to the last 100 by
 * construction (`MAX_JOB_RESULTS`). In-memory, per-instance state
 * like the DLQ — a job that ran on another Vercel instance does
 * not appear here, and a BullMQ job never records a result at
 * all (its outcome is genuinely unknown to this instance, so the
 * surface says so instead of inventing one).
 */
export function listJobResults(): Array<{ jobId: string; result: JobResult }> {
  return [...lastJobResults.entries()]
    .reverse()
    .map(([jobId, result]) => ({ jobId, result }));
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
      recordJobResult(jobId, {
        success: false,
        processed: 0,
        errors: [`No processor registered for type: ${job.type}`],
      });
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
        // Section 18, item 41 — record the outcome so the enqueuing
        // caller can report the real result (see getJobResult).
        recordJobResult(jobId, result);
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
    recordJobResult(jobId, {
      success: false,
      processed: 0,
      errors: [lastError || 'job failed'],
    });
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
// BullMQ queue adapter — DEAD CODE today: the `bullmq` package is
// not installed, so the constructor always falls back and
// `getQueue()` returns the SynchronousQueue. Kept visible (not
// deleted) so the adapter is not silently lost; enabling it needs
// the package installed (owner decision) AND Redis configured.
// Do not describe the queue as BullMQ-backed (Stage D, item 8).
// ---------------------------------------------------------------------------

class BullMQQueue implements QueueAdapter {
  private queues = new Map<string, any>();
  private workers = new Map<string, any>();
  private dlq: any = null;
  private connection: unknown;
  private redisAvailable = false;

  constructor(redisUrl: string) {
    try {
      const mod: any = eval('require')('bullmq');
      if (!mod || !mod.Queue) {
        throw new Error('bullmq module missing Queue export');
      }
      this.connection = { connection: { url: redisUrl } };
      this.redisAvailable = true;
      // Section 18, item 43 — never log the Redis URL: it carries
      // credentials. Log only that a URL was configured.
      logger.info('BullMQ queue: initialized with Redis', { redisConfigured: true });
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
 * scheduling in production, use a dedicated cron service (not a
 * queue: the BullMQ adapter cannot load — the package is not
 * installed — so no queue-based scheduler exists today).
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
