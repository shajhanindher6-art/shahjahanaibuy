/**
 * AI error breakdown tests (Section 19, Phase 7, §12 #73).
 * getAiErrorBreakdown groups error_log rows by route/level for the
 * AI surface only; migration 048 unapplied → tableMissing and the
 * page renders "error logging not yet active", never a zero chart.
 */
import { describe, expect, it } from 'vitest';
import {
  getAiErrorBreakdown,
  isAiErrorRow,
} from '@/services/error-log-admin';
import type { AnySupabaseClient } from '@/lib/supabase/types';

function fakeClient(
  outcome: { data: Array<Record<string, unknown>> | null; error: { code?: string; message?: string } | null }
): AnySupabaseClient {
  const chain = {
    select: () => chain,
    order: () => chain,
    limit: async () => outcome,
  };
  return {
    from: () => chain,
  } as unknown as AnySupabaseClient;
}

const aiRow = (overrides: Record<string, unknown> = {}) => ({
  id: '1',
  created_at: '2026-11-12T10:00:00.000Z',
  level: 'error',
  message: 'SerpAPI timed out',
  request_id: null,
  route: 'ai-search',
  user_id: null,
  meta: { provider: 'serpapi' },
  ...overrides,
});

describe('isAiErrorRow', () => {
  it('AI route labels count as AI errors', () => {
    expect(isAiErrorRow({ route: 'ai-search' })).toBe(true);
    expect(isAiErrorRow({ route: 'predictions.accuracy' })).toBe(true);
    expect(isAiErrorRow({ route: 'visual-search' })).toBe(true);
    expect(isAiErrorRow({ route: 'chat.messages' })).toBe(true);
  });

  it('refresh rows are NOT AI errors', () => {
    expect(isAiErrorRow({ route: 'prices.refresh' })).toBe(false);
    expect(isAiErrorRow({ route: 'subscriptions' })).toBe(false);
  });

  it('a provider in meta counts even without an AI route label', () => {
    expect(isAiErrorRow({ route: 'unknown', meta: { provider: 'huggingface' } })).toBe(true);
  });
});

describe('getAiErrorBreakdown (§12 #73)', () => {
  it('missing table (048 unapplied) → tableMissing, never an empty chart', async () => {
    const result = await getAiErrorBreakdown(
      fakeClient({ data: null, error: { code: '42P01', message: 'relation does not exist' } })
    );
    expect(result.tableMissing).toBe(true);
    expect(result.total).toBe(0);
    expect(result.byRoute).toEqual([]);
  });

  it('counts only AI rows and groups them by route and level', async () => {
    const result = await getAiErrorBreakdown(
      fakeClient({
        data: [
          aiRow({ id: '1', route: 'ai-search', level: 'error' }),
          aiRow({ id: '2', route: 'ai-search', level: 'error' }),
          aiRow({ id: '3', route: 'visual-search', level: 'critical' }),
          aiRow({ id: '4', route: 'prices.refresh', level: 'error', meta: {} }),
        ],
        error: null,
      })
    );
    expect(result.tableMissing).toBe(false);
    expect(result.total).toBe(3);
    expect(result.scanned).toBe(4);
    expect(result.byRoute).toEqual([
      { label: 'ai-search', count: 2 },
      { label: 'visual-search', count: 1 },
    ]);
    expect(result.byLevel).toEqual([
      { label: 'error', count: 2 },
      { label: 'critical', count: 1 },
    ]);
    expect(result.recent).toHaveLength(3);
  });

  it('table applied but no AI rows → total 0 is a real count', async () => {
    const result = await getAiErrorBreakdown(
      fakeClient({
        data: [aiRow({ id: '9', route: 'prices.refresh', level: 'error', meta: {} })],
        error: null,
      })
    );
    expect(result.tableMissing).toBe(false);
    expect(result.total).toBe(0);
  });
});
