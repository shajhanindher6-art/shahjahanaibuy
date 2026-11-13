/**
 * Shared AI prediction-accuracy source tests (Section 19, Phase 7,
 * §12 #71 + #72). getAiAccuracySummary is the ONE computation both
 * /admin/ai and /owner read — these tests lock its fail-safe
 * contract: missing table (032 unapplied) → tableMissing + empty
 * summary, never a throw and never a percentage.
 */
import { describe, expect, it } from 'vitest';
import { getAiAccuracySummary } from '@/services/ai-accuracy';
import type { AnySupabaseClient } from '@/lib/supabase/types';

type OutcomeRow = { status: string; horizon_days: number };

function fakeClient(
  outcome: { data: OutcomeRow[] | null; error: { code?: string; message?: string } | null }
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

describe('getAiAccuracySummary (§12 #71/#72 shared source)', () => {
  it('missing table (032 unapplied) → tableMissing + "not enough history" summary, no throw', async () => {
    const result = await getAiAccuracySummary(
      fakeClient({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } })
    );
    expect(result.tableMissing).toBe(true);
    expect(result.summary.accuracyPercent).toBeNull();
    expect(result.summary.status).toBe('not-enough-history');
    expect(result.summary.resolved).toBe(0);
  });

  it('20 resolved outcomes → a published percentage with the sample size', async () => {
    const rows: OutcomeRow[] = [
      ...Array.from({ length: 15 }, () => ({ status: 'correct', horizon_days: 30 })),
      ...Array.from({ length: 5 }, () => ({ status: 'incorrect', horizon_days: 30 })),
    ];
    const result = await getAiAccuracySummary(fakeClient({ data: rows, error: null }));
    expect(result.tableMissing).toBe(false);
    expect(result.summary.resolved).toBe(20);
    expect(result.summary.accuracyPercent).toBe(75);
    expect(result.summary.status).toBe('ready');
  });

  it('fewer than 20 resolved → no percentage, sample size still reported', async () => {
    const rows: OutcomeRow[] = [
      { status: 'correct', horizon_days: 7 },
      { status: 'pending', horizon_days: 30 },
    ];
    const result = await getAiAccuracySummary(fakeClient({ data: rows, error: null }));
    expect(result.summary.accuracyPercent).toBeNull();
    expect(result.summary.resolved).toBe(1);
    expect(result.summary.pending).toBe(1);
  });

  it('non-missing-table read error → error reported, empty summary', async () => {
    const result = await getAiAccuracySummary(
      fakeClient({ data: null, error: { code: '42501', message: 'permission denied' } })
    );
    expect(result.tableMissing).toBe(false);
    expect(result.error).toMatch(/permission denied/);
    expect(result.summary.accuracyPercent).toBeNull();
  });
});
