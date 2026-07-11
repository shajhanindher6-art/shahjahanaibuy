/**
 * Storage provider registry.
 *
 * Selects a single active `StorageProvider` at process start using a strict
 * priority order: Cloudflare R2 > AWS S3 > Local in-memory. The first
 * provider whose `isAvailable()` returns true wins and is cached for the life
 * of the process, so callers always get the same instance via
 * `getStorageProvider()`.
 */

import { logger } from '@/lib/config/logger';
import { R2StorageProvider } from './r2-provider';
import { S3StorageProvider } from './s3-provider';
import { LocalStorageProvider } from './local-provider';
import type { StorageProvider } from './types';

let cached: StorageProvider | null = null;

/**
 * Builds the provider preference list in priority order. Exposed for tests
 * so the ordering can be inspected without relying on env state.
 */
function buildCandidates(): StorageProvider[] {
  return [new R2StorageProvider(), new S3StorageProvider(), new LocalStorageProvider()];
}

/**
 * Returns the active storage provider, selecting one on first use.
 *
 * Selection logs which provider was chosen (and which higher-priority
 * candidates were skipped) at info level for operational visibility.
 */
export function getStorageProvider(): StorageProvider {
  if (cached) return cached;

  const candidates = buildCandidates();
  for (const provider of candidates) {
    if (provider.isAvailable()) {
      cached = provider;
      logger.info('Storage provider selected', {
        provider: provider.key,
        name: provider.name,
      });
      return cached;
    }
    logger.debug('Storage provider unavailable, skipping', { provider: provider.key });
  }

  // LocalStorageProvider.isAvailable() is always true, so this is unreachable
  // in practice — but the type system can't see that.
  throw new Error('No storage provider available');
}

/**
 * Resets the cached provider. Intended for tests that need to re-evaluate
 * availability after changing environment variables.
 */
export function resetStorageProvider(): void {
  cached = null;
}

/**
 * Returns the list of all known providers and their availability, useful for
 * health checks and admin dashboards.
 */
export function listStorageProviders(): Array<{
  key: string;
  name: string;
  available: boolean;
}> {
  return buildCandidates().map((p) => ({
    key: p.key,
    name: p.name,
    available: p.isAvailable(),
  }));
}
