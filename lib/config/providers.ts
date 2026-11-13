/**
 * Provider configuration registry.
 *
 * Every external provider (AI, data collection, storage, caching) is registered
 * here with a key, display name, and enabled flag. The actual provider clients
 * live in their respective service modules — this registry is the single source
 * of truth for which providers are active.
 *
 * Section 19, Phase 0 (§12 #2) — DETERMINISTIC-ONLY SCOPE, stated
 * explicitly: NO LLM provider is configured. There is no OpenAI
 * (or Anthropic / Gemini) client anywhere in the codebase — grep
 * `api.openai.com|openai|anthropic|claude|gemini` outside this
 * file finds only a Hugging Face model NAME
 * (`openai/clip-vit-base-patch32`, services/visual-search.ts),
 * never a client. Setting OPENAI_API_KEY used to flip the
 * registry's `openai.enabled` to true while changing nothing at
 * all — the flag lied. It is now always false until a real client
 * is wired, which needs the owner's provider decision + key
 * (owner-gated, Section 19 audit §1 #5). Until then, every AI
 * answer in this codebase is a deterministic template over
 * recorded data — never presented as LLM reasoning.
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
    // Section 19, Phase 0 (§12 #2) — corrected 12 Nov 2026:
    // `enabled: Boolean(process.env.OPENAI_API_KEY)` was the
    // misleading signal the audit flagged. No OpenAI client exists
    // anywhere in the repo, so setting the key changed nothing
    // while the registry claimed an AI provider was active. It is
    // always off until a real client is wired — the provider
    // decision + key are owner-gated (Section 19 audit §1 #5).
    // Until then the platform is deterministic-only: AI answers
    // are templates over recorded data, never LLM output.
    enabled: false,
    description:
      'No LLM provider configured — deterministic-only scope; setting OPENAI_API_KEY enables nothing until a real client is wired (owner decision)',
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
