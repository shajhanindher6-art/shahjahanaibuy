/**
 * Section 19, Phase 1 (§12 #1) — AI provider registry.
 *
 * Mirrors the product-data `ProviderRegistry`
 * (`services/providers/registry.ts`): register / get / list /
 * filter by capability, with a shared singleton. Registration
 * order is the fallback order for a capability: the engine tries
 * providers in the order they were registered for that capability
 * (e.g. HF CLIP before HF MiniLM for 'visual-embed').
 */

import { logger } from '@/lib/config/logger';
import type { AICapability, AIProvider } from './types';

export class AIEngineRegistry {
  private readonly providers = new Map<string, AIProvider>();

  /**
   * Register a provider. A provider with the same key replaces
   * the existing one (warned, like ProviderRegistry).
   */
  register(provider: AIProvider): void {
    if (this.providers.has(provider.key)) {
      logger.warn('AIEngineRegistry.register — overwriting existing provider', {
        key: provider.key,
      });
    }
    this.providers.set(provider.key, provider);
    logger.debug('AIEngineRegistry.register', {
      key: provider.key,
      name: provider.name,
      kind: provider.kind,
      capabilities: provider.capabilities,
    });
  }

  /** Remove a provider from the registry. */
  unregister(key: string): boolean {
    return this.providers.delete(key);
  }

  /** Get a provider by its key, or undefined if not registered. */
  get(key: string): AIProvider | undefined {
    return this.providers.get(key);
  }

  /** Get all registered providers (including unavailable ones), in registration order. */
  getAll(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  /** Get all providers that are currently available. */
  getAvailable(): AIProvider[] {
    return this.getAll().filter((p) => p.isAvailable());
  }

  /**
   * Get all providers that can serve a capability, in
   * registration order ( = fallback order for that capability).
   */
  getByCapability(capability: AICapability): AIProvider[] {
    return this.getAll().filter((p) => p.capabilities.includes(capability));
  }

  /** Get the available providers for a capability, in fallback order. */
  getAvailableByCapability(capability: AICapability): AIProvider[] {
    return this.getByCapability(capability).filter((p) => p.isAvailable());
  }
}
