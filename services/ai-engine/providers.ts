/**
 * Section 19, Phase 1 (§12 #1) — default AI provider registration.
 *
 * The EXISTING deterministic services are registered as providers
 * — wrapped, never rewritten: each adapter's `invoke()` delegates
 * to the service function that already exists, with the same
 * arguments the routes already pass. Existing service APIs and the
 * `services/index.ts` barrel surface are unchanged.
 *
 * Registration order is fallback order per capability:
 * - 'visual-embed': HF CLIP first, HF MiniLM second (the route's
 *   existing CLIP → MiniLM fallback, now owned by the engine).
 * - Every other capability has one provider today; the chain is
 *   the design for the next provider, not a second implementation.
 *
 * Live-provider key checks read `process.env` DIRECTLY (not the
 * `env` snapshot in `lib/config/env.ts`, which is evaluated once
 * at import). A provider's availability must reflect the current
 * environment — and stay testable via `vi.stubEnv` — rather than
 * the value frozen at module load. Keys are never logged or
 * returned; only their presence is reported.
 *
 * Singleton: `getAiEngine()` builds the engine + registry once.
 * `resetAiEngine()` is test-only.
 */

import { logger } from '@/lib/config/logger';
import { aiSearch, parseSearchIntent, type AISearchOptions } from '@/services/ai-search';
import { getAISummary } from '@/services/ai-summary';
import { getRankedDeals } from '@/services/ai-deals';
import { compareProducts } from '@/services/ai-comparison';
import { predictPriceDrop } from '@/services/ai-predictions';
import { getRecommendations } from '@/services/ai-recommendations';
import { generateChatResponse } from '@/services/chat';
import { buyWaitAssistant, recommendAssistant } from '@/services/personal-assistant';
import {
  answersToFinderInput,
  loadGuidedCandidates,
  rankGuidedPicks,
} from '@/services/guided-finder';
import { searchWebProducts } from '@/services/external-search';
import {
  captionPublicImageUrl,
  embedText,
  embedTextClip,
  searchVisualByImageUrl,
  type HfResult,
} from '@/services/visual-search';
import { AIEngineRegistry } from './registry';
import { AIEngine } from './engine';
import type { AICapability, AIProvider, AIProviderAvailability } from './types';
import { ProviderSkippedError } from './types';

function hasEnvKey(name: string): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '';
}

function liveAvailability(configured: boolean): AIProviderAvailability {
  // Key presence only — never probed (a probe would spend quota).
  return configured ? 'available-unverified' : 'disabled';
}

/** Re-throw a failed HfResult as an Error carrying its `retryable` flag. */
function throwHfError<T>(result: HfResult<T>): never {
  const error = new Error(result.ok ? 'Unexpected HF success' : result.error) as Error & {
    retryable?: boolean;
  };
  if (!result.ok) error.retryable = result.retryable;
  throw error;
}

function deterministicProvider(
  key: string,
  name: string,
  capabilities: AICapability[],
  description: string,
  invoke: AIProvider['invoke']
): AIProvider {
  return {
    key,
    name,
    kind: 'deterministic',
    capabilities,
    description,
    isAvailable: () => true,
    availability: () => 'available',
    invoke,
  };
}

function liveProvider(
  key: string,
  name: string,
  envKey: string,
  capabilities: AICapability[],
  description: string,
  invoke: AIProvider['invoke'],
  usageKey?: string
): AIProvider {
  return {
    key,
    // Adapters over the same backend share one usageKey so their
    // calls, latency, circuit state and provider_health row
    // aggregate per backend (see AIProvider.usageKey).
    ...(usageKey ? { usageKey } : {}),
    name,
    kind: 'live',
    capabilities,
    description,
    isAvailable: () => hasEnvKey(envKey),
    availability: () => liveAvailability(hasEnvKey(envKey)),
    invoke,
  };
}

/**
 * Build a fresh registry with every existing AI service registered.
 * Exported so tests can build an isolated registry (the singleton
 * below is the production one).
 */
