/**
 * Section 19, Phase 8 (§12 #12) — enqueue helpers for expensive AI
 * analysis (background jobs, Vercel-native).
 *
 * WHAT RUNS AS A JOB: exactly one analysis — visual analysis
 * (`ai.analyze`: BLIP caption + HF embedding + catalog vector
 * match). It is the only AI work expensive enough to justify a
 * job: up to two Hugging Face Inference calls with 30s timeouts
 * each, plus the image fetch and two catalog RPCs. Everything
 * else stays inline — see `docs/ai-background-jobs.md` for the
 * cost table and for the analyses where inline processing is
 * genuinely insufficient (bulk catalog re-embedding) and what the
 * owner must provision for those (Upstash Redis + BullMQ).
 *
 * HOW IT RUNS TODAY: through the EXISTING worker queue
 * (`lib/workers/queue.ts` — `enqueueJob`). No new queue service,
 * no new scheduler, no new dependency. With no `REDIS_URL`
 * configured (the current state — BullMQ is not installed) the
 * queue is the SynchronousQueue: the job runs in-process, awaited,
 * inside the requesting function, with the queue's retries,
 * exponential backoff, idempotency dedupe and dead-letter queue.
 * That is honest "deferred work with retries", NOT a separate
 * worker process — the design doc states this plainly. When the
 * owner provisions Upstash Redis (owner-gated), the SAME enqueue
 * call becomes truly asynchronous with no code change.
 *
 * RESULT STORAGE: no new table, no new migration. The outcome is
 * returned in `JobResult.metadata` and read back via
 * `getJobResult(jobId)` (last 100 jobs, this instance). The
 * caption + embedding are also left in the §12 #11 visual-search
 * cache, warming the next live request for the same image.
 *
 * IDEMPOTENCY: the same image/caption + limit enqueued twice
 * returns the SAME job id and runs once (the queue drops the
 * duplicate by `idempotencyKey`). The key is a sha256 of the
 * inputs — the raw image URL never becomes a key.
 */

import { createHash } from 'node:crypto';
import { enqueueJob } from '@/lib/workers/queue';
import type { AiAnalyzeJobData } from '@/lib/workers/types';

/** Attempts for an ai.analyze job, including the first (queue default is 1 — a transient HF 503 must be retried). */
export const AI_ANALYZE_ATTEMPTS = 3;
/** Base backoff between ai.analyze retries (ms, doubled per attempt by the queue). */
export const AI_ANALYZE_BACKOFF_MS = 5000;

export interface EnqueueAiVisualAnalysisInput {
  imageUrl?: string;
  caption?: string;
  limit?: number;
  preferClip?: boolean;
}

/** Idempotency key for one visual analysis (sha256 of the inputs — the raw URL never becomes a key). */
export function aiVisualAnalysisIdempotencyKey(input: EnqueueAiVisualAnalysisInput): string {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 5) || 5, 1), 10);
  const raw = [input.imageUrl?.trim() ?? '', input.caption?.trim() ?? '', String(limit)].join('|');
  return `ai-visual:${createHash('sha256').update(raw, 'utf8').digest('hex')}`;
}

/**
 * Enqueue a visual analysis as an `ai.analyze` job (low priority
 * — it spends HF quota — 3 attempts with backoff, idempotent).
 * Returns the job id; the outcome is read back with
 * `getJobResult(jobId)`. Throws only when the enqueue itself
 * fails; a failed ANALYSIS is reported in the job result, not by
 * throwing here.
 */
export async function enqueueAiVisualAnalysis(
  input: EnqueueAiVisualAnalysisInput
): Promise<{ jobId: string; idempotencyKey: string }> {
  const data: AiAnalyzeJobData = {
    ...(input.imageUrl?.trim() ? { imageUrl: input.imageUrl.trim() } : {}),
    ...(input.caption?.trim() ? { caption: input.caption.trim() } : {}),
    limit: Math.min(Math.max(Math.floor(input.limit ?? 5) || 5, 1), 10),
    ...(typeof input.preferClip === 'boolean' ? { preferClip: input.preferClip } : {}),
  };
  const idempotencyKey = aiVisualAnalysisIdempotencyKey(input);
  const jobId = await enqueueJob({
    type: 'ai.analyze',
    data,
    priority: 'low',
    attempts: AI_ANALYZE_ATTEMPTS,
    backoffMs: AI_ANALYZE_BACKOFF_MS,
    idempotencyKey,
  });
  return { jobId, idempotencyKey };
}
