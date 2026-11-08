import { describe, expect, it } from 'vitest';
import {
  CLIP_EMBEDDING_DIMS,
  normalizeClipEmbedding,
} from '@/services/visual-search';

function vec(value: number): number[] {
  return new Array(CLIP_EMBEDDING_DIMS).fill(value);
}

describe('normalizeClipEmbedding (CLIP 512-dim space)', () => {
  it('passes a flat 512-dim vector through unchanged', () => {
    const input = vec(0).map((_, i) => i / CLIP_EMBEDDING_DIMS);
    expect(normalizeClipEmbedding(input)).toEqual(input);
  });

  it('mean-pools per-token vectors [seq][512]', () => {
    // Two tokens: all 0s and all 2s → mean is all 1s.
    const pooled = normalizeClipEmbedding([vec(0), vec(2)]);
    expect(pooled).not.toBeNull();
    expect(pooled!.every((n) => n === 1)).toBe(true);
  });

  it('unwraps a batched [1][seq][512] tensor, then mean-pools', () => {
    const pooled = normalizeClipEmbedding([[vec(0), vec(4)]]);
    expect(pooled).not.toBeNull();
    expect(pooled!.every((n) => n === 2)).toBe(true);
  });

  it('rejects wrong dimensions and non-finite values', () => {
    expect(normalizeClipEmbedding(new Array(384).fill(0))).toBeNull(); // MiniLM dims, not CLIP
    expect(normalizeClipEmbedding(vec(0).map(() => NaN))).toBeNull();
    expect(normalizeClipEmbedding(vec(0).map(() => Infinity))).toBeNull();
    expect(normalizeClipEmbedding([])).toBeNull();
    expect(normalizeClipEmbedding(null)).toBeNull();
    expect(normalizeClipEmbedding('not a vector')).toBeNull();
    // Ragged token rows: one row is 384-dim — not a valid 512 space.
    expect(normalizeClipEmbedding([vec(1), new Array(384).fill(1)])).toBeNull();
  });
});
