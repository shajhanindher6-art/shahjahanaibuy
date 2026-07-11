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
    enabled: Boolean(process.env.REDIS_URL),
    description: 'Caching and background job queues',
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