export function createDefaultAiRegistry(): AIEngineRegistry {
  const registry = new AIEngineRegistry();

  registry.register(
    deterministicProvider(
      'ai-search',
      'AI Search (catalog)',
      ['search'],
      'Deterministic catalog search with intent parsing and AI scoring — no external call.',
      async (_capability, input) => {
        const supabase = input.supabase as Parameters<typeof aiSearch>[0];
        const options = input.options as AISearchOptions;
        return aiSearch(supabase, options);
      }
    )
  );

  registry.register(
    deterministicProvider(
      'ai-summary',
      'AI Product Summary',
      ['summarize'],
      'Deterministic product summary (pros/cons/alternatives) over recorded rows.',
      async (_capability, input) => {
        const supabase = input.supabase as Parameters<typeof getAISummary>[0];
        const product = input.product as Parameters<typeof getAISummary>[1];
        return getAISummary(supabase, product);
      }
    )
  );

  registry.register(
    deterministicProvider(
      'ai-deals',
      'AI Deal Ranking',
      ['rank-deals'],
      'Deterministic deal ranking over the deals table.',
      async (_capability, input) => {
        const supabase = input.supabase as Parameters<typeof getRankedDeals>[0];
        const options = (input.options ?? {}) as Parameters<typeof getRankedDeals>[1];
        return getRankedDeals(supabase, options);
      }
    )
  );

  registry.register(
    deterministicProvider(
      'ai-comparison',
      'AI Product Comparison',
      ['compare'],
      'Deterministic side-by-side comparison over recorded product rows.',
      async (_capability, input) => {
        const supabase = input.supabase as Parameters<typeof compareProducts>[0];
        const productIds = input.productIds as string[];
        return compareProducts(supabase, productIds);
      }
    )
  );

  registry.register(
    deterministicProvider(
      'ai-predictions',
      'AI Price Prediction',
      ['predict-price-drop'],
      'Deterministic price-drop prediction over recorded price history.',
      async (_capability, input) => {
        const supabase = input.supabase as Parameters<typeof predictPriceDrop>[0];
        const productId = input.productId as string;
        return predictPriceDrop(supabase, productId);
      }
    )
  );

  registry.register(
    deterministicProvider(
      'ai-recommendations',
      'AI Recommendations',
      ['recommend'],
      'Deterministic 4-signal recommendations (wishlist / search / views / preferences).',
      async (_capability, input) => {
        const supabase = input.supabase as Parameters<typeof getRecommendations>[0];
        const userId = input.userId as string;
        const limit = typeof input.limit === 'number' ? input.limit : 10;
        return getRecommendations(supabase, userId, limit);
      }
    )
  );

  registry.register(
    deterministicProvider(
      'chat',
      'Shopping Assistant (chat)',
      ['chat'],
      'Deterministic data-driven chat answers over products, deals, history and coupons.',
      async (_capability, input) => {
        const supabase = input.supabase as Parameters<typeof generateChatResponse>[0];
        const message = input.message as string;
        const history = (input.history ?? []) as Parameters<typeof generateChatResponse>[2];
        const options = (input.options ?? {}) as Parameters<typeof generateChatResponse>[3];
        return generateChatResponse(supabase, message, history, options);
      }
    )
  );

  registry.register(
    deterministicProvider(
      'personal-assistant',
      'Personal Assistant',
      ['assist', 'buy-wait'],
      'Deterministic assistant answers: recommendations and buy-now-or-wait verdicts.',
      async (capability, input) => {
        const supabase = input.supabase as Parameters<typeof recommendAssistant>[0];
        if (capability === 'buy-wait') {
          return buyWaitAssistant(supabase, input.message as string);
        }
        const message = input.message as string;
        const intent = parseSearchIntent(message);
        return recommendAssistant(supabase, intent, message);
      }
    )
  );

  registry.register(
    deterministicProvider(
      'guided-finder',
      'Guided Shopping Quiz',
      ['guided-picks'],
      'Deterministic guided picks: hard budget filter + ranked quiz answers.',
      async (_capability, input) => {
        const supabase = input.supabase as Parameters<typeof loadGuidedCandidates>[0];
        const answers = input.answers as Parameters<typeof answersToFinderInput>[0];
        const candidates = await loadGuidedCandidates(supabase);
        return rankGuidedPicks(candidates, answersToFinderInput(answers));
      }
    )
  );

  registry.register(
    liveProvider(
      'serpapi',
      'SerpAPI (Google Shopping / Lens)',
      'SERPAPI_API_KEY',
      ['web-search', 'visual-lens'],
      'Live web search fallback (Google Shopping) and Lens visual matches. Key-gated; every live call spends free-tier quota and counts against the daily budget.',
      async (capability, input) => {
        if (capability === 'visual-lens') {
          return searchVisualByImageUrl(input.imageUrl as string);
        }
        const supabase = input.supabase as Parameters<typeof searchWebProducts>[0];
        const query = input.query as string;
        const limit = typeof input.limit === 'number' ? input.limit : 10;
        const maxPriceUsd =
          typeof input.maxPriceUsd === 'number' ? input.maxPriceUsd : null;
        return searchWebProducts(supabase, query, limit, { maxPriceUsd });
      }
    )
  );

  // 'visual-embed' fallback chain: CLIP first, MiniLM second.
  // The CLIP adapter declines (ProviderSkippedError) when the
  // caller says the CLIP table has no rows for this request, so
  // the engine falls through to MiniLM without counting a failure.
  // The three HF adapters have DISTINCT registry keys (the
  // registry is keyed by key) but share usageKey 'huggingface',
  // so calls, latency, the circuit breaker and the
  // `provider_health` row aggregate per backend, not per adapter.
  registry.register(
    liveProvider(
      'huggingface-clip',
      'Hugging Face Inference — CLIP embed',
      'HF_API_TOKEN',
      ['visual-embed'],
      'Live CLIP text embedding (512-dim) via the Hugging Face Inference API. First in the visual-embed fallback chain.',
      async (_capability, input) => {
        if (input.preferClip !== true) {
          throw new ProviderSkippedError(
            'CLIP embeddings not available for this request (no CLIP rows) — falling back to MiniLM.'
          );
        }
        const result = await embedTextClip(input.text as string);
        if (!result.ok) throwHfError(result);
        return result.value;
      },
      'huggingface'
    )
  );

  registry.register(
    liveProvider(
      'huggingface-minilm',
      'Hugging Face Inference — MiniLM embed',
      'HF_API_TOKEN',
      ['visual-embed'],
      'Live MiniLM text embedding (384-dim) via the Hugging Face Inference API. Second in the visual-embed fallback chain.',
      async (_capability, input) => {
        const result = await embedText(input.text as string);
        if (!result.ok) throwHfError(result);
        return result.value;
      },
      'huggingface'
    )
  );

  registry.register(
    liveProvider(
      'huggingface-caption',
      'Hugging Face Inference — caption',
      'HF_API_TOKEN',
      ['visual-caption'],
      'Live BLIP image captioning via the Hugging Face Inference API.',
      async (_capability, input) => {
        // The value IS the HfResult: the route decides 503 vs 400
        // from its `retryable` flag, exactly as before.
        return captionPublicImageUrl(input.imageUrl as string);
      },
      'huggingface'
    )
  );

  return registry;
}

let engineSingleton: AIEngine | null = null;

/** Shared engine instance, registering the default providers on first call. */
export function getAiEngine(): AIEngine {
  if (engineSingleton) return engineSingleton;
  engineSingleton = new AIEngine(createDefaultAiRegistry());
  logger.info('AIEngine initialized', {
    providers: engineSingleton.getRegistry().getAll().map((p) => p.key),
  });
  return engineSingleton;
}

/** Test-only reset for the singleton. */
export function resetAiEngine(): void {
  engineSingleton = null;
}
