/**
 * Final 100%, F-P2-59 — env inventory reconciliation.
 *
 * The three provider keys that used to bypass lib/config/env.ts
 * (AMAZON_CREATORS_API_KEY, BESTBUY_API_KEY, CSV_SOURCE_URL) now
 * read through it. The central validator (services/provider-config)
 * still validates the RAW environment object — that is its job
 * (it names bad/missing config at boot); it is not a bypass, the
 * *readers* are what moved.
 *
 * Counts measured 2026-11-13 (recorded here as documentation, not
 * asserted — other workers add routes concurrently):
 *  - 61 distinct process.env.X names across app/services/lib/
 *    scripts/middleware/next.config (matches the audit's 61).
 *  - 43 entries in .env.example (commented + uncommented).
 *  - 29 code names absent from .env.example; most are legitimately
 *    absent (Vercel-provided VERCEL_ENV / VERCEL_GIT_COMMIT_SHA,
 *    runtime NODE_ENV, server alias SUPABASE_URL). The three routed
 *    keys were already present in .env.example (commented).
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';

function src(p: string): string {
  return fs.readFileSync(`${process.cwd()}/${p}`, 'utf8');
}

describe('F-P2-59 — the three provider keys route through env.ts', () => {
  it('env.ts exposes all three as optional reads', () => {
    // Getters, not snapshot values: providers read these at call
    // time, and tests (Section 20 merchant-layer) set the vars
    // after import — a snapshot taken at import would stay stale.
    const s = src('lib/config/env.ts');
    expect(s).toContain('get amazonCreatorsApiKey()');
    expect(s).toContain('return process.env.AMAZON_CREATORS_API_KEY;');
    expect(s).toContain('get bestbuyApiKey()');
    expect(s).toContain('return process.env.BESTBUY_API_KEY;');
    expect(s).toContain('get csvSourceUrl()');
    expect(s).toContain('return process.env.CSV_SOURCE_URL;');
  });

  it('amazon-provider reads env.amazonCreatorsApiKey, not process.env', () => {
    const s = src('services/providers/amazon-provider.ts');
    expect(s).toContain('env.amazonCreatorsApiKey');
    expect(s).not.toContain('process.env.AMAZON_CREATORS_API_KEY');
  });

  it('bestbuy-provider reads env.bestbuyApiKey, not process.env', () => {
    const s = src('services/providers/bestbuy-provider.ts');
    expect(s).toContain('env.bestbuyApiKey');
    expect(s).not.toContain('process.env.BESTBUY_API_KEY');
  });

  it('registry + data/refresh read env.csvSourceUrl, not process.env', () => {
    const reg = src('services/providers/registry.ts');
    expect(reg).toContain('env.csvSourceUrl');
    expect(reg).not.toContain('process.env.CSV_SOURCE_URL');
    const refresh = src('app/api/v1/data/refresh/route.ts');
    expect(refresh).toContain('env.csvSourceUrl');
    expect(refresh).not.toContain('process.env.CSV_SOURCE_URL');
  });

  it('.env.example documents all three keys (commented placeholders)', () => {
    const s = src('.env.example');
    expect(s).toContain('#CSV_SOURCE_URL=');
    expect(s).toContain('#BESTBUY_API_KEY=');
    expect(s).toContain('#AMAZON_CREATORS_API_KEY=');
  });
});
