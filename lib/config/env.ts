/**
 * Environment variable validation layer.
 * All env access should go through `env` to fail fast on missing config.
 */

type EnvVar = string | undefined;

function required(name: string, value: EnvVar): string {
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(value: EnvVar, fallback: string): string {
  return value && value.trim() !== '' ? value : fallback;
}

function booleanEnv(value: EnvVar, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

export const env = {
  // Supabase
  supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ),
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,

  // App
  nodeEnv: optional(process.env.NODE_ENV, 'development'),
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',

  // Feature flags (env-level)
  enableGoogleAuth: booleanEnv(process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH, true),
  enableEmailVerification: booleanEnv(process.env.NEXT_PUBLIC_ENABLE_EMAIL_VERIFICATION, false),

  // Future provider keys (not yet active)
  openaiApiKey: process.env.OPENAI_API_KEY,
  redisUrl: process.env.REDIS_URL,
  cloudflareR2AccountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
  cloudflareR2AccessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
  cloudflareR2SecretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
} as const;

export type Env = typeof env;
