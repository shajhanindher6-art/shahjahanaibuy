/**
 * Section 19, Phase 1 — AI Intelligence Engine (barrel).
 *
 * The centralized engine (registry + adapters + fallback chain +
 * usage/quota/latency tracking + retry) for the deterministic AI
 * services and the two live providers (SerpAPI, Hugging Face).
 * Deterministic-only scope: no LLM provider exists (Phase 0).
 *
 * NOTE on imports: service modules (`services/external-search.ts`,
 * `services/visual-search.ts`) import the LEAF modules
 * (`./usage`, `./retry`, `./health-report`) directly, never this
 * barrel — the barrel imports the provider adapters, which import
 * those services, so importing the barrel from a service would
 * be a cycle.
 */

export { AIEngine } from './engine';
export { AIEngineRegistry } from './registry';
export {
  getAiEngine,
  resetAiEngine,
  createDefaultAiRegistry,
} from './providers';
export type {
  AICapability,
  AIProvider,
  AIProviderAvailability,
  AIProviderKind,
  AIProviderStatus,
  AIEngineResult,
} from './types';
export { ProviderSkippedError, NoAiProviderAvailableError } from './types';
export {
  recordAiCall,
  recordAiCapabilityCall,
  isAiCircuitOpen,
  checkAiUserQuota,
  spendProviderBudget,
  isProviderBudgetExhausted,
  getProviderBudgetState,
  getAiUsageSummary,
  resetAiUsage,
  AI_USER_DAILY_QUOTA,
  AI_SEARCH_ANON_PER_MIN,
  VISUAL_SEARCH_ANON_PER_MIN,
  SCAN_ANON_PER_MIN,
  PROVIDER_DAILY_BUDGETS,
  AI_CIRCUIT_FAILURE_THRESHOLD,
  AI_CIRCUIT_COOLDOWN_MS,
  type AiUsageSummary,
  type AiProviderBudgetState,
  type AiUserQuotaCheck,
} from './usage';
export { withAiRetry, isRetryableError, isRetryableStatus, sleep } from './retry';
export { reportAiProviderHealth } from './health-report';
