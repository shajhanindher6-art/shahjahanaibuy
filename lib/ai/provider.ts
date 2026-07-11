/**
 * AI provider abstraction layer.
 *
 * This module defines the interface that all AI providers must implement.
 * Phase 1: only the architecture is in place — no providers are wired up.
 * Future phases will add OpenAI, and potentially other providers, all
 * behind this interface so business logic never depends on a specific provider.
 */

export interface AIProvider {
  key: string;
  name: string;
  isAvailable(): boolean;
}

export interface RecommendationRequest {
  userId: string;
  query?: string;
  budget?: number;
  preferences?: Record<string, unknown>;
}

export interface RecommendationResponse {
  recommendations: Array<{
    productId: string;
    score: number;
    explanation: string;
  }>;
  provider: string;
}

export interface AIProviderRegistry {
  providers: Map<string, AIProvider>;
  register(provider: AIProvider): void;
  get(key: string): AIProvider | undefined;
  getAvailable(): AIProvider[];
}

export function createAIProviderRegistry(): AIProviderRegistry {
  const providers = new Map<string, AIProvider>();
  return {
    providers,
    register(provider: AIProvider) {
      providers.set(provider.key, provider);
    },
    get(key: string) {
      return providers.get(key);
    },
    getAvailable() {
      return Array.from(providers.values()).filter((p) => p.isAvailable());
    },
  };
}
