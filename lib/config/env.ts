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

  // Stripe
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  // Section 15 P2-8: the publishable key is removed — no
  // @stripe/stripe-js anywhere in the repo, so nothing ever used it.
  // Section 15 P2-1/P2-7: Stripe price IDs are all nullable — an
  // unset ID means that tier cannot be bought (never a hardcoded
  // dollar figure). STRIPE_PREMIUM_PRICE_ID is the current name;
  // STRIPE_PRO_PRICE_ID is kept as a deprecated alias for one
  // release and loses if both are set. The live price decision
  // ($1 vs $4.99 vs $9.99) is the owner's — no amount lives here.
  stripePremiumPriceId:
    process.env.STRIPE_PREMIUM_PRICE_ID ?? process.env.STRIPE_PRO_PRICE_ID,
  /** @deprecated Use STRIPE_PREMIUM_PRICE_ID. Kept as an alias (see above). */
  stripeProPriceId: process.env.STRIPE_PRO_PRICE_ID,
  stripeFamilyPriceId: process.env.STRIPE_FAMILY_PRICE_ID,
  stripeTeamPriceId: process.env.STRIPE_TEAM_PRICE_ID,
  // Section 15 P2-7: optional Starter price ID. Unset = no Starter
  // plan exists (the Starter card is not rendered). Never a live
  // price claim on its own — see lib/pricing-config.ts.
  stripeStarterPriceId: process.env.STRIPE_STARTER_PRICE_ID,
  // Section 15 P2-7: free-trial length in days. Default 0 = no
  // trial. Only honoured when > 0 AND the live launch is approved.
  stripeTrialDays: process.env.STRIPE_TRIAL_DAYS,

  // Email (Resend)
  resendApiKey: process.env.RESEND_API_KEY,
  // RESEND_FROM is accepted as an alias for EMAIL_FROM_ADDRESS so the
  // setup doc and the dashboard can use either name; EMAIL_FROM_ADDRESS
  // wins when both are set. Neither is a secret.
  emailFromAddress: optional(
    process.env.EMAIL_FROM_ADDRESS ?? process.env.RESEND_FROM,
    'noreply@smartbuy.ai'
  ),
  emailFromName: optional(process.env.EMAIL_FROM_NAME, 'SmartBuy AI'),

  // Push notifications (VAPID)
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,

  // WhatsApp & Telegram alert webhooks (owner setup only).
  // All optional: when any leg is unset, that channel reports
  // "not_configured" and is skipped (fail-closed, same as Resend/push).
  // Never commit real values — set them in the hosting dashboard only.
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  whatsappTemplateName: process.env.WHATSAPP_TEMPLATE_NAME,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,

  // Monitoring / crash reporting
  sentryDsn: process.env.SENTRY_DSN,

  // External web search fallback (SerpAPI Google Shopping).
  // Optional: when unset, the web fallback is disabled and search
  // behaves catalog-only. Never commit a real key — set it in Netlify.
  serpApiKey: process.env.SERPAPI_API_KEY,

  // Upstash Redis (REST) for distributed rate limiting.
  // Optional: when unset, rate limiting falls back to the in-memory
  // per-instance bucket (partial protection on serverless). When set,
  // all instances share one sliding-window counter. Never commit real
  // values — set them in the hosting dashboard only.
  upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL,
  upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN,

  // Hugging Face Inference API (free tier) — visual-search vector
  // upgrade (Delta 1). Optional: when unset, POST /api/v1/visual-search
  // answers 503 and the backfill route refuses. Never commit a real
  // token — set it in the hosting dashboard only.
  hfApiToken: process.env.HF_API_TOKEN,

  // Future provider keys (not yet active)
  openaiApiKey: process.env.OPENAI_API_KEY,
  redisUrl: process.env.REDIS_URL,
  cloudflareR2AccountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
  cloudflareR2AccessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
  cloudflareR2SecretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
} as const;

export type Env = typeof env;
