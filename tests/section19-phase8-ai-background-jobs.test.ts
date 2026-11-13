/**
 * Section 19, Phase 8 (§12 #12) — AI background-job tests.
 *
 * - `ai.analyze` is registered: enqueue → processor runs → the
 *   job result carries the caption, embedding space and matches.
 * - The processor mirrors the visual-search route's CLIP → MiniLM
 *   fallback (CLIP rows exist but match nothing → MiniLM serves,
 *   `fallbackUsed: true`).
 * - Retry contract: a retryable HF failure (503 model loading)
 *   THROWS so the queue retries it (3 attempts, then DLQ); a
 *   non-retryable failure (401/403-style, `retryable: false`)
 *   RETURNS a failed result — no retry, no DLQ. 401/403 are never
 *   retried.
 * - Idempotency: the same visual analysis enqueued twice runs
 *   once and returns the same job id.
 * - No input (neither imageUrl nor caption) fails without throwing.
 * - The design doc states the sync-today / Upstash-owner-gated
 *   reality instead of claiming a real async worker exists.
 *
 * The HF service functions and the Supabase client are mocked
 * (the processor's only I/O); the queue itself is real.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  caption: vi.fn(),
  embed: vi.fn(),
  embedClip: vi.fn(),
  clipCount: 0,
  clipMatches: [{ product_id: 'p1', similarity: 0.95 }] as Array<{
    product_id: string;
    similarity: number;
  }>,
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock('@/services/visual-search', () => ({
  captionPublicImageUrl: (...args: unknown[]) => mocks.caption(...args),
  embedText: (...args: unknown[]) => mocks.embed(...args),
  embedTextClip: (...args: unknown[]) => mocks.embedClip(...args),
  searchVisualByImageUrl: vi.fn(async () => []),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        in: () => q,
        neq: () => q,
        is: () => q,
        order: () => q,
        limit: () => q,
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
          let res: unknown;
          if (table === 'product_clip_embeddings') {
            res = { data: null, error: null, count: mocks.clipCount };
          } else if (table === 'products') {
            res = {
              data: [{ id: 'p1', slug: 'test-product', name: 'Test Product', brand: 'TestBrand' }],
              error: null,
            };
          } else {
            res = { data: [], error: null };
          }
          return Promise.resolve(res).then(onF as never, onR as never);
        },
      };
      return q;
    },
    rpc: async (name: string, args: unknown) => {
      mocks.rpcCalls.push({ name, args });
      if (name === 'match_clip_products') {
        return { data: mocks.clipMatches, error: null };
      }
      if (name === 'match_products') {
        return { data: [{ product_id: 'p1', similarity: 0.91 }], error: null };
      }
      return { data: [], error: null };
    },
  }),
}));

import { enqueueJob, getJobResult, getDeadLetterQueue } from '@/lib/workers/queue';
import { processors } from '@/lib/workers/processors';
import {
  enqueueAiVisualAnalysis,
  aiVisualAnalysisIdempotencyKey,
} from '@/services/ai-background-jobs';

beforeEach(() => {
  mocks.caption.mockReset();
  mocks.embed.mockReset();
  mocks.embedClip.mockReset();
  mocks.caption.mockResolvedValue({ ok: true, value: 'a red laptop' });
  mocks.embed.mockResolvedValue({ ok: true, value: new Array(384).fill(0.1) });
  mocks.embedClip.mockResolvedValue({ ok: true, value: new Array(512).fill(0.2) });
  mocks.clipCount = 0;
  mocks.clipMatches = [{ product_id: 'p1', similarity: 0.95 }];
  mocks.rpcCalls.length = 0;
});

describe('ai.analyze job (§12 #12)', () => {
  it('a caption-only job completes with the match list in metadata', async () => {
    const jobId = await enqueueJob({
      type: 'ai.analyze',
      data: { caption: 'a red laptop', limit: 5 },
      attempts: 1,
    });
    const result = getJobResult(jobId);
    expect(result?.success).toBe(true);
    expect(result?.processed).toBe(1);
    const meta = result?.metadata as Record<string, unknown> | undefined;
    expect(meta?.caption).toBe('a red laptop');
    expect(meta?.mode).toBe('vector');
    expect(meta?.fallbackUsed).toBe(false);
    const matches = meta?.matches as Array<Record<string, unknown>>;
    expect(matches).toHaveLength(1);
    expect(matches[0].productId).toBe('p1');
    expect(matches[0].slug).toBe('test-product');
    expect(matches[0].similarity).toBe(0.91);
    expect(mocks.embed).toHaveBeenCalledTimes(1);
    expect(mocks.embed).toHaveBeenCalledWith('a red laptop');
    expect(mocks.caption).not.toHaveBeenCalled();
    expect(mocks.rpcCalls.map((c) => c.name)).toEqual(['match_products']);
  });

  it('an imageUrl job captions first, then embeds and matches', async () => {
    const jobId = await enqueueJob({
      type: 'ai.analyze',
      data: { imageUrl: 'https://example.com/laptop.jpg', limit: 5 },
      attempts: 1,
    });
    const result = getJobResult(jobId);
    expect(result?.success).toBe(true);
    expect(mocks.caption).toHaveBeenCalledWith('https://example.com/laptop.jpg');
    const meta = result?.metadata as Record<string, unknown> | undefined;
    expect(meta?.caption).toBe('a red laptop');
  });

  it('CLIP matches nothing → MiniLM fallback serves and fallbackUsed is true', async () => {
    mocks.clipCount = 1;
    mocks.clipMatches = [];
    const jobId = await enqueueJob({
      type: 'ai.analyze',
      data: { caption: 'a red laptop', limit: 5 },
      attempts: 1,
    });
    const result = getJobResult(jobId);
    expect(result?.success).toBe(true);
    expect(mocks.embedClip).toHaveBeenCalledTimes(1);
    expect(mocks.embed).toHaveBeenCalledTimes(1);
    expect(mocks.rpcCalls.map((c) => c.name)).toEqual([
      'match_clip_products',
      'match_products',
    ]);
    const meta = result?.metadata as Record<string, unknown> | undefined;
    expect(meta?.mode).toBe('vector');
    expect(meta?.fallbackUsed).toBe(true);
  });

  it('a retryable caption failure is retried (3 attempts) and then DLQ’d', async () => {
    mocks.caption.mockResolvedValue({
      ok: false,
      error: 'The captioning/embedding model is still loading on Hugging Face.',
      retryable: true,
    });
    const dlqBefore = getDeadLetterQueue().length;
    const jobId = await enqueueJob({
      type: 'ai.analyze',
      data: { imageUrl: 'https://example.com/laptop.jpg' },
      attempts: 3,
      backoffMs: 10,
    });
    expect(mocks.caption).toHaveBeenCalledTimes(3);
    const result = getJobResult(jobId);
    expect(result?.success).toBe(false);
    const dlq = getDeadLetterQueue();
    expect(dlq.length).toBeGreaterThan(dlqBefore);
    expect(dlq.find((e) => e.id === jobId)?.type).toBe('ai.analyze');
  });

  it('a non-retryable caption failure returns failed once — never retried, never DLQ’d', async () => {
    mocks.caption.mockResolvedValue({
      ok: false,
      error: 'The configured Hugging Face token was rejected.',
      retryable: false,
    });
    const dlqBefore = getDeadLetterQueue().length;
    const jobId = await enqueueJob({
      type: 'ai.analyze',
      data: { imageUrl: 'https://example.com/laptop.jpg' },
      attempts: 3,
      backoffMs: 10,
    });
    expect(mocks.caption).toHaveBeenCalledTimes(1);
    const result = getJobResult(jobId);
    expect(result?.success).toBe(false);
    expect(result?.errors?.[0]).toMatch(/token was rejected/);
    expect(getDeadLetterQueue().length).toBe(dlqBefore);
  });

  it('no imageUrl and no caption fails without throwing', async () => {
    const result = await processors['ai.analyze']({
      type: 'ai.analyze',
      data: {},
    });
    expect(result.success).toBe(false);
    expect(result.processed).toBe(0);
    expect(result.errors?.[0]).toMatch(/imageUrl or a caption/);
    expect(mocks.caption).not.toHaveBeenCalled();
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it('the same visual analysis enqueued twice runs once (idempotent)', async () => {
    const input = { caption: 'phase8 idempotency probe' };
    expect(aiVisualAnalysisIdempotencyKey(input)).toBe(
      aiVisualAnalysisIdempotencyKey({ caption: 'phase8 idempotency probe' })
    );
    expect(aiVisualAnalysisIdempotencyKey(input)).not.toBe(
      aiVisualAnalysisIdempotencyKey({ caption: 'a different caption' })
    );
    const first = await enqueueAiVisualAnalysis(input);
    const second = await enqueueAiVisualAnalysis(input);
    expect(second.jobId).toBe(first.jobId);
    expect(mocks.embed).toHaveBeenCalledTimes(1);
    expect(getJobResult(first.jobId)?.success).toBe(true);
  });
});

describe('ai-background-jobs design doc (§12 #12)', () => {
  it('states the sync-today reality and the Upstash owner-gate honestly', () => {
    const doc = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'ai-background-jobs.md'),
      'utf8'
    );
    expect(doc).toContain('ai.analyze');
    expect(doc).toContain('SynchronousQueue');
    expect(doc).toContain('Upstash');
    expect(doc).toContain('a separate worker process');
    expect(doc).toContain('401/403 are never retried');
    expect(doc).toContain('Bulk catalog re-embedding');
  });
});
