/**
 * Section 19, Phase 1 (§12 #1, #3, #4, #9) — the centralized AI
 * Intelligence Engine.
 *
 * Routes an AI call through the registered providers for a
 * capability, in registration (fallback) order:
 *   1. Skip providers that are unavailable (`isAvailable()` false)
 *      or whose in-memory circuit is open (usage.ts — same
 *      5-failure threshold as the durable circuit in
 *      `services/monitoring.ts`).
 *   2. Try each remaining provider's `invoke()` in order. A
 *      `ProviderSkippedError` declines without counting as a
 *      failure (e.g. CLIP asked to serve when no CLIP embeddings
 *      exist for this request); any other throw counts as a
 *      failure and the engine moves to the next provider.
 *   3. On success, return an `AIEngineResult` with `fallbackUsed`
 *      (true when the serving provider was not the first candidate
 *      tried) so callers/UI can disclose it (§12 #4).
 *   4. Every attempt records per-capability latency in the
 *      in-memory usage store (usage.ts, §12 #9). Per-PROVIDER
 *      usage/latency is recorded by the services themselves at the
 *      actual HTTP call (`recordAiCall` in external-search.ts /
 *      visual-search.ts) — that covers engine-routed calls AND
 *      direct callers (admin backfill, digest, alternative
 *      recommender), so the engine must NOT record it too (it
 *      would double-count). Durable `provider_health` rows are
 *      likewise written by the service (SerpAPI — it has the
 *      client) or by the route from the engine result (HF — the
 *      service has no client in scope); the engine writes none.
 *      The ONE durable write the engine does make is the AI usage
 *      ledger (Section 21, Stage E, E-P2-9): one row per
 *      engine-routed capability call via recordEngineUsageLedger
 *      (usage-ledger.ts), fire-and-forget, gracefully no-op until
 *      migration 067 is applied. That is the durable counterpart
 *      of recordAiCapabilityCall, not of recordAiCall — it cannot
 *      double-count provider-level usage, which is never written
 *      here.
 *
 * `validate()` (§12 #3) is the live provider-registry validation
 * the health endpoint calls: deterministic providers report
 * 'available'; live providers report 'available-unverified' on
 * key presence ONLY — no network probe is ever made, so validation
 * burns zero SerpAPI/HF quota. A key's presence is not proof the
 * provider works; the label says so.
 *
 * Section 21, Stage E (E-P2-1) — input freshness is read HERE,
 * in the engine, not only in the adapters: `invoke()` computes
 * `describeEngineInputFreshness(input)` once per call and
 * attaches the verdict to the returned `AIEngineResult` as
 * `inputFreshness`, so EVERY capability's caller — not just the
 * two adapters that qualify their own copy (providers.ts) — can
 * see whether the result was computed from stale/unverified
 * prices and label it accordingly. The engine does not withhold
 * or downgrade on stale input: no capability defines a
 * withholding policy, and inventing one would silently change
 * every AI surface.
 */

import type { AIEngineResult, AICapability, AIProviderStatus, AIEngineInput } from './types';
import { NoAiProviderAvailableError, ProviderSkippedError } from './types';
import type { AIEngineRegistry } from './registry';
import { isAiCircuitOpen, recordAiCapabilityCall } from './usage';
import { recordEngineUsageLedger } from './usage-ledger';
import { describeEngineInputFreshness } from './input-freshness';

export class AIEngine {
  private readonly registry: AIEngineRegistry;

  constructor(registry: AIEngineRegistry) {
    this.registry = registry;
  }

  getRegistry(): AIEngineRegistry {
    return this.registry;
  }

  /**
   * Route one capability call through the registered providers.
   * Throws `NoAiProviderAvailableError` when no provider could
   * serve it (callers that have an honest degraded path — e.g.
   * the ai-search web leg — catch it and fall back).
   */
  async invoke<T>(
    capability: AICapability,
    input: AIEngineInput
  ): Promise<AIEngineResult<T>> {
    // Section 21, Stage E (E-P2-1) — read the typed freshness /
    // verification input once, up front, and carry the verdict on
    // the result so every caller sees it (see the header note).
    // Pure, no I/O, never throws.
    const inputFreshness = describeEngineInputFreshness(input);
    const candidates = this.registry
      .getByCapability(capability)
      .filter((p) => typeof p.invoke === 'function');
    const attempted: string[] = [];
    let lastError: unknown = null;

    for (let i = 0; i < candidates.length; i++) {
      const provider = candidates[i];
      if (!provider.isAvailable()) continue;
      // Usage/circuit accounting is per backend (usageKey), not
      // per adapter: the three Hugging Face adapters share one
      // circuit and one provider_health row.
      const usageKey = provider.usageKey ?? provider.key;
      if (isAiCircuitOpen(usageKey)) continue;
      attempted.push(provider.key);
      const start = Date.now();
      try {
        const value = (await provider.invoke!(capability, input)) as T;
        const latencyMs = Date.now() - start;
        recordAiCapabilityCall(capability, latencyMs, true);
        // Section 21, Stage E (E-P2-9) — durable usage ledger
        // (one row per engine-routed call, $0 while
        // deterministic-only; no-op until migration 067 applies).
        recordEngineUsageLedger(input, {
          providerKey: provider.key,
          capability,
          success: true,
          latencyMs,
        });
        return {
          value,
          providerKey: provider.key,
          providerName: provider.name,
          usageKey,
          // Fallback = the serving provider was NOT the first
          // candidate for this capability — whether the earlier
          // ones failed, declined, were unavailable, or were
          // circuit-open. A circuit-open first choice that is
          // skipped (never attempted) still means a fallback served.
          fallbackUsed: i > 0,
          attemptedProviders: [...attempted],
          latencyMs,
          inputFreshness,
        };
      } catch (err) {
        const latencyMs = Date.now() - start;
        if (err instanceof ProviderSkippedError) {
          // Declined, not failed: no failure count, no health row,
          // but the provider WAS attempted, so a later provider
          // serving still counts as a fallback.
          continue;
        }
        lastError = err;
        recordAiCapabilityCall(capability, latencyMs, false);
        // Section 21, Stage E (E-P2-9) — failed attempts are
        // ledgered too (success: false), same no-op-until-067.
        recordEngineUsageLedger(input, {
          providerKey: provider.key,
          capability,
          success: false,
          latencyMs,
        });
      }
    }

    if (lastError) throw lastError;
    throw new NoAiProviderAvailableError(capability, attempted);
  }

  /**
   * Live provider-registry validation (§12 #3). Synchronous and
   * quota-free by design: availability is key presence for live
   * providers (reported 'available-unverified', never 'available'
   * — a present key is not proof the provider answers) and always
   * true for deterministic providers. Called by the health
   * endpoint; it must never throw.
   */
  validate(): AIProviderStatus[] {
    return this.registry.getAll().map((p) => {
      const available = p.isAvailable();
      const status = p.availability();
      return {
        key: p.key,
        name: p.name,
        kind: p.kind,
        capabilities: [...p.capabilities],
        available,
        status,
        detail:
          p.kind === 'deterministic'
            ? 'Deterministic template over recorded data — always available.'
            : available
              ? 'Key configured — availability NOT probed (no quota spent); live status unverified.'
              : 'Not configured — no key set; calls fall back honestly and spend no quota.',
      };
    });
  }
}
