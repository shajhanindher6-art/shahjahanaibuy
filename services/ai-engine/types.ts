/**
 * Section 19, Phase 1 (§12 #1, #3, #4) — AI Intelligence Engine types.
 *
 * The centralized engine mirrors the product-data `ProviderRegistry`
 * pattern (`services/providers/registry.ts`): an `AIProvider` adapter
 * interface, a registry, and an engine that routes calls through
 * registered providers with an ordered fallback chain.
 *
 * DETERMINISTIC-ONLY SCOPE (Phase 0, §12 #2): no LLM provider is
 * configured. The `kind: 'live'` providers below are the two that
 * already exist — SerpAPI (web search / Lens) and Hugging Face
 * Inference (caption / embeddings) — both key-gated and honest
 * about being unverified when only key presence is known. No OpenAI
 * / Anthropic / Gemini client exists; adding one is owner-gated.
 */

export type AICapability =
  | 'search'
  | 'web-search'
  | 'visual-lens'
  | 'visual-caption'
  | 'visual-embed'
  | 'summarize'
  | 'rank-deals'
  | 'compare'
  | 'predict-price-drop'
  | 'recommend'
  | 'chat'
  | 'assist'
  | 'buy-wait'
  | 'guided-picks';

export type AIProviderKind = 'deterministic' | 'live';

/**
 * Honest availability, as reported by `validate()` (see engine.ts):
 * - 'available' — deterministic provider, or a live provider that
 *   was actually probed successfully (no live provider is probed
 *   today: probing would spend quota).
 * - 'available-unverified' — a live provider whose key is present,
 *   so calls are attempted, but whose live status was NOT probed.
 *   Never read this as "confirmed working".
 * - 'disabled' — a live provider with no key configured; its
 *   calls are never attempted and callers fall back honestly.
 */
export type AIProviderAvailability = 'available' | 'available-unverified' | 'disabled';

/**
 * Typed engine input (Section 20, §12 #82). The engine used to
 * take a bare `Record<string, unknown>`, so no AI call could tell
 * a verified price from an unverified one — `priceVerificationStatus`
 * had zero hits in any AI service. Every AI input that carries a
 * product price SHOULD carry these two fields; adapters must read
 * them (not a bare record) when they qualify price copy. The index
 * signature keeps existing adapter call sites compiling — the typed
 * fields are additive, not a breaking change.
 */
export interface AIEngineInput extends Record<string, unknown> {
  /**
   * Price-verification rollup for the product(s) behind this call
   * (types/index.ts Product.priceVerificationStatus). 'unverified'
   * is the honest default: until migration 045 is applied no
   * verified stamp can exist in the database at all.
   */
  priceVerificationStatus?: import('@/services/price-verification').PriceVerificationStatus;
  /**
   * Last recorded price check for the product(s) behind this call
   * (products.data_freshness). Lets adapters qualify "current"
   * copy with the real staleness instead of assuming fresh.
   */
  dataFreshness?: string | null;
  /** Product id(s) the call is about, when known. */
  productId?: string;
}

export interface AIProvider {
  /** Stable key, e.g. 'ai-search', 'serpapi', 'huggingface-clip'. Unique in the registry. */
  key: string;
  /**
   * Usage/accounting key shared by adapters over the same backend
   * (e.g. all three Hugging Face adapters share usageKey
   * 'huggingface', so call counts, latency, the circuit breaker
   * and the `provider_health` row aggregate per backend, not per
   * adapter). Defaults to `key` when omitted.
   */
  usageKey?: string;
  /** Human-readable name for the admin summary / health output. */
  name: string;
  /** 'deterministic' = template over recorded data; 'live' = a real external API call. */
  kind: AIProviderKind;
  /** Capabilities this provider can serve, in the order it prefers to serve them. */
  capabilities: AICapability[];
  /** Short description of what the provider does (and does not do). */
  description: string;
  /** True when the provider can serve a call right now (deterministic: always; live: key present). */
  isAvailable(): boolean;
  /** The honest availability label (see AIProviderAvailability). */
  availability(): AIProviderAvailability;
  /**
   * Serve one capability. `input` is a typed engine input
   * (AIEngineInput — Section 20, §12 #82): adapters read
   * `priceVerificationStatus` / `dataFreshness` from it when they
   * qualify price copy, instead of treating every recorded price
   * as verified. Throw to let the engine fall back to the next
   * provider; throw `ProviderSkippedError` to decline without
   * counting as a failure (e.g. CLIP embeddings not set up for
   * this request). Adapters for deterministic services delegate
   * to the existing service function — they do NOT reimplement it.
   */
  invoke?(capability: AICapability, input: AIEngineInput): Promise<unknown>;
}

/** Thrown by a provider to decline a call without it counting as a failure. */
export class ProviderSkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderSkippedError';
  }
}

/** Thrown by the engine when no registered provider can serve a capability. */
export class NoAiProviderAvailableError extends Error {
  readonly capability: AICapability;
  constructor(capability: AICapability, attempted: string[]) {
    super(
      attempted.length > 0
        ? `No AI provider could serve "${capability}" (attempted: ${attempted.join(', ')})`
        : `No available AI provider registered for capability "${capability}"`
    );
    this.name = 'NoAiProviderAvailableError';
    this.capability = capability;
  }
}

/**
 * The result of an engine-routed call. `fallbackUsed` is the
 * disclosure label (§12 #4): true when the provider that served
 * the request was NOT the first candidate for the capability —
 * whether the earlier ones failed, declined, were unavailable, or
 * were circuit-open. Callers surface it (e.g. `meta.fallbackUsed`)
 * so the UI can say which path served the answer.
 */
export interface AIEngineResult<T> {
  value: T;
  providerKey: string;
  providerName: string;
  /**
   * Backend accounting key (usageKey, e.g. 'huggingface' shared by
   * the CLIP/MiniLM/caption adapters). Callers that report durable
   * provider health use this, not providerKey.
   */
  usageKey: string;
  fallbackUsed: boolean;
  /** Every provider tried for this call, in order (including skips/failures). */
  attemptedProviders: string[];
  /** Wall-clock ms of the serving provider call (excludes earlier failed attempts). */
  latencyMs: number;
}

export interface AIProviderStatus {
  key: string;
  name: string;
  kind: AIProviderKind;
  capabilities: AICapability[];
  /** Whether isAvailable() is true right now. */
  available: boolean;
  status: AIProviderAvailability;
  /** Plain-language note for the health endpoint / admin page. */
  detail: string;
}
