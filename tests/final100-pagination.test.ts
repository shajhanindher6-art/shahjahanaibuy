/**
 * Final 100%, F-P2-60 — pagination / hard caps on list reads.
 *
 * The audit found 31/137 GET routes using `.limit()`/`.range()` and
 * `getAlerts` uncapped. The slice caps the highest-traffic list
 * reads; this file pins the caps so a later edit cannot silently
 * uncap a list again. Counts are re-measured at gate time, never
 * copied forward — the numbers below are what the tree said on
 * 2026-11-13 (~15:20 PKT): getAlerts default 100 / max 500,
 * buy-list + wishlists + saved-searches hard-capped at 100,
 * affiliate links ?limit= default 50 / cap 100, chat conversations
 * default 20 / cap 50, chat messages capped at 100. The remaining
 * GET routes (single-row lookups by id/slug, or routes whose
 * service already pages with page/pageSize ≤ 100 — products, deals,
 * admin products, alerts/history) are out of scope for this slice
 * and documented as a deviation in the W7 report, not claimed done.
 */
import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAlerts, GET_ALERTS_DEFAULT_LIMIT, GET_ALERTS_MAX_LIMIT } from '@/services/alerts';
import { getConversations } from '@/services/chat';
import type { AnySupabaseClient } from '@/lib/supabase/types';

function read(rel: string): string {
  return fs.readFileSync(`${process.cwd()}/${rel}`, 'utf8');
}

/** Minimal chainable fake: select/eq/order chain, limit() captures n and resolves empty. */
function makeFakeClient(capture: { limit?: number }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: (n: number) => {
      capture.limit = n;
      return Promise.resolve({ data: [], error: null });
    },
  };
  return { from: (_table: string) => chain } as unknown as AnySupabaseClient;
}

describe('F-P2-60 — getAlerts is capped (was uncapped)', () => {
  it('defaults to 100 and hard-caps at 500', async () => {
    expect(GET_ALERTS_DEFAULT_LIMIT).toBe(100);
    expect(GET_ALERTS_MAX_LIMIT).toBe(500);

    const capture: { limit?: number } = {};
    const rows = await getAlerts(makeFakeClient(capture), 'user-1');
    expect(rows).toEqual([]);
    expect(capture.limit).toBe(100);

    const capture2: { limit?: number } = {};
    await getAlerts(makeFakeClient(capture2), 'user-1', 999);
    expect(capture2.limit).toBe(500);

    const capture3: { limit?: number } = {};
    await getAlerts(makeFakeClient(capture3), 'user-1', 5);
    expect(capture3.limit).toBe(5);
  });
});

describe('F-P2-60 — chat lists are capped', () => {
  it('getConversations defaults to 20 and caps at 50', async () => {
    const capture: { limit?: number } = {};
    const rows = await getConversations(makeFakeClient(capture), 'user-1');
    expect(rows).toEqual([]);
    expect(capture.limit).toBe(20);

    const capture2: { limit?: number } = {};
    await getConversations(makeFakeClient(capture2), 'user-1', 999);
    expect(capture2.limit).toBe(50);
  });

  it('getChatMessages caps at 100 (source pin)', () => {
    const src = read('services/chat.ts');
    expect(src).toContain('.limit(100)');
  });
});

describe('F-P2-60 — per-user lists are hard-capped at 100 (source pins)', () => {
  it('getBuyList caps at 100', () => {
    expect(read('lib/buy-list.ts')).toContain('.limit(100)');
  });

  it('getWishlists caps at 100', () => {
    expect(read('services/wishlists.ts')).toContain('.limit(100)');
  });

  it('saved-searches list caps at 100', () => {
    expect(read('services/saved-searches.ts')).toContain('.limit(100)');
  });

  it('affiliate links ?limit= defaults to 50 and caps at 100', () => {
    const src = read('app/api/v1/affiliate/links/route.ts');
    expect(src).toContain('Math.min(100, Math.max(1, Number(searchParams.get(\'limit\'');
    expect(src).toContain('.limit(limit)');
  });
});
