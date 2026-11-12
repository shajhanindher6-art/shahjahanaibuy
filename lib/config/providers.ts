/**
 * Provider configuration registry.
 *
 * Every external provider (AI, data collection, storage, caching) is registered
 * here with a key, display name, and enabled flag. The actual provider clients
 * live in their respective service modules — this registry is the single source
 * of truth for which providers are active.
 *
 * Phase 1: only the architecture is defined. No provider clients are wired up.
 */

export interface ProviderConfig {
  key: string;
  name: string;
  category: 'ai' | 'data' | 'storage' | 'cache' | 'auth';
  enabled: boolean;
  description: string;
}

export const PROVIDERS: ProviderConfig[] = [
  {
    key: 'openai',
    name: 'OpenAI',
    category: 'ai',
    enabled: Boolean(process.env.OPENAI_API_KEY),
    description: 'GPT models for recommendations, analysis, and search',
  },
  {
    key: 'supabase-auth',
    name: 'Supabase Auth',
    category: 'auth',
    enabled: true,
    description: 'Email/password and OAuth authentication',
  },
  {
    key: 'cloudflare-r2',
    name: 'Cloudflare R2',
    category: 'storage',
    enabled: Boolean(process.env.CLOUDFLARE_R2_ACCOUNT_ID),
    description: 'Object storage for product images and assets',
  },
  {
    key: 'redis',
    name: 'Redis',
    category: 'cache',
    // Section 18, item 32 — corrected 12 Nov 2026: REDIS_URL does
    // NOT enable a Redis cache or queue. No `ioredis` / BullMQ is
    // installed, the app cache is always in-memory (lib/cache), and
    // REDIS_URL only switches the Upstash REST rate limiter on
    // (lib/api/rate-limit.ts). Reporting this provider "enabled"
    // when the var is set was the misleading signal the audit
    // flagged — it is always off as a cache/queue provider until a
    // real Redis client is wired.
    enabled: false,
    description:
      'Not used as a cache or queue — REDIS_URL only enables Upstash REST rate limiting; the app cache is always in-memory',
  },
  {
    key: 'apify',
    name: 'Apify',
    category: 'data',
    enabled: false,
    description: 'Approved data collection provider for retailer catalogs',
  },
];

export function getEnabledProviders(category?: ProviderConfig['category']): ProviderConfig[] {
  return PROVIDERS.filter((p) => (category ? p.category === category : true) && p.enabled);
}
