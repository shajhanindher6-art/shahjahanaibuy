/**
 * Final 100%, F-P2-56 — AI quota enforcement labelling.
 *
 * The shared Upstash counter backend exists (services/ai-engine/
 * quota-store.ts) and the async wrappers try it first, but
 * enforcement is shared ONLY when Upstash is configured (owner-
 * gated). Without it, quotas are per-instance in-memory counters
 * and bypassable across Vercel instances. This file pins the honest
 * labelling: the usage summary now carries a machine-readable
 * `enforcement: 'shared' | 'per-instance'` field, and the note
 * names the real state. Nothing here claims shared enforcement.
 */
import { describe, expect, it } from 'vitest';
import {
  getAiUsageSummary,
  getAiUsageSummaryAsync,
} from '@/services/ai-engine/usage';

describe('F-P2-56 — AI quota enforcement is labelled honestly', () => {
  it('sync summary is always per-instance (it never consults Upstash)', () => {
    const summary = getAiUsageSummary();
    expect(summary.enforcement).toBe('per-instance');
    expect(summary.note).toMatch(/per-instance/i);
  });

  it('async summary reports per-instance when Upstash is not configured', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const summary = await getAiUsageSummaryAsync();
    expect(summary.enforcement).toBe('per-instance');
    expect(summary.note).toMatch(/NOT configured/i);
  });
});
