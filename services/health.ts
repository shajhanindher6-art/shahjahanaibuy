/**
 * Health check service — deep health verification.
 * Checks database connectivity, auth service, and Stripe (if configured).
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  version: string;
  timestamp: string;
  checks: {
    database: { status: 'up' | 'down'; latencyMs?: number };
    auth: { status: 'up' | 'down' };
    stripe?: { status: 'up' | 'down' | 'not_configured' };
  };
  /**
   * Section 19, Phase 1 (§12 #3) — live AI provider-registry
   * validation, from the engine's `validate()`. Deterministic
   * providers report 'available'; live providers report
   * 'available-unverified' on key presence ONLY (no network
   * probe, so validation burns zero SerpAPI/HF quota) or
   * 'disabled' with no key. INFORMATIONAL ONLY: AI provider
   * status never flips the overall health — an unconfigured
   * optional SerpAPI key is not an outage.
   */
  ai?: {
    providers: Array<{
      key: string;
      name: string;
      kind: 'deterministic' | 'live';
      capabilities: string[];
      available: boolean;
      status: 'available' | 'available-unverified' | 'disabled';
      detail: string;
    }>;
  };
}

export async function checkHealth(
  supabase: AnySupabaseClient
): Promise<HealthStatus> {
  const timestamp = new Date().toISOString();
  const checks: HealthStatus['checks'] = {
    database: { status: 'down' },
    auth: { status: 'down' },
  };

  // Database check — simple query with timing
  try {
    const dbStart = Date.now();
    const { error: dbError } = await supabase.from('products').select('id').limit(1);
    const dbLatency = Date.now() - dbStart;
    checks.database = dbError
      ? { status: 'down' }
      : { status: 'up', latencyMs: dbLatency };
  } catch {
    checks.database = { status: 'down' };
  }

  // Auth check — verify auth service responds. The error AND the
  // user are both inspected: an anonymous getUser() returns
  // user:null WITHOUT throwing, so "no throw" alone cannot mean
  // "up". Auth is down when the call errors or no user comes back.
  // (Called without a session this reports down by design — the
  // endpoint is a deep check, not an anonymous liveness probe.)
  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    checks.auth = authError || !user ? { status: 'down' } : { status: 'up' };
  } catch {
    checks.auth = { status: 'down' };
  }

  // Stripe check (only if configured)
  const isStripeConfigured = !!process.env.STRIPE_SECRET_KEY;
  if (isStripeConfigured) {
    try {
      const { getStripe } = await import('@/lib/stripe');
      const stripe = getStripe();
      if (stripe) {
        await stripe.balance.retrieve();
        checks.stripe = { status: 'up' };
      } else {
        checks.stripe = { status: 'not_configured' };
      }
    } catch {
      checks.stripe = { status: 'down' };
    }
  } else {
    checks.stripe = { status: 'not_configured' };
  }

  // Overall status. Stripe-down DOES count toward degraded:
  // only 'not_configured' is neutral. Resend, eBay, Upstash and
  // the cron jobs are deliberately NOT checked here — no health
  // probe exists for them yet (audit §1 #33); their absence must
  // not be read as "up".
  const allDown = Object.values(checks).every((c) => c.status === 'down');
  const anyDown = Object.values(checks).some((c) => c.status === 'down');

  const status: HealthStatus['status'] = allDown
    ? 'unhealthy'
    : anyDown
      ? 'degraded'
      : 'healthy';

  // Section 19, Phase 1 (§12 #3) — AI provider validation. Best
  // effort and informational only: a validation failure must
  // never break the health endpoint, and AI status never changes
  // the overall status above. Dynamic import so the health check
  // does not pull the whole AI service graph into every caller.
  let ai: HealthStatus['ai'];
  try {
    const { getAiEngine } = await import('@/services/ai-engine');
    ai = { providers: getAiEngine().validate() };
  } catch {
    ai = undefined;
  }

  return {
    status,
    service: 'SmartBuy AI API',
    version: 'v1',
    timestamp,
    checks,
    ...(ai ? { ai } : {}),
  };
}
