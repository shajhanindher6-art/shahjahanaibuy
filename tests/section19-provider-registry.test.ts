/**
 * Section 19, Phase 0 (§12 #2) — LLM-provider decision in code.
 *
 * The registry used to report `openai.enabled: true` whenever
 * OPENAI_API_KEY was set — but no OpenAI client exists anywhere
 * in the repo, so the key changed nothing while the flag claimed
 * an AI provider was active. The key decision itself (real LLM
 * provider vs deterministic-only) is owner-gated; the code must
 * not keep lying either way. These tests pin the honest state:
 * deterministic-only, no LLM provider configured, and no
 * environment variable can flip the registry to claim otherwise.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDERS, getEnabledProviders } from '@/lib/config/providers';

describe('provider registry — deterministic-only, no LLM provider', () => {
  it('reports no enabled AI provider', () => {
    expect(getEnabledProviders('ai')).toEqual([]);
    const enabledAi = PROVIDERS.filter((p) => p.category === 'ai' && p.enabled);
    expect(enabledAi).toEqual([]);
  });

  it('the OpenAI entry exists but is explicitly disabled, and says why', () => {
    const openai = PROVIDERS.find((p) => p.key === 'openai');
    expect(openai).toBeDefined();
    expect(openai?.enabled).toBe(false);
    expect(openai?.description).toMatch(/no LLM provider/i);
    expect(openai?.description).toMatch(/deterministic-only/i);
  });

  it('no environment variable can flip the OpenAI flag (source check)', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'config', 'providers.ts'), 'utf8');
    // A real code line (not the correction comment quoting the old
    // line) must never compute `enabled` from OPENAI_API_KEY.
    expect(src).not.toMatch(/^\s*enabled: Boolean\(process\.env\.OPENAI_API_KEY\),?$/m);
    expect(src).toContain('deterministic-only');
  });

  it('still reports the genuinely-enabled providers (Supabase Auth)', () => {
    const auth = PROVIDERS.find((p) => p.key === 'supabase-auth');
    expect(auth?.enabled).toBe(true);
    expect(getEnabledProviders('auth')).toEqual([auth]);
  });
});
